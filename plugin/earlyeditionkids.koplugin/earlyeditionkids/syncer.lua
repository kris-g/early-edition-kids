--[[--
One sync run (DESIGN 5.1 steps 1, 9, 10; CONTRACT "Plugin sync rules").

Order, as the contract says: upload queued events, then fetch
/api/issue/today, then:

- a date we do not have: download every story, save the index, record an
  `issue_downloaded` event;
- the same date and version: apply `hidden` (drop those stories, delete their
  files) and fetch any story we do not have: one a parent added to today's
  issue (CONTRACT "Parent-added articles") or unhid;
- the same date, higher version: replace the stored issue only if no story
  from it has been opened, otherwise keep what he has started;
- then tidy (7 days of issues, with their KOReader sidecars).

The issue date always comes from the server response, never from the device
clock. The server's Date header is used to learn the clock skew.

No KOReader dependency: everything comes in through `ctx`:

    ctx.api, ctx.store, ctx.queue, ctx.issues, ctx.json
    ctx.device_id
    ctx.now()                  device epoch seconds
    ctx.log(level, ...)        optional
    ctx.protected_path         story file currently open (never deleted), optional

Returns a result table:

    { kind = "ok"|"not_found"|"network"|"server",
      outcome = "new_issue"|"replaced"|"unchanged"|"kept_started"|"older"|nil,
      date, version, list_changed, added, events_sent, events_accepted, events_dropped,
      message }
]]

local Clock = require("earlyeditionkids/clock")
local Const = require("earlyeditionkids/const")
local Queue = require("earlyeditionkids/events")
local Store = require("earlyeditionkids/store")

local Syncer = {}

local function log(ctx, level, ...)
    if ctx.log then ctx.log(level, ...) end
end

local function learnSkew(ctx, r)
    if r and r.date_header then
        local skew = Clock.skewFromHeader(r.date_header, ctx.now())
        if skew then ctx.store:set("clock_skew", skew) end
    end
end

local function uploadEvents(ctx, result)
    local sent_ids = {}
    local max_batches = 20
    for _ = 1, max_batches do
        local batch = ctx.queue:nextBatch(Const.EVENT_BATCH, sent_ids)
        if #batch == 0 then break end
        local wire = {}
        for i, ev in ipairs(batch) do
            wire[i] = Queue.toWire(ev, ctx.json)
            sent_ids[ev.client_event_id] = true
        end
        local r = ctx.api:postEvents(ctx.device_id, wire)
        learnSkew(ctx, r)
        result.events_sent = result.events_sent + #batch
        if r.kind == "network" then
            return "network", r.message
        elseif r.kind ~= "ok" then
            -- The server answered but not as expected: keep the events and
            -- carry on to the issue fetch.
            log(ctx, "warn", "event upload failed:", r.message)
            return "ok"
        end
        local acc, dropped = ctx.queue:applyAccepted(batch, r.accepted, ctx.now())
        result.events_accepted = result.events_accepted + acc
        result.events_dropped = result.events_dropped + dropped
        ctx.store:save()
    end
    return "ok"
end

-- Downloads all stories of `data` into a temporary folder, then swaps it in.
local function downloadIssue(ctx, data, raw)
    local fs, issues = ctx.issues.fs, ctx.issues
    local tmp = issues:tmpDir(data.date, data.version)
    fs.removeTree(tmp)
    local ok, err = fs.mkdirp(tmp)
    if not ok then return "server", "mkdir failed: " .. tostring(err) end
    for _, s in ipairs(data.stories) do
        local r = ctx.api:download(s.path)
        if r.kind ~= "ok" then
            fs.removeTree(tmp)
            return (r.kind == "network") and "network" or "server", "story " .. tostring(s.id) .. ": " .. tostring(r.message)
        end
        local wok, werr = fs.writeFile(tmp .. "/" .. Store.idKey(s.id) .. ".html", r.body)
        if not wok then
            fs.removeTree(tmp)
            return "server", "write failed: " .. tostring(werr)
        end
    end
    local wok, werr = fs.writeFile(tmp .. "/index.json", raw)
    if not wok then
        fs.removeTree(tmp)
        return "server", "write failed: " .. tostring(werr)
    end
    if fs.isDir(issues:dir(data.date)) then
        issues:removeIssue(data.date)
    end
    local rok, rerr = fs.rename(tmp, issues:dir(data.date))
    if not rok then
        fs.removeTree(tmp)
        return "server", "rename failed: " .. tostring(rerr)
    end
    issues:forget(data.date)
    ctx.store:resetIssueState(data.date, data.version, ctx.now())
    ctx.queue:add("issue_downloaded", nil, { date = data.date, version = data.version }, ctx.now())
    return "ok"
