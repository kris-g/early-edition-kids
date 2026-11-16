local H = require("helpers")
local Api = require("earlyeditionkids/api")
local Clock = require("earlyeditionkids/clock")
local Issues = require("earlyeditionkids/issues")
local JSON = require("earlyeditionkids/jsonutil")
local Queue = require("earlyeditionkids/events")
local Store = require("earlyeditionkids/store")
local Syncer = require("earlyeditionkids/syncer")
local describe, it, eq, truthy, falsy = H.describe, H.it, H.eq, H.truthy, H.falsy

local ROOT = "/data/earlyeditionkids"

local function utc(y, m, d, hh)
    return Clock.daysFromCivil(y, m, d) * 86400 + (hh or 0) * 3600
end

local function httpDate(epoch)
    local y, m, d = Clock.civilFromDays(math.floor(epoch / 86400))
    local s = epoch % 86400
    local wd = Clock.WEEKDAYS[(math.floor(epoch / 86400) + 4) % 7]:sub(1, 3)
    return string.format("%s, %02d %s %04d %02d:%02d:%02d GMT", wd, d, Clock.MONTHS[m]:sub(1, 3), y,
        math.floor(s / 3600), math.floor(s % 3600 / 60), s % 60)
end

-- Builds an issue JSON body. ids: list of story ids; hidden: list of ids.
-- extra: more top-level fields, such as { profile = "older", profile_root = true }.
local function issueBody(date, version, ids, hidden, extra)
    local stories = {}
    for i, id in ipairs(ids) do
        stories[i] = { id = id, position = i, topic = "Football", title = "Story " .. id,
                       teaser = "Teaser " .. id, minutes = 2,
                       path = string.format("/issues/%s/v%d/%d.html", date, version, i) }
    end
    local data = { date = date, version = version, fallback = false, title = "Early Edition",
                   stories = JSON.array(stories), hidden = JSON.array(hidden or {}) }
    for k, v in pairs(extra or {}) do data[k] = v end
    return JSON.encode(data)
end

-- A fake server plus all the pieces a sync needs.
local function setup(opts)
    opts = opts or {}
    local env = {}
    env.now = opts.now or utc(2026, 11, 13, 7)
    env.server_now = opts.server_now or env.now
    env.fs = H.memfs()
    env.fs.mkdirp(ROOT)
    env.deleted = {}
    env.store = Store.new(H.memBackend())
    env.queue = Queue.new(env.store, H.counterIds())
    env.issues = Issues.new{ root = ROOT, fs = env.fs, json = JSON, store = env.store,
                             on_delete_file = function(p) table.insert(env.deleted, p) end }
    env.routes = {}
    env.http = H.transport(env.routes)
    env.api = Api.new{ base_url = "http://early-edition-kids.lan:8080/", transport = env.http.fn, json = JSON }
    env.accept_all = true
    env.routes["POST /api/events"] = function(req)
        local body = JSON.decode(req.body)
        local accepted = {}
        for _, ev in ipairs(body.events) do
            if env.accept_all or ev.story_id ~= 999 then table.insert(accepted, ev.client_event_id) end
        end
        env.posted = (env.posted or 0) + #body.events
        return { status = 200, body = JSON.encode({ accepted = JSON.array(accepted) }),
                 headers = { date = httpDate(env.server_now) } }
    end
    function env.serveIssue(date, version, ids, hidden, extra)
        local body = issueBody(date, version, ids, hidden, extra)
        env.routes["GET /api/issue/today"] = { status = 200, body = body,
                                              headers = { date = httpDate(env.server_now) } }
        for i, id in ipairs(ids) do
            env.routes[string.format("GET /issues/%s/v%d/%d.html", date, version, i)] =
                { status = 200, body = "<html><title>Story " .. id .. "</title></html>" }
        end
    end
    function env.serveDate(date, version, ids, hidden, extra)
        local body = issueBody(date, version, ids, hidden, extra)
        env.routes["GET /api/issue/" .. date] = { status = 200, body = body,
                                                  headers = { date = httpDate(env.server_now) } }
        for i, id in ipairs(ids) do
            env.routes[string.format("GET /issues/%s/v%d/%d.html", date, version, i)] =
                { status = 200, body = "<html><title>Story " .. id .. "</title></html>" }
        end
    end
    function env.requested(path)
        local n = 0
        for _, req in ipairs(env.http.requests) do
            if req.url:find(path, 1, true) then n = n + 1 end
        end
        return n
    end
    function env.sync(extra)
        local ctx = { api = env.api, store = env.store, queue = env.queue, issues = env.issues,
                      json = JSON, device_id = "dev-1", now = function() return env.now end }
        for k, v in pairs(extra or {}) do ctx[k] = v end
        return Syncer.run(ctx)
    end
    return env
