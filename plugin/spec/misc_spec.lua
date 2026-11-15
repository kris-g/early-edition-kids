local H = require("helpers")
local JSON = require("earlyeditionkids/jsonutil")
local ReadingLog = require("earlyeditionkids/readinglog")
local Store = require("earlyeditionkids/store")
local Tracker = require("earlyeditionkids/tracker")
local Clock = require("earlyeditionkids/clock")
local describe, it, eq, truthy, falsy = H.describe, H.it, H.eq, H.truthy, H.falsy

describe("reading log", function()
    it("keeps a year and drops older entries by issue date", function()
        local b = H.memBackend()
        local log = ReadingLog.new(b)
        log:append{ date = "2025-11-01", story_id = 1, topic = "Space", title = "Old", active_seconds = 50, finished = true, ts = 1 }
        log:append{ date = "2025-11-14", story_id = 2, topic = "Space", title = "Kept", active_seconds = 50, finished = true, ts = 2 }
        log:append{ date = "2026-11-13", story_id = 3, topic = "Football", title = "New", active_seconds = 80, finished = false, ts = 3 }
        local removed = log:prune("2026-11-13")
        eq(removed, 1)
        eq(#log:entries(), 2)
        log:save()
        -- Reloads from the backend (a separate file from the state store).
        local again = ReadingLog.new(b)
        eq(#again:entries(), 2)
        eq(again:entries()[1].title, "Kept")
    end)

    it("is not touched by the issue tidy or event upload", function()
        -- The log has its own backend; the tidy only knows the state store.
        local log = ReadingLog.new(H.memBackend())
        log:append{ date = "2026-10-01", story_id = 7, finished = true }
        local store = Store.new(H.memBackend())
        local Issues = require("earlyeditionkids/issues")
        local fs = H.memfs()
        fs.mkdirp("/k/2026-10-01")
        fs.writeFile("/k/2026-10-01/index.json", "{}")
        local issues = Issues.new{ root = "/k", fs = fs, json = JSON, store = store }
        issues:tidy("2026-11-13", 7, {})
        falsy(fs.isDir("/k/2026-10-01"))
        eq(#log:entries(), 1)
    end)

    it("gives stats-screen numbers: week count, topics, streak", function()
        local log = ReadingLog.new(H.memBackend())
        log:append{ date = "2026-11-11", story_id = 1, topic = "Space", finished = true }
        log:append{ date = "2026-11-12", story_id = 2, topic = "Football", finished = true }
        log:append{ date = "2026-11-12", story_id = 2, topic = "Football", finished = true } -- re-read
        log:append{ date = "2026-11-13", story_id = 3, topic = "Football", finished = true }
        log:append{ date = "2026-11-13", story_id = 4, topic = "Weather", finished = false }
        eq(log:finishedSince("2026-11-09"), 3)
        eq(log:topicCounts().Football, 2)
        eq(log:streak("2026-11-13"), 3)
        eq(log:streak("2026-11-14"), 3, "a streak still counts until he has had today")
        eq(log:streak("2026-11-16"), 0)
    end)
end)

describe("tracker", function()
    local function fakeClock()
        local c = { t = 0 }
        c.fn = function() return c.t end
        return c
    end

    it("excludes time asleep", function()
        local c = fakeClock()
        local t = Tracker.new{ clock = c.fn }
        t:page(1, 2)
        c.t = 40
        t:pause()
        c.t = 4000 -- asleep overnight
        t:resume()
        c.t = 4030
        t:page(2, 2)
        local r = t:result(2)
        eq(r.active_seconds, 70)
        eq(r.max_page, 2); eq(r.pages_total, 2); eq(r.finished, true)
    end)

    it("caps idle time per page", function()
        local c = fakeClock()
        local t = Tracker.new{ clock = c.fn, max_gap = 300 }
        t:page(1, 3)
        c.t = 3600
        local r = t:result(3)
        eq(r.active_seconds, 300)
        eq(r.finished, false)
        eq(r.max_page, 1)
    end)

    it("reaching the end counts even after a re-pagination", function()
        local c = fakeClock()
        local t = Tracker.new{ clock = c.fn }
        t:page(1, 2); t:page(2, 2)
        t:markEnd(2)
        local r = t:result(3) -- font got bigger before closing
        eq(r.finished, true)
        eq(r.max_page, 3)
    end)

    it("reports the last page as soon as it is shown", function()
        local t = Tracker.new{ clock = function() return 0 end }
        falsy(t:page(1, 2))
        truthy(t:page(2, 2))
    end)
end)

describe("json", function()
    it("pure-Lua codec round-trips the contract shapes", function()
        local s = JSON._pureEncode({ a = 1, b = "x\"y\n", c = JSON.array({}), d = JSON.object({}), e = { 1, 2 }, f = JSON.null })
        eq(s, '{"a":1,"b":"x\\"y\\n","c":[],"d":{},"e":[1,2],"f":null}')
        local v = JSON._pureDecode('{"date":"2026-11-13","version":2,"stories":[{"id":41,"title":"Caf\\u00e9 \\ud83d\\ude00"}],"hidden":[],"x":null}')
        eq(v.date, "2026-11-13"); eq(v.version, 2)
        eq(v.stories[1].id, 41)
        eq(v.stories[1].title, "Caf\195\169 \240\159\152\128")
        eq(#v.hidden, 0)
        eq(v.x, nil)
    end)

    it("decode never raises", function()
        local v, err = JSON.decode("{bad")
        eq(v, nil); truthy(err)
        eq((JSON.decode(nil)), nil)
    end)
end)

describe("store", function()
    it("creates one random device id and keeps it", function()
        local b = H.memBackend()
        local s = Store.new(b)
        local id = s:deviceId(function() return "abc" end)
        eq(id, "abc")
        local s2 = Store.new(b)
        eq(s2:deviceId(function() return "zzz" end), "abc")
    end)

    it("survives a corrupt backend", function()
        local s = Store.new{ load = function() error("boom") end, save = function() end }
        eq(type(s.data), "table")
    end)
end)

describe("dates in the headline header", function()
    it("uses the issue date, not the device clock", function()
        eq(Clock.longDate("2026-11-13"), "Friday 13 November")
    end)
end)

describe("server address", function()
    local ServerUrl = require("earlyeditionkids/serverurl")
    it("tidies what was typed", function()
        eq(ServerUrl.normalize("  http://192.168.1.50:8080/  "), "http://192.168.1.50:8080")
        eq(ServerUrl.normalize("192.168.1.50:8080"), "http://192.168.1.50:8080")
        eq(ServerUrl.normalize("https://news.example.com"), "https://news.example.com")
        eq(ServerUrl.normalize("http://nas.local:8080"), "http://nas.local:8080")
        eq(ServerUrl.normalize(""), "")
    end)
    it("explains what's wrong with text that isn't an address", function()
        for _, bad in ipairs({ "ftp://x", "http://", "http://two words", "http://x:99999", "http://:8080" }) do
            local url, err = ServerUrl.normalize(bad)
            eq(url, nil, bad)
            truthy(err and #err > 0, bad)
        end
    end)
end)
