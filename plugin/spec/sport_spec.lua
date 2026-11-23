-- sport.lua: the read-first lock and the small formatting rules (docs/sports-page.md 2.7).

local H = require("helpers")
local Sport = require("earlyeditionkids/sport")
local describe, it, eq, truthy, falsy = H.describe, H.it, H.eq, H.truthy, H.falsy

local TODAY = "2026-11-13"
local RULE = { needed = 2, min_seconds = { ["41"] = 60, ["42"] = 60, ["43"] = 50 } }
local function entry(id, seconds, finished, date)
    return { date = date or TODAY, story_id = id, active_seconds = seconds, finished = finished }
end
local function lock(entries, extra)
    local opts = { today = TODAY, sport_issue = { date = TODAY, sports = { unlock = RULE } }, entries = entries }
    for k, v in pairs(extra or {}) do opts[k] = v end
    return Sport.lock(opts)
end

describe("sport.lua", function()
    it("counts stories read to the end and for long enough, adding up sittings", function()
        local set = Sport.counted(TODAY, RULE, {
            entry(41, 70, true),            -- counts
            entry(42, 9, true),             -- too fast
            entry(43, 30, false), entry(43, 25, true), -- two sittings: 55 s
            entry(41, 500, true, "2026-11-12"), -- another paper
        })
        truthy(set["41"]); falsy(set["42"]); truthy(set["43"])
    end)

    it("opens on enough stories, or on the server's count for today only", function()
        local l = lock({ entry(41, 70, true), entry(42, 9, true) })
        eq(l.open, false); eq(l.needed, 2); eq(l.counted, 1)
        eq(lock({ entry(41, 70, true), entry(43, 50, true) }).open, true)
        local view = { unlock = { needed = 2, counted = 2, unlocked = true } }
        eq(lock({}, { view = view, sport_day = "2026-11-12" }).open, false, "yesterday's count")
        eq(lock({}, { view = view, sport_day = TODAY }).open, true)
        eq(lock({}, { sport_open = TODAY }).open, true, "stays open for the day")
    end)

    it("is open with no lock, or no Sport for today", function()
        eq(Sport.lock{ today = TODAY, entries = {} }.open, true)
        eq(Sport.lock{ today = TODAY, sport_issue = { date = TODAY, sports = { unlock = nil } }, entries = {} }.open, true)
        eq(Sport.lock{ today = TODAY, sport_issue = { date = "2026-11-12", sports = { unlock = RULE } }, entries = {} }.open, true)
    end)

    it("says kick-off times the British way, in London time", function()
        eq(Sport.kickoff("2026-11-23T20:00:00Z"), "8:00pm")    -- GMT
        eq(Sport.kickoff("2026-11-29T12:00:00Z"), "12:00pm")
        eq(Sport.kickoff("2026-08-22T11:30:00Z"), "12:30pm")   -- BST
        eq(Sport.kickoff("nonsense"), "")
        eq(Sport.shortDay("2026-11-22"), "Sun 22 Nov")
    end)

    it("shows the strip only for today's paper with a Sport page", function()
        eq(Sport.strip(nil, TODAY, { open = true }), nil)
        eq(Sport.strip({ date = "2026-11-12", sports = {} }, TODAY, { open = true }), nil)
        local s = Sport.strip({ date = TODAY, sports = { label = "Premier League", matchday = 11 } }, TODAY, { open = false, needed = 3, counted = 1 })
        eq(s.togo, 2)
        eq(s.sub, "Opens after 3 of today's stories \194\183 2 more to go")
        eq(s.tile_sub, "2 more stories first")
        eq(Sport.strip({ date = TODAY, sports = {} }, TODAY, { open = false, needed = 3, counted = 1 }, true).tile_sub,
           "Read 2 again to open", "every story read, too quickly")
    end)
end)