end

describe("sync", function()
    it("downloads a new issue, saves the index and queues issue_downloaded", function()
        local env = setup()
        env.serveIssue("2026-11-13", 1, { 41, 42, 43 })
        local r = env.sync()
        eq(r.kind, "ok"); eq(r.outcome, "new_issue")
        eq(env.store:get("current_date"), "2026-11-13")
        truthy(env.fs.isFile(ROOT .. "/2026-11-13/41.html"))
        truthy(env.fs.isFile(ROOT .. "/2026-11-13/index.json"))
        eq(#env.issues:visibleStories("2026-11-13"), 3)
        eq(env.queue:count(), 1)
        eq(env.queue:list()[1].type, "issue_downloaded")
        eq(env.queue:list()[1].payload.date, "2026-11-13")
        -- The client joined the server-relative path, it did not build it.
        local urls = {}
        for _, req in ipairs(env.http.requests) do urls[#urls + 1] = req.url end
        truthy(table.concat(urls, " "):find("http://early-edition-kids.lan:8080/issues/2026-11-13/v1/1.html", 1, true))
    end)

    it("uploads events before fetching the issue, and deletes the accepted ones", function()
        local env = setup()
        env.queue:add("story_opened", 41, {}, env.now)
        env.serveIssue("2026-11-13", 1, { 41 })
        env.sync()
        eq(env.http.requests[1].method, "POST")
        eq(env.http.requests[2].url, "http://early-edition-kids.lan:8080/api/issue/today")
        -- story_opened accepted and removed; issue_downloaded queued for next time.
        eq(env.queue:count(), 1)
        eq(env.queue:list()[1].type, "issue_downloaded")
    end)

    it("404: reports not_found and keeps the previous issue", function()
        local env = setup()
        env.serveIssue("2026-11-12", 1, { 31 })
        env.sync()
        env.routes["GET /api/issue/today"] = { status = 404, body = '{"detail":"not yet"}' }
        local r = env.sync()
        eq(r.kind, "not_found")
        eq(env.store:get("current_date"), "2026-11-12")
        truthy(env.fs.isFile(ROOT .. "/2026-11-12/31.html"))
    end)

    it("network down: keeps queued events for later (exactly once)", function()
        local env = setup()
        env.queue:add("story_closed", 41, { active_seconds = 60 }, env.now)
        env.http.down = true
        local r = env.sync()
        eq(r.kind, "network")
        eq(env.queue:count(), 1)
        env.http.down = false
        env.serveIssue("2026-11-13", 1, { 41 })
        env.sync()
        eq(env.posted, 1)
        env.sync() -- the issue_downloaded event goes up now, the story_closed one is not resent
        eq(env.posted, 2)
        eq(env.queue:count(), 0)
    end)

    it("a failed story download leaves no partial issue", function()
        local env = setup()
        env.serveIssue("2026-11-13", 1, { 41, 42 })
        env.routes["GET /issues/2026-11-13/v1/2.html"] = "down"
        local r = env.sync()
        eq(r.kind, "network")
        falsy(env.fs.isDir(ROOT .. "/2026-11-13"))
        eq(env.store:get("current_date"), nil)
        eq(#env.fs.list(ROOT), 0, "temp folder removed")
    end)

    it("hidden: removes the story from the list and deletes its file", function()
        local env = setup()
        env.serveIssue("2026-11-13", 1, { 41, 42, 43 })
        env.sync()
        env.serveIssue("2026-11-13", 1, { 41, 42 }, { 43 })
        local r = env.sync()
        eq(r.outcome, "unchanged")
        truthy(r.list_changed)
        falsy(env.fs.isFile(ROOT .. "/2026-11-13/43.html"))
        eq(env.deleted[#env.deleted], ROOT .. "/2026-11-13/43.html", "sidecar cleanup called")
        eq(#env.issues:visibleStories("2026-11-13"), 2)
    end)

    it("hidden: a story that is open right now keeps its file", function()
        local env = setup()
        env.serveIssue("2026-11-13", 1, { 41, 42 })
        env.sync()
        env.serveIssue("2026-11-13", 1, { 41 }, { 42 })
        env.sync{ protected_path = ROOT .. "/2026-11-13/42.html" }
        truthy(env.fs.isFile(ROOT .. "/2026-11-13/42.html"))
        eq(#env.issues:visibleStories("2026-11-13"), 1)
    end)

    it("unhidden: downloads the story again", function()
        local env = setup()
        env.serveIssue("2026-11-13", 1, { 41, 42 })
        env.sync()
        env.serveIssue("2026-11-13", 1, { 41 }, { 42 })
        env.sync()
        env.serveIssue("2026-11-13", 1, { 41, 42 })
        env.sync()
        truthy(env.fs.isFile(ROOT .. "/2026-11-13/42.html"))
        eq(#env.issues:visibleStories("2026-11-13"), 2)
    end)

    it("new version replaces the issue when nothing has been opened", function()
        local env = setup()
        env.serveIssue("2026-11-13", 1, { 41, 42 })
        env.sync()
        env.serveIssue("2026-11-13", 2, { 51, 52, 53 })
        local r = env.sync()
        eq(r.outcome, "replaced")
        falsy(env.fs.isFile(ROOT .. "/2026-11-13/41.html"))
        truthy(env.fs.isFile(ROOT .. "/2026-11-13/53.html"))
        eq(env.issues:loadIndex("2026-11-13").version, 2)
        eq(#env.deleted, 2, "old story sidecars cleaned")
    end)

    it("new version is ignored once he has opened a story", function()
        local env = setup()
        env.serveIssue("2026-11-13", 1, { 41, 42 })
        env.sync()
        env.store:issueState("2026-11-13").opened["41"] = true
        env.serveIssue("2026-11-13", 2, { 51, 52 })
        local r = env.sync()
        eq(r.outcome, "kept_started")
        truthy(env.fs.isFile(ROOT .. "/2026-11-13/41.html"))
        falsy(env.fs.isFile(ROOT .. "/2026-11-13/51.html"))
        eq(env.issues:loadIndex("2026-11-13").version, 1)
    end)

    it("takes the issue date from the server even with a wrong device clock", function()
        local env = setup{ now = utc(2015, 1, 1, 3), server_now = utc(2026, 11, 13, 7) }
        env.serveIssue("2026-11-13", 1, { 41 })
        env.sync()
        eq(env.store:get("current_date"), "2026-11-13")
        truthy(env.fs.isDir(ROOT .. "/2026-11-13"))
        eq(Clock.today(env.now, env.store:get("clock_skew")), "2026-11-13")
    end)

    it("tidy keeps 7 days, removes older folders with their sidecars and state", function()
        local env = setup()
        for day = 1, 10 do
            local date = string.format("2026-11-%02d", day + 3) -- 04 .. 13
            env.now = utc(2026, 11, day + 3, 7)
            env.server_now = env.now
            env.serveIssue(date, 1, { 100 + day })
            env.sync()
        end
        local dates = env.issues:listDates()
        eq(#dates, 7)
        eq(dates[1], "2026-11-13")
        eq(dates[7], "2026-11-07")
        eq(env.store:get("issues")["2026-11-06"], nil)
        local found = false
        for _, p in ipairs(env.deleted) do if p == ROOT .. "/2026-11-04/101.html" then found = true end end
        truthy(found, "sidecar cleanup for tidied story")
    end)

    it("tidy never removes the current issue, even with a clock far ahead", function()
        local env = setup()
        env.serveIssue("2026-11-13", 1, { 41 })
        env.sync()
        env.issues:tidy("2027-06-01", 7, { ["2026-11-13"] = true })
        truthy(env.fs.isFile(ROOT .. "/2026-11-13/41.html"))
    end)

    it("a server error on the event upload does not stop the issue fetch", function()
        local env = setup()
        env.queue:add("story_opened", 41, {}, env.now)
        env.routes["POST /api/events"] = { status = 500, body = "oops" }
        env.serveIssue("2026-11-13", 1, { 41 })
        local r = env.sync()
        eq(r.kind, "ok")
        eq(env.queue:count(), 2, "event kept, issue_downloaded added")
    end)

    it("refused events (unknown story) stay, then drop after 7 days", function()
        local env = setup()
        env.accept_all = false
        env.queue:add("story_opened", 999, {}, env.now)
        env.serveIssue("2026-11-13", 1, { 41 })
        env.sync()
        eq(env.queue:count(), 2, "refused event kept, issue_downloaded queued")
        eq(env.queue:list()[1].story_id, 999)
        eq(env.queue:list()[1].rejections, 1)
        env.now = env.now + 8 * 86400
        env.sync()
        eq(env.queue:count(), 0)
    end)

    it("a malformed issue response is a server error, not a crash", function()
        local env = setup()
        env.routes["GET /api/issue/today"] = { status = 200, body = '{"date":"nope"}' }
        local r = env.sync()
        eq(r.kind, "server")
    end)
end)

describe("parent-added stories (same version)", function()
    it("a story added mid-day appears after the next sync", function()
        local env = setup()
        env.serveIssue("2026-11-13", 1, { 41, 42, 43, 44, 45, 46 })
        env.sync()
        eq(#env.issues:visibleStories("2026-11-13"), 6)
        env.store:issueState("2026-11-13").opened["41"] = true -- already started: must not matter
        env.serveIssue("2026-11-13", 1, { 41, 42, 43, 44, 45, 46, 47 })
        local r = env.sync()
        eq(r.kind, "ok"); eq(r.outcome, "unchanged")
        eq(r.added, 1)
        truthy(r.list_changed)
        truthy(env.fs.isFile(ROOT .. "/2026-11-13/47.html"))
        local vis = env.issues:visibleStories("2026-11-13")
        eq(#vis, 7)
        -- Nothing he had was replaced.
        truthy(env.fs.isFile(ROOT .. "/2026-11-13/41.html"))
        eq(env.store:issueState("2026-11-13").opened["41"], true)
    end)

    it("an added story at position 7 is shown last, whatever the JSON order", function()
        local env = setup()
        env.serveIssue("2026-11-13", 1, { 41, 42, 43, 44, 45, 46 })
        env.sync()
        -- Same issue, the server lists the added story first in the array.
        local idx = JSON.decode(issueBody("2026-11-13", 1, { 41, 42, 43, 44, 45, 46, 47 }))
        local added = table.remove(idx.stories, 7)
        eq(added.position, 7)
        table.insert(idx.stories, 1, added)
        env.routes["GET /api/issue/today"] = { status = 200, body = JSON.encode(idx) }
        env.routes["GET /issues/2026-11-13/v1/7.html"] = { status = 200, body = "<html>47</html>" }
        env.sync()
        local vis = env.issues:visibleStories("2026-11-13")
        eq(#vis, 7)
        eq(vis[7].id, 47)
        eq(vis[1].id, 41)
        -- And it is the "next story" after the sixth.
        local st = env.store:issueState("2026-11-13")
        for _, k in ipairs({ "41", "42", "43", "44", "45" }) do st.read[k] = true end
        eq(env.issues:nextUnread("2026-11-13", "46").id, 47)
    end)

    it("header counts include added stories", function()
        local env = setup()
        env.serveIssue("2026-11-13", 1, { 41, 42, 43, 44, 45, 46 })
        env.sync()
        env.store:issueState("2026-11-13").read["41"] = true
        local before = env.issues:summary("2026-11-13")
        eq(before.total, 6); eq(before.read, 1); eq(before.minutes, 12)
        env.serveIssue("2026-11-13", 1, { 41, 42, 43, 44, 45, 46, 47, 48 })
        env.sync()
        local after = env.issues:summary("2026-11-13")
        eq(after.total, 8); eq(after.read, 1); eq(after.minutes, 16)
    end)

    it("a half-finished download of an added story is completed next time", function()
        local env = setup()
        env.serveIssue("2026-11-13", 1, { 41, 42 })
        env.sync()
        env.serveIssue("2026-11-13", 1, { 41, 42, 43, 44 })
        env.routes["GET /issues/2026-11-13/v1/4.html"] = "down"
        local r = env.sync()
        eq(r.kind, "network")
        eq(#env.issues:visibleStories("2026-11-13"), 2, "index not updated yet")
        env.serveIssue("2026-11-13", 1, { 41, 42, 43, 44 })
        r = env.sync()
        eq(r.kind, "ok")
        eq(#env.issues:visibleStories("2026-11-13"), 4)
    end)
end)

-- Story photos (CONTRACT "Story photos"): gives the stories in `ids` of the
-- served issue a kindle_image, and serves the photo and the page that shows it.
local JPEG = "\255\216\255\224" .. string.rep("p", 40)
local function servePhotos(env, ids, photo)
    local route = env.routes["GET /api/issue/today"]
    local data = JSON.decode(route.body)
    local want = {}
    for _, id in ipairs(ids) do want[id] = true end
    for _, st in ipairs(data.stories) do
        if want[st.id] then
            local p = st.path:gsub("%.html$", ".kindle.jpg")
            st.kindle_image = { path = p }
            env.routes["GET " .. p] = photo or { status = 200, body = JPEG }
            env.routes["GET " .. st.path .. "?photo=1"] =
                { status = 200, body = '<html><img src="' .. st.id .. '.jpg"></html>' }
        end
    end
    data.stories = JSON.array(data.stories)
    data.hidden = JSON.array(data.hidden or {})
    route.body = JSON.encode(data)
end

describe("story photos", function()
    it("stores the photo beside the page that shows it; a story without one gets the plain page", function()
        local env = setup()
        env.serveIssue("2026-11-13", 1, { 41, 42 })
        servePhotos(env, { 41 })
        local r = env.sync()
        eq(r.kind, "ok")
        eq(env.fs.files[ROOT .. "/2026-11-13/41.jpg"], JPEG)
        eq(env.fs.files[ROOT .. "/2026-11-13/41.html"], '<html><img src="41.jpg"></html>')
        eq(env.requested("/issues/2026-11-13/v1/1.kindle.jpg"), 1)
        falsy(env.fs.isFile(ROOT .. "/2026-11-13/42.jpg"))
        eq(env.fs.files[ROOT .. "/2026-11-13/42.html"], "<html><title>Story 42</title></html>")
        eq(env.requested("/issues/2026-11-13/v1/2.html?photo=1"), 0)
        -- The photo is asked for as an image.
        for _, req in ipairs(env.http.requests) do
            if req.url:find("kindle.jpg", 1, true) then eq(req.headers.accept, "image/jpeg") end
        end
    end)

    it("a photo the server cannot make, or one that is not a JPEG, means the plain page", function()
        for _, photo in ipairs({ { status = 404, body = "{}" }, { status = 200, body = "<html>oops</html>" },
                                 { status = 500, body = "" } }) do
            local env = setup()
            env.serveIssue("2026-11-13", 1, { 41 })
            servePhotos(env, { 41 }, photo)
            local r = env.sync()
            eq(r.kind, "ok"); eq(r.outcome, "new_issue")
            falsy(env.fs.isFile(ROOT .. "/2026-11-13/41.jpg"))
            eq(env.fs.files[ROOT .. "/2026-11-13/41.html"], "<html><title>Story 41</title></html>")
        end
    end)

    it("a photo cut off by the network fails the download, to try again later", function()
        local env = setup()
        env.serveIssue("2026-11-13", 1, { 41, 42 })
        servePhotos(env, { 42 }, "down")
        local r = env.sync()
        eq(r.kind, "network")
        falsy(env.fs.isDir(ROOT .. "/2026-11-13"))
        servePhotos(env, { 42 })
        r = env.sync()
        eq(r.kind, "ok")
        truthy(env.fs.isFile(ROOT .. "/2026-11-13/42.jpg"))
    end)

    it("a story a parent adds or unhides gets its photo; hiding one deletes it", function()
        local env = setup()
        env.serveIssue("2026-11-13", 1, { 41 })
        env.sync()
        env.serveIssue("2026-11-13", 1, { 41, 42 })
        servePhotos(env, { 41, 42 })
        local r = env.sync()
        eq(r.added, 1)
        truthy(env.fs.isFile(ROOT .. "/2026-11-13/42.jpg"))
        eq(env.fs.files[ROOT .. "/2026-11-13/42.html"], '<html><img src="42.jpg"></html>')
        -- A story he already has is not fetched again for its photo.
        falsy(env.fs.isFile(ROOT .. "/2026-11-13/41.jpg"))
        env.serveIssue("2026-11-13", 1, { 41 }, { 42 })
        env.sync()
        falsy(env.fs.isFile(ROOT .. "/2026-11-13/42.jpg"))
        falsy(env.fs.isFile(ROOT .. "/2026-11-13/42.html"))
        env.serveIssue("2026-11-13", 1, { 41, 42 })
        servePhotos(env, { 42 })
        env.sync()
        truthy(env.fs.isFile(ROOT .. "/2026-11-13/42.jpg"))
    end)

    it("adds ?photo=1 to a path, or &photo=1 to one with a query", function()
        eq(Syncer.photoPagePath("/issues/2026-11-13/v1/1.html"), "/issues/2026-11-13/v1/1.html?photo=1")
        eq(Syncer.photoPagePath("/issues/x.html?a=b"), "/issues/x.html?a=b&photo=1")
    end)
end)

describe("back-issue catch-up", function()
    local DAY = 86400

    it("fetches and stores missing earlier dates, without making them current or opened", function()
        local env = setup()
        env.serveIssue("2026-11-13", 1, { 41, 42 })
        env.serveDate("2026-11-12", 1, { 31, 32 })
        env.serveDate("2026-11-10", 1, { 21 })
        local r = env.sync()
        eq(r.kind, "ok"); eq(r.outcome, "new_issue")
        eq(table.concat(r.backfilled, ","), "2026-11-12,2026-11-10")
        eq(table.concat(env.issues:listDates(), ","), "2026-11-13,2026-11-12,2026-11-10")
        eq(env.store:get("current_date"), "2026-11-13")
        truthy(env.fs.isFile(ROOT .. "/2026-11-12/31.html"))
        eq(next(env.store:issueState("2026-11-12").opened), nil, "nothing marked opened")
        eq(#env.issues:visibleStories("2026-11-10"), 1)
    end)

    it("applies the hidden list of a back issue", function()
        local env = setup()
        env.serveIssue("2026-11-13", 1, { 41 })
        env.serveDate("2026-11-12", 1, { 31, 32 }, { 33 })
        env.sync()
        eq(#env.issues:visibleStories("2026-11-12"), 2)
        eq(env.issues:loadIndex("2026-11-12").hidden[1], 33)
    end)

    it("asks for at most the 6 previous days, never outside the 7-day window", function()
        local env = setup()
        env.serveIssue("2026-11-13", 1, { 41 })
        local r = env.sync()
        eq(r.catchup_requests, 6)
        for d = 7, 12 do eq(env.requested(string.format("/api/issue/2026-11-%02d", d)), 1, "day " .. d) end
        eq(env.requested("/api/issue/2026-11-06"), 0)
        eq(env.requested("/api/issue/2026-11-13"), 0, "today comes from /today")
    end)

    it("remembers a 404 for the rest of the day, then asks again", function()
        local env = setup()
        env.serveIssue("2026-11-13", 1, { 41 })
        env.sync()
        env.sync()
        eq(env.requested("/api/issue/2026-11-11"), 1, "not asked again the same day")
        env.now = env.now + DAY
        env.server_now = env.now
        env.serveIssue("2026-11-13", 1, { 41 })
        env.serveDate("2026-11-11", 1, { 11 })
        local r = env.sync()
        eq(env.requested("/api/issue/2026-11-11"), 2)
        truthy(env.fs.isFile(ROOT .. "/2026-11-11/11.html"))
        eq(env.requested("/api/issue/2026-11-07"), 1, "the 7th has left the window on the 14th")
        truthy(#r.backfilled >= 1)
    end)

    it("stops at the first network failure and resumes on a later sync", function()
        local env = setup()
        env.serveIssue("2026-11-13", 1, { 41 })
        env.routes["GET /api/issue/2026-11-12"] = "down"
        local r = env.sync()
        eq(r.kind, "ok", "today's sync still counts as a success")
        eq(r.catchup_stopped, "2026-11-12")
        eq(env.requested("/api/issue/2026-11-11"), 0)
        env.serveDate("2026-11-12", 1, { 31 })
        r = env.sync()
        eq(r.backfilled[1], "2026-11-12")
        eq(env.requested("/api/issue/2026-11-11"), 1)
    end)

    it("leaves a stored back issue alone even if the server has a newer version", function()
        local env = setup()
        env.serveIssue("2026-11-13", 1, { 41 })
        env.serveDate("2026-11-12", 1, { 31 })
        env.sync()
        env.serveDate("2026-11-12", 2, { 51, 52 })
        env.now = env.now + 3600
        env.sync()
        eq(env.requested("/api/issue/2026-11-12"), 1)
        eq(env.issues:loadIndex("2026-11-12").version, 1)
    end)

    it("also runs when today's paper is not ready yet (404), but not when the server is unreachable", function()
        local env = setup()
        env.routes["GET /api/issue/today"] = { status = 404, body = "{}" }
        env.serveDate("2026-11-12", 1, { 31 })
        local r = env.sync()
        eq(r.kind, "not_found", "the 30-minute back-off for today still applies")
        eq(r.backfilled[1], "2026-11-12")
        eq(env.store:get("current_date"), nil, "a back issue never becomes current")

        local env2 = setup()
        env2.routes["GET /api/issue/today"] = { status = 500, body = "oops" }
        env2.serveDate("2026-11-12", 1, { 31 })
        eq(env2.sync().kind, "server")
        eq(env2.requested("/api/issue/2026-11-12"), 0)
        local env3 = setup()
        env3.http.down = true
        eq(env3.sync().kind, "network")
        eq(env3.requested("/api/issue/2026-11-12"), 0)
    end)

    it("the Kindle left for days: one sync stores today and the missed days", function()
        local env = setup{ now = utc(2026, 11, 9, 7) }
        env.serveIssue("2026-11-09", 1, { 90 })
        env.sync()
        -- Four days later.
        env.now = utc(2026, 11, 13, 7)
        env.server_now = env.now
        env.serveIssue("2026-11-13", 1, { 130 })
        env.serveDate("2026-11-12", 1, { 120 })
        env.serveDate("2026-11-11", 1, { 110 })
        env.serveDate("2026-11-10", 1, { 100 })
        local r = env.sync()
        eq(r.outcome, "new_issue")
        eq(table.concat(r.backfilled, ","), "2026-11-12,2026-11-11,2026-11-10")
        eq(table.concat(env.issues:listDates(), ","), "2026-11-13,2026-11-12,2026-11-11,2026-11-10,2026-11-09")
        eq(env.store:get("current_date"), "2026-11-13")
    end)
end)

describe("issues", function()
    it("next unread story wraps round and skips read ones", function()
        local env = setup()
        env.serveIssue("2026-11-13", 1, { 41, 42, 43 })
        env.sync()
        local st = env.store:issueState("2026-11-13")
        st.read["42"] = true
        eq(env.issues:nextUnread("2026-11-13", "41").id, 43)
        eq(env.issues:nextUnread("2026-11-13", "43").id, 41)
        st.read["41"] = true; st.read["43"] = true
        eq(env.issues:nextUnread("2026-11-13", "43"), nil)
        local sum = env.issues:summary("2026-11-13")
        eq(sum.read, 3); eq(sum.total, 3); eq(sum.minutes, 6)
    end)

    it("recognises story paths", function()
        local env = setup()
        local d, id = env.issues:parseStoryPath(ROOT .. "/2026-11-13/41.html")
        eq(d, "2026-11-13"); eq(id, "41")
        eq(env.issues:parseStoryPath("/mnt/us/books/kane.epub"), nil)
    end)
end)

describe("profiles", function()
    local ReadingLog = require("earlyeditionkids/readinglog")
    local OLDER = { profile = "older", profile_root = true }
    local YOUNGER = { profile = "younger", profile_root = false }

    -- A device that has read the older child's paper: an issue, a log entry and a queued event.
    local function readOlder(env, extra)
        env.readlog = ReadingLog.new(H.memBackend())
        env.serveIssue("2026-11-13", 1, { 1, 2, 3 }, nil, extra)
        env.sync{ readlog = env.readlog }
        env.readlog:append{ date = "2026-11-13", story_id = 1, topic = "Football", title = "Story 1", finished = true }
        env.queue:add("story_closed", 1, { active_seconds = 60, finished = true }, env.now)
        env.accept_all = false -- keep the queued event, as if Wi-Fi dropped before it went
    end

    it("stores which paper it has", function()
        local env = setup()
        env.serveIssue("2026-11-13", 1, { 1, 2 }, nil, OLDER)
        env.sync()
        local p = env.store:get("profile")
        eq(p.id, "older"); eq(p.root, true)
    end)

    it("starts afresh when another child's paper arrives", function()
        local env = setup()
        readOlder(env, OLDER)
        env.routes["POST /api/events"] = { status = 409, body = '{"detail":"these events are for profile older"}' }
        -- The younger child's ids also start at 1.
        env.serveIssue("2026-11-13", 1, { 1, 2 }, nil, YOUNGER)
        env.store:issueState("2026-11-13").opened["1"] = true
        local r = env.sync{ readlog = env.readlog }
        eq(r.kind, "ok"); eq(r.outcome, "new_issue"); truthy(r.profile_changed)
        eq(env.store:get("profile").id, "younger")
        eq(#env.readlog:entries(), 0)
        -- The old paper's event is gone; only the new paper's issue_downloaded is queued.
        eq(env.queue:count(), 1); eq(env.queue:list()[1].type, "issue_downloaded")
        eq(#env.issues:visibleStories("2026-11-13"), 2)
        falsy(env.store:anyOpened("2026-11-13"), "nothing opened in the new paper")
    end)

    it("says which paper its events are for, so the server can refuse them", function()
        local env = setup()
        readOlder(env, OLDER)
        local sent
        env.routes["POST /api/events"] = function(req)
            sent = JSON.decode(req.body)
            return { status = 200, body = '{"accepted":[]}' }
        end
        env.sync{ readlog = env.readlog }
        eq(sent.profile, "older"); eq(sent.profile_root, true)
    end)

    it("keeps everything when the root paper's owner is renamed from default", function()
        local env = setup()
        readOlder(env, { profile = "default", profile_root = true })
        env.serveIssue("2026-11-13", 1, { 1, 2, 3 }, nil, OLDER)
        local r = env.sync{ readlog = env.readlog }
        falsy(r.profile_changed)
        eq(env.store:get("profile").id, "older")
        eq(#env.readlog:entries(), 1)
        eq(r.outcome, "unchanged")
    end)

    it("changes nothing when the server or the store does not say", function()
        local env = setup()
        readOlder(env, nil) -- an older server: no profile at all
        env.serveIssue("2026-11-13", 1, { 1, 2, 3 }, nil, YOUNGER)
        local r = env.sync{ readlog = env.readlog }
        falsy(r.profile_changed, "nothing stored yet")
        eq(#env.readlog:entries(), 1)
        eq(env.store:get("profile").id, "younger")
        env.serveIssue("2026-11-13", 1, { 1, 2, 3 })
        r = env.sync{ readlog = env.readlog }
        falsy(r.profile_changed, "the server stopped saying")
        eq(#env.readlog:entries(), 1)
        eq(env.store:get("profile").id, "younger")
    end)

    it("notices another child's paper in back issues too", function()
        local env = setup()
        readOlder(env, OLDER)
        env.routes["GET /api/issue/today"] = { status = 404, body = '{"detail":"no issue yet"}' }
        env.now = utc(2026, 11, 14, 7)
        env.server_now = env.now
        env.store:set("clock_skew", 0)
        env.serveDate("2026-11-12", 1, { 1 }, nil, YOUNGER)
        local r = env.sync{ readlog = env.readlog }
        truthy(r.profile_changed)
        eq(#env.readlog:entries(), 0)
        eq(env.store:get("profile").id, "younger")
        eq(table.concat(env.issues:listDates(), ","), "2026-11-12")
    end)

    it("works with a server address that ends in /p/<id>", function()
        local env = setup()
        env.api = Api.new{ base_url = "http://192.168.1.50:8080/p/younger", transport = env.http.fn, json = JSON }
        local body = issueBody("2026-11-13", 1, { 1, 2 }, nil, YOUNGER)
        env.routes["GET /p/younger/api/issue/today"] = { status = 200, body = body }
        env.routes["GET /p/younger/issues/2026-11-13/v1/1.html"] = { status = 200, body = "<html>1</html>" }
        env.routes["GET /p/younger/issues/2026-11-13/v1/2.html"] = { status = 200, body = "<html>2</html>" }
        local r = env.sync()
        eq(r.kind, "ok"); eq(r.outcome, "new_issue")
        eq(env.requested("http://192.168.1.50:8080/p/younger/issues/2026-11-13/v1/2.html"), 1)
        eq(env.requested("http://192.168.1.50:8080/issues/"), 0)
    end)
end)
