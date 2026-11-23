--[[--
The Sport page on the Kindle (docs/sports-page.md): fetching it with the
paper, keeping it, whether it is open yet today, and the view models for its
screens. No KOReader dependency, so it is all covered by the specs.

Kept:
  store "sport_issue"  { date, sports }   today's issue's `sports` field (the
                                          rule changes when a parent changes it,
                                          even with the same paper)
  store "sport_day"    "YYYY-MM-DD"       the London day the page was fetched
  store "sport_open"   "YYYY-MM-DD"       Sport opened on this day: it stays open
  <data>/sport.json                       the page itself, as the server sent it

Read first (section 2.7): Sport opens when enough of today's stories count:
read to the end, and open for at least each story's least time over all its
sittings, from the reading log. The server's count from every device (in the
page it sent today) opens it too.
]]

local Clock = require("earlyeditionkids/clock")

local Sport = {}

Sport.FILE = "sport.json"

--- Checks the shape of a Sport page response.
function Sport.valid(data)
    return type(data) == "table" and type(data.updated_at) == "string" and type(data.teams) == "table"
end

---------------------------------------------------------------------------
-- Fetching with the paper (called by syncer.lua after today's issue)
---------------------------------------------------------------------------

local function filePath(ctx)
    return ctx.issues.root .. "/" .. Sport.FILE
end

--[[--
After today's issue: keep its `sports` field, and fetch the page it names.
A 404 means the page is off or withdrawn: forget it. A network failure keeps
what is here. Sets result.sport_changed when what the screens show changed.
]]
function Sport.sync(ctx, data, result)
    local store, fs = ctx.store, ctx.issues.fs
    local today = Clock.today(ctx.now(), store:get("clock_skew"))
    if data.date ~= today then return end
    local before = ctx.json.encode({ store:get("sport_issue") or false, store:get("sport_day") or false })
    local sports = type(data.sports) == "table" and data.sports or nil
    store:set("sport_issue", sports and { date = data.date, sports = sports } or nil)
    local changed = false
    if not sports or type(sports.path) ~= "string" then
        if fs.isFile(filePath(ctx)) then fs.removeFile(filePath(ctx)); changed = true end
        store:set("sport_day", nil)
    else
        local r = ctx.api:getSports(sports.path)
        if r.kind == "ok" then
            local old = fs.readFile(filePath(ctx))
            fs.writeFile(filePath(ctx), r.body)
            store:set("sport_day", today)
            changed = old ~= r.body
        elseif r.kind == "not_found" then
            if fs.isFile(filePath(ctx)) then fs.removeFile(filePath(ctx)); changed = true end
            store:set("sport_day", nil)
        elseif ctx.log then
            ctx.log("info", "Sport page not fetched:", r.message or r.kind)
        end
    end
    local after = ctx.json.encode({ store:get("sport_issue") or false, store:get("sport_day") or false })
    result.sport_changed = changed or before ~= after
end

--- The kept page, decoded, or nil.
function Sport.load(issues, json)
    local body = issues.fs.readFile(issues.root .. "/" .. Sport.FILE)
    if not body then return nil end
    local data = json.decode(body)
    return Sport.valid(data) and data or nil
end

---------------------------------------------------------------------------
-- The lock
---------------------------------------------------------------------------

--- Story ids (as strings) of the paper that count toward opening Sport.
function Sport.counted(date, rule, entries)
    local out = {}
    if type(rule) ~= "table" or type(rule.min_seconds) ~= "table" then return out end
    local seconds, finished = {}, {}
    for _, e in ipairs(entries or {}) do
        local id = tostring(e.story_id)
        if e.date == date and rule.min_seconds[id] then
            seconds[id] = (seconds[id] or 0) + math.max(0, tonumber(e.active_seconds) or 0)
            if e.finished then finished[id] = true end
        end
    end
    for id in pairs(finished) do
        if seconds[id] >= (tonumber(rule.min_seconds[id]) or 0) then out[id] = true end
    end
    return out
end

local function count(set)
    local n = 0
    for _ in pairs(set) do n = n + 1 end
    return n
end

--[[--
Whether Sport is open today. opts: today, sport_issue ({ date, sports } or
nil), view (the kept page or nil), sport_day, sport_open, entries.
Returns { open, needed, counted, stick } (stick: remember it opened today).
]]
function Sport.lock(opts)
    if opts.sport_open == opts.today then return { open = true, needed = 0, counted = 0 } end
    local si = opts.sport_issue
    local rule = si and si.date == opts.today and si.sports and si.sports.unlock or nil
    if type(rule) ~= "table" or not tonumber(rule.needed) then return { open = true, needed = 0, counted = 0 } end
    local needed = tonumber(rule.needed)
    local mine = count(Sport.counted(si.date, rule, opts.entries))
    local server = opts.view and opts.sport_day == opts.today and type(opts.view.unlock) == "table" and opts.view.unlock or nil
    local counted = math.max(mine, server and tonumber(server.counted) or 0)
    local open = mine >= needed or (server ~= nil and server.unlocked == true)
    return { open = open, needed = needed, counted = math.min(counted, needed), stick = open }
end

---------------------------------------------------------------------------
-- View models
---------------------------------------------------------------------------

--- "8:00pm", London time, from an ISO instant.
function Sport.kickoff(iso)
    local epoch = Clock.parseIso(iso)
    if not epoch then return "" end
    local hhmm = Clock.londonHHMM(epoch)
    local h, m = hhmm:match("^(%d+):(%d+)$")
    h = tonumber(h) or 0
    local suffix = h >= 12 and "pm" or "am"
    local h12 = h % 12
    if h12 == 0 then h12 = 12 end
    return string.format("%d:%s%s", h12, m or "00", suffix)
end

local function clubs(view)
    local by = {}
    for _, c in ipairs(view.teams or {}) do by[c.id] = c end
    return {
        short = function(id) return by[id] and by[id].short or tostring(id) end,
        name = function(id) return by[id] and by[id].name or tostring(id) end,
    }
end

--- "Sun 22 Nov"
local function shortDay(date)
    local _, m, d = Clock.parseDate(date)
    if not d then return date or "" end
    return string.format("%s %d %s", Clock.WEEKDAYS[Clock.weekday(date)]:sub(1, 3), d, Clock.MONTHS[m]:sub(1, 3))
end
Sport.shortDay = shortDay

local function dayHead(date)
    local _, m, d = Clock.parseDate(date)
    return Clock.WEEKDAYS[Clock.weekday(date)] or "", d and string.format("%d %s", d, Clock.MONTHS[m]) or ""
end

--[[--
One matchday as rows for the Matches or Next tab:
  { number, days = { { name = "Saturday", date_text = "21 November",
    matches = { { id, home, away, score_text, state_text, fav, home_win,
    away_win, opens } } } } }
]]
function Sport.matchday(view, md)
    if type(md) ~= "table" then return nil end
    local c = clubs(view)
    local out = { number = md.number, days = {} }
    for _, d in ipairs(md.days or {}) do
        local name, text = dayHead(d.date)
        local day = { name = name, date_text = text, matches = {} }
        for _, m in ipairs(d.matches or {}) do
            local s = m.state == "finished" and type(m.score) == "table" and m.score or nil
            local state_text
            if s then state_text = "FT"
            elseif m.state == "postponed" then state_text = "Postponed"
            elseif m.state == "abandoned" then state_text = "Abandoned"
            else state_text = Sport.kickoff(m.kickoff) end
            day.matches[#day.matches + 1] = {
                id = m.id,
                home = c.short(m.home), away = c.short(m.away),
                score_text = s and string.format("%d \226\128\147 %d", s.home, s.away) or "v",
                state_text = state_text,
                fav = view.favourite_team ~= nil and (m.home == view.favourite_team or m.away == view.favourite_team),
                home_fav = m.home == view.favourite_team, away_fav = m.away == view.favourite_team,
                home_win = s ~= nil and s.home > s.away, away_win = s ~= nil and s.away > s.home,
                opens = s ~= nil and type(m.detail) == "table",
            }
        end
        out.days[#out.days + 1] = day
    end
    return out
end

--[[--
The table, half by half (ten rows a page on the Kindle):
  { rows = { { position, club, played, won, drawn, lost, gd_text, points, fav, cut } },
    zones = { "Top 4: Champions League" }, half, halves, final }
`half` 1 is places 1 to 10, 2 is 11 onwards; nil picks the half with his club.
]]
Sport.PER_HALF = 10
function Sport.tableHalf(view, half)
    local t = view.table
    if type(t) ~= "table" then return nil end
    local c = clubs(view)
    local rows = t.rows or {}
    local halves = math.max(1, math.ceil(#rows / Sport.PER_HALF))
    if not half then
        half = 1
        for i, r in ipairs(rows) do
            if r.team == view.favourite_team then half = math.ceil(i / Sport.PER_HALF) end
        end
    end
    half = math.max(1, math.min(half, halves))
    local cut, out, zones = {}, {}, {}
    for _, l in ipairs(t.lines or {}) do cut[tonumber(l.after) or -1] = l.label end
    local first, last = (half - 1) * Sport.PER_HALF + 1, math.min(#rows, half * Sport.PER_HALF)
    for i = first, last do
        local r = rows[i]
        local gd = tonumber(r.goal_difference) or 0
        out[#out + 1] = {
            position = r.position, club = c.short(r.team), played = r.played, won = r.won, drawn = r.drawn,
            lost = r.lost, gd_text = gd > 0 and ("+" .. gd) or tostring(gd), points = r.points,
            fav = r.team == view.favourite_team, cut = cut[tonumber(r.position)] ~= nil and i < #rows,
        }
    end
    for _, l in ipairs(t.lines or {}) do
        local after = tonumber(l.after) or 0
        if after >= first and after <= last then
            zones[#zones + 1] = l.label == "Relegation" and "Below the line: relegation" or string.format("Top %d: %s", after, l.label)
        end
    end
    return { rows = out, zones = zones, half = half, halves = halves, final = t.final == true }
end

local LINE_NAMES = { goalkeeper = "Goalkeeper", defenders = "Defenders", midfielders = "Midfielders", forwards = "Forwards" }

local function goalText(g)
    local extra = g.kind == "penalty" and " (pen)" or (g.kind == "own_goal" and " (o.g.)" or "")
    return string.format("%s %s%s", g.player or "", g.minute or "", extra)
end

--[[--
A played match, for its two screens:
  { home, away, score_text, when_text, goals = { home = {..}, away = {..} },
    penalties, cards, subs, injuries (per side { off = {..}, out = {..} } or nil),
    lineups = { home = { team, groups = { { name, players = { { number, name, note } } } } }, away = ... } }
Lists are per side: { home = { { minute, text, card } }, away = ... }.
]]
function Sport.match(view, id)
    local found
    for _, d in ipairs(view.matchday and view.matchday.days or {}) do
        for _, m in ipairs(d.matches or {}) do
            if m.id == id and type(m.detail) == "table" then found = m end
        end
    end
    if not found then return nil end
    local m, dt, c = found, found.detail, clubs(view)
    local function bySide(list, f)
        local out = { home = {}, away = {} }
        for _, x in ipairs(list or {}) do
            if out[x.side] then table.insert(out[x.side], f(x)) end
        end
        return out
    end
    local out = {
        home = c.name(m.home), away = c.name(m.away),
        home_short = c.short(m.home), away_short = c.short(m.away),
        home_fav = m.home == view.favourite_team, away_fav = m.away == view.favourite_team,
        score_text = string.format("%d \226\128\147 %d", m.score.home, m.score.away),
        goals = bySide(dt.goals, goalText),
        penalties = bySide(dt.penalties, function(x) return { minute = x.minute, text = x.player .. " (" .. x.outcome .. ")" } end),
        cards = bySide(dt.cards, function(x) return { minute = x.minute, text = x.player, card = x.card } end),
        subs = bySide(dt.subs, function(x) return { minute = x.minute, on = x.on, off = x.off } end),
    }
    local date = Clock.london(Clock.parseIso(m.kickoff) or 0).date
    local _, text = dayHead(date)
    out.when_text = "FULL TIME \194\183 " .. string.upper((Clock.WEEKDAYS[Clock.weekday(date)] or "") .. " " .. text)
    local injured = false
    out.injuries = { home = { off = {}, out = {} }, away = { off = {}, out = {} } }
    for _, s in ipairs(dt.subs or {}) do
        if s.injury and out.injuries[s.side] then
            table.insert(out.injuries[s.side].off, s.off .. " " .. s.minute)
            injured = true
        end
    end
    for _, side in ipairs({ "home", "away" }) do
        for _, n in ipairs(dt.out_injured and dt.out_injured[side] or {}) do
            table.insert(out.injuries[side].out, n)
            injured = true
        end
    end
    if not injured then out.injuries = nil end
    out.lineups = {}
    for _, side in ipairs({ "home", "away" }) do
        local l = dt.lineups and dt.lineups[side] or { starting = {}, bench = {} }
        local groups = {}
        local function players(list)
            local ps = {}
            for _, p in ipairs(list or {}) do
                ps[#ps + 1] = { number = p.number or "", name = p.name or "",
                                note = p.off and ("off " .. p.off) or (p.on and ("on " .. p.on) or "") }
            end
            return ps
        end
        for _, g in ipairs(l.starting or {}) do
            groups[#groups + 1] = { name = LINE_NAMES[g.line] or "", players = players(g.players) }
        end
        if l.bench and #l.bench > 0 then groups[#groups + 1] = { name = "Substitutes", players = players(l.bench) } end
        out.lineups[side] = { team = side == "home" and out.home_short or out.away_short, groups = groups }
    end
    return out
end

--- The front page strip: { open, label, sub, togo } or nil when today's paper has no Sport page.
function Sport.strip(sport_issue, today, lock)
    local si = sport_issue
    if not si or si.date ~= today or type(si.sports) ~= "table" then return nil end
    if lock.open then
        local md = tonumber(si.sports.matchday)
        return { open = true, sub = (si.sports.label or "Premier League") .. (md and (" \194\183 Matchday " .. md) or "") }
    end
    local togo = lock.needed - lock.counted
    return { open = false, needed = lock.needed, counted = lock.counted, togo = togo,
             sub = string.format("Opens after %d of today's stories \194\183 %d more to go", lock.needed, togo) }
end

return Sport