end

-- Same date and version: apply hidden, restore unhidden, fetch stories a
-- parent added, refresh the index.
local function reconcile(ctx, data, raw, result)
    local issues, fs = ctx.issues, ctx.issues.fs
    local stored = issues:loadIndex(data.date)
    local st = ctx.store:issueState(data.date)

    local visible = {}
    for _, s in ipairs(data.stories) do visible[Store.idKey(s.id)] = true end
    local hidden = {}
    for _, id in ipairs(data.hidden or {}) do hidden[Store.idKey(id)] = true end

    for _, s in ipairs(stored and stored.stories or {}) do
        local key = Store.idKey(s.id)
        if (hidden[key] or not visible[key]) and not st.hidden[key] then
            st.hidden[key] = true
            issues:removeStoryFile(data.date, s.id, ctx.protected_path)
            result.list_changed = true
        end
    end

    local known = {}
    for _, s in ipairs(stored and stored.stories or {}) do known[Store.idKey(s.id)] = true end

    for _, s in ipairs(data.stories) do
        local key = Store.idKey(s.id)
        if not known[key] then
            -- A parent added this story to today's issue (same version,
            -- next free position; CONTRACT "Parent-added articles"). The
            -- check is against the stored index, not the file, so a sync
            -- that failed half-way still updates the index next time.
            result.added = (result.added or 0) + 1
            result.list_changed = true
        end
        if st.hidden[key] then
            st.hidden[key] = nil
            result.list_changed = true
        end
        local path = issues:storyFile(data.date, s.id)
        if not fs.isFile(path) then
            local r = ctx.api:download(s.path)
            if r.kind ~= "ok" then
                return (r.kind == "network") and "network" or "server", r.message
            end
            fs.writeFile(path, r.body)
            result.list_changed = true
        end
    end

    if result.list_changed then
        fs.writeFile(issues:dir(data.date) .. "/index.json", raw)
        issues:forget(data.date)
    end
    return "ok"
end

local function applyIssue(ctx, data, raw, result)
    local store, issues = ctx.store, ctx.issues
    local date, version = data.date, data.version
    result.date, result.version = date, version
    local current = store:get("current_date")
    local stored = issues:loadIndex(date)

    if not stored then
        local kind, msg = downloadIssue(ctx, data, raw)
        if kind ~= "ok" then return kind, msg end
        if current and date < current then
            -- The server's "today" is older than what we have; keep it for
            -- Yesterday's news but do not make it current.
            result.outcome = "older"
        else
            store:set("current_date", date)
            result.outcome = "new_issue"
        end
        return "ok"
    end

    local stored_version = tonumber(stored.version) or 0
    if version > stored_version then
        if store:anyOpened(date) then
            log(ctx, "info", "kept started issue", date, "v" .. stored_version, "server has v" .. version)
            result.outcome = "kept_started"
            return "ok"
        end
        local kind, msg = downloadIssue(ctx, data, raw)
        if kind ~= "ok" then return kind, msg end
        if not current or date >= current then store:set("current_date", date) end
        result.outcome = "replaced"
        return "ok"
    elseif version == stored_version then
        if not current or date > current then store:set("current_date", date) end
        result.outcome = "unchanged"
        return reconcile(ctx, data, raw, result)
    end

    result.outcome = "unchanged"
    return "ok"
