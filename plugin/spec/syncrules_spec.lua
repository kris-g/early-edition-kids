local H = require("helpers")
local Clock = require("earlyeditionkids/clock")
local Rules = require("earlyeditionkids/syncrules")
local describe, it, eq, truthy, falsy = H.describe, H.it, H.eq, H.truthy, H.falsy

local function utc(y, m, d, hh, mm)
    return Clock.daysFromCivil(y, m, d) * 86400 + (hh or 0) * 3600 + (mm or 0) * 60
end

local function decide(over)
    local ctx = { now = utc(2026, 11, 13, 7, 0), skew = 0, earliest_hour = 5, sync = {},
                  current_date = "2026-11-12", has_fresh_events = false, manual = false }
    for k, v in pairs(over or {}) do ctx[k] = v end
    return Rules.decide(ctx)
end

describe("sync rules", function()
    it("rule 1: syncs after the earliest hour when today's issue is missing", function()
        local ok, reason, info = decide()
        truthy(ok); eq(reason, "new_issue"); truthy(info.expect_new)
    end)

    it("rule 1: waits before the earliest hour", function()
        local ok, reason = decide{ now = utc(2026, 11, 13, 4, 59) }
        falsy(ok); eq(reason, "idle")
    end)

    it("rule 1 uses London time in summer (04:30 UTC is 05:30 BST)", function()
        local ok = decide{ now = utc(2026, 7, 1, 4, 30), current_date = "2026-06-30" }
        truthy(ok)
        ok = decide{ now = utc(2026, 7, 1, 3, 30), current_date = "2026-06-30" }
        falsy(ok)
    end)

    it("rule 2: queued events trigger a sync even before the earliest hour", function()
        local ok, reason = decide{ now = utc(2026, 11, 13, 3, 0), has_fresh_events = true }
        truthy(ok); eq(reason, "events")
    end)

    it("rule 3: rechecks today's issue after 30 minutes", function()
        local now = utc(2026, 11, 13, 7, 0)
        local ok = decide{ current_date = "2026-11-13", sync = { last_success_at = now - 29 * 60 } }
        falsy(ok)
        local ok2, reason = decide{ current_date = "2026-11-13", sync = { last_success_at = now - 31 * 60 } }
        truthy(ok2); eq(reason, "recheck")
    end)

    it("backs off 30 minutes after a 404", function()
        local now = utc(2026, 11, 13, 6, 0)
        local st = Rules.record({}, "not_found", now)
        falsy((decide{ now = now + 29 * 60, sync = st }))
        truthy((decide{ now = now + 30 * 60, sync = st }))
    end)

    it("backs off 2 minutes after a network failure", function()
        local now = utc(2026, 11, 13, 6, 0)
        local st = Rules.record({}, "network", now)
        local ok, reason = decide{ now = now + 60, sync = st }
        falsy(ok); eq(reason, "backoff")
        truthy((decide{ now = now + 120, sync = st }))
    end)

    it("back-off also holds queued events", function()
        local now = utc(2026, 11, 13, 6, 0)
        local st = Rules.record({}, "network", now)
        falsy((decide{ now = now + 10, sync = st, has_fresh_events = true }))
    end)

    it("a manual check ignores the back-off", function()
        local now = utc(2026, 11, 13, 6, 0)
        local st = Rules.record({}, "not_found", now)
        local ok, reason = decide{ now = now + 60, sync = st, manual = true }
        truthy(ok); eq(reason, "manual")
    end)

    it("success clears the back-off", function()
        local now = utc(2026, 11, 13, 6, 0)
        local st = Rules.record({}, "not_found", now)
        Rules.record(st, "ok", now + 5)
        eq(st.next_auto_at, nil)
        eq(st.last_success_at, now + 5)
    end)

    it("a clock that jumps backwards cancels the back-off", function()
        local now = utc(2026, 11, 13, 9, 0)
        local st = Rules.record({}, "not_found", now)
        truthy((decide{ now = now - 2 * 3600, sync = st }))
    end)

    it("wrong device clock: skew from the server decides today", function()
        -- Device thinks it is 1 Jan 2015 03:00; server said it is 13 Nov 2026 07:00.
        local device_now = utc(2015, 1, 1, 3, 0)
        local skew = utc(2026, 11, 13, 7, 0) - device_now
        local ok, _, info = decide{ now = device_now, skew = skew, current_date = "2026-11-12" }
        truthy(ok); eq(info.today, "2026-11-13")
        -- And with today's issue already stored it does not re-download.
        local ok2, reason = decide{ now = device_now, skew = skew, current_date = "2026-11-13",
                                    sync = { last_success_at = device_now - 60 } }
        falsy(ok2); eq(reason, "idle")
    end)

    it("a device clock behind the stored issue counts as having today's issue", function()
        local ok, reason = decide{ now = utc(2026, 11, 10, 7, 0), current_date = "2026-11-13",
                                   sync = { last_success_at = utc(2026, 11, 10, 6, 50) } }
        falsy(ok); eq(reason, "idle")
    end)
end)
