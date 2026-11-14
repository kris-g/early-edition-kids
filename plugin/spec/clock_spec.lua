local H = require("helpers")
local Clock = require("earlyeditionkids/clock")
local describe, it, eq = H.describe, H.it, H.eq

-- Epoch helper: UTC date/time to epoch seconds.
local function utc(y, m, d, hh, mm)
    return Clock.daysFromCivil(y, m, d) * 86400 + (hh or 0) * 3600 + (mm or 0) * 60
end

describe("clock", function()
    it("round-trips civil dates", function()
        eq(Clock.daysFromCivil(1970, 1, 1), 0)
        local y, m, d = Clock.civilFromDays(Clock.daysFromCivil(2028, 2, 29))
        eq(string.format("%d-%d-%d", y, m, d), "2028-2-29")
    end)

    it("adds days across month, year and leap day", function()
        eq(Clock.addDays("2026-11-13", -13), "2026-10-31")
        eq(Clock.addDays("2026-12-31", 1), "2027-01-01")
        eq(Clock.addDays("2028-02-28", 1), "2028-02-29")
        eq(Clock.addDays("2027-03-01", -365), "2026-03-01")
        eq(Clock.daysBetween("2026-11-06", "2026-11-13"), 7)
    end)

    it("formats the long date from the issue date, not the clock", function()
        eq(Clock.longDate("2026-11-13"), "Friday 13 November")
        eq(Clock.longDate("2027-01-01"), "Friday 1 January")
    end)

    it("applies UK summer time on the right days (2026: 29 Mar to 25 Oct)", function()
        eq(Clock.londonOffset(utc(2026, 3, 29, 0, 59)), 0)
        eq(Clock.londonOffset(utc(2026, 3, 29, 1, 0)), 3600)
        eq(Clock.londonOffset(utc(2026, 10, 25, 0, 59)), 3600)
        eq(Clock.londonOffset(utc(2026, 10, 25, 1, 0)), 0)
        eq(Clock.londonOffset(utc(2026, 7, 1, 12)), 3600)
        eq(Clock.londonOffset(utc(2026, 11, 13, 12)), 0)
    end)

    it("gives the London date and hour around midnight in summer", function()
        -- 23:30 UTC on 1 July is 00:30 BST on 2 July.
        local L = Clock.london(utc(2026, 7, 1, 23, 30))
        eq(L.date, "2026-07-02")
        eq(L.hour, 0)
        -- In winter London is UTC.
        L = Clock.london(utc(2026, 11, 13, 5, 10))
        eq(L.date, "2026-11-13")
        eq(L.hour, 5)
        eq(L.wday, 5) -- Friday
    end)

    it("parses the HTTP Date header and learns the skew", function()
        local e = Clock.parseHttpDate("Fri, 13 Nov 2026 07:02:03 GMT")
        eq(e, utc(2026, 11, 13, 7, 2) + 3)
        eq(Clock.parseHttpDate("garbage"), nil)
        -- Device clock stuck in 2015.
        local device_now = utc(2015, 1, 1, 0, 0)
        local skew = Clock.skewFromHeader("Fri, 13 Nov 2026 07:02:03 GMT", device_now)
        eq(Clock.today(device_now, skew), "2026-11-13")
        -- Without skew the device date is used (CONTRACT: "or the device date if none").
        eq(Clock.today(device_now, nil), "2015-01-01")
    end)
end)