end

--[[--
Back-issue catch-up: after the today step (a new or unchanged issue, or a
404 because today's is not ready yet; not after a network or server error),
fetch the previous days
(within the 7-day window the tidy keeps) that the device has no issue for,
with GET /api/issue/{date}, and store them exactly like a today issue
(index, story files, hidden list). They never become the current issue,
nothing is marked opened, and the controller shows no screen or notice.

Gentle on the server: at most CATCHUP_DAYS requests per sync; a date that
answered 404 is not asked again until the next calendar day
(store "catchup_missing" = { [date] = day asked }); the first network failure
ends the catch-up for this sync. A stored issue is never re-fetched, even if
the server has a newer version of it.
]]
Syncer.CATCHUP_DAYS = Const.KEEP_ISSUE_DAYS - 1

local function catchUp(ctx, result)
    local today = Clock.today(ctx.now(), ctx.store:get("clock_skew"))
    local missing = ctx.store:get("catchup_missing", {})
    for date, asked in pairs(missing) do
        if asked ~= today then missing[date] = nil end -- a new day: ask again
    end
    local have = {}
    for _, d in ipairs(ctx.issues:listDates()) do have[d] = true end
    result.backfilled = {}
    local requests = 0
    for i = 1, Syncer.CATCHUP_DAYS do
        local date = Clock.addDays(today, -i)
        if date and not have[date] and not missing[date] and requests < Syncer.CATCHUP_DAYS then
            requests = requests + 1
            local r = ctx.api:getIssue(date)
            if r.kind == "not_found" then
                missing[date] = today
            elseif r.kind == "network" then
                log(ctx, "info", "back-issue catch-up stopped at", date, r.message)
                result.catchup_stopped = date
                break
            elseif r.kind ~= "ok" then
                log(ctx, "warn", "back issue", date, "skipped:", r.message)
            else
                local kind, msg = downloadIssue(ctx, r.data, r.body)
                if kind == "ok" then
                    table.insert(result.backfilled, date)
                elseif kind == "network" then
                    log(ctx, "info", "back-issue catch-up stopped at", date, msg)
                    result.catchup_stopped = date
                    break
                else
                    log(ctx, "warn", "back issue", date, "not stored:", msg)
                end
            end
        end
    end
    result.catchup_requests = requests
    if #result.backfilled > 0 then
        log(ctx, "info", "caught up back issues", table.concat(result.backfilled, ", "))
    end
end
Syncer.catchUp = catchUp

function Syncer.run(ctx)
    local result = { events_sent = 0, events_accepted = 0, events_dropped = 0 }

    local kind, msg = uploadEvents(ctx, result)
    if kind ~= "ok" then
        result.kind, result.message = kind, msg
        ctx.store:save()
        return result
    end

    local r = ctx.api:getIssueToday()
    learnSkew(ctx, r)
    if r.kind ~= "ok" then
        result.kind, result.message = r.kind, r.message
        if r.kind == "not_found" then
            -- Today's paper is not ready yet, but the server answered: still
            -- fetch the days he missed (e.g. a Kindle woken at 4am after a
            -- few days away). The 30-minute back-off for today is unchanged.
            catchUp(ctx, result)
        end
        ctx.store:save()
        return result
    end

    kind, msg = applyIssue(ctx, r.data, r.body, result)
    result.kind, result.message = kind, msg

    if kind == "ok" then
        catchUp(ctx, result)
        local protect = {}
        local current = ctx.store:get("current_date")
        if current then protect[current] = true end
        if ctx.protected_path then
            local d = ctx.issues:parseStoryPath(ctx.protected_path)
            if d then protect[d] = true end
        end
        local today = Clock.today(ctx.now(), ctx.store:get("clock_skew"))
        local removed = ctx.issues:tidy(today, Const.KEEP_ISSUE_DAYS, protect)
        if #removed > 0 then log(ctx, "info", "tidied", table.concat(removed, ", ")) end
    end

    ctx.store:save()
    return result
end

return Syncer
