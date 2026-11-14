--[[--
When to sync, and back-off after failures (DESIGN 5.1 steps 1-2, CONTRACT
"Plugin sync rules").

On start and on resume the plugin syncs if any of:

1. it is after `earliest_fetch_hour` (Europe/London) and it has no issue for
   today;
2. there are queued events (that the server has not yet refused once);
3. it has today's issue and its last successful check was more than 30
   minutes ago.

Automatic tries are suppressed by a back-off: 30 minutes after a 404 (issue
not ready), 2 minutes after a network failure. A manual "Check for news"
ignores the back-off.

"Today" is the Europe/London date of the device clock corrected by the skew
learnt from the server's Date header (see clock.lua). With no skew yet it is
the device date, as the contract says.

All times here are device epoch seconds (`os.time()`); only differences are
used, and a clock that has gone backwards cancels any back-off rather than
stretching it.
]]

local Clock = require("earlyeditionkids/clock")
local Const = require("earlyeditionkids/const")

local Rules = {}

--[[--
ctx:
  now               device epoch seconds
  skew              server minus device seconds (or nil)
  earliest_hour     config earliest_fetch_hour
  sync              store sync state table
  current_date      newest issue date on the device (or nil)
  has_fresh_events  boolean
  manual            boolean

Returns should_sync, reason, info{ today, hour, expect_new }.
`expect_new` is true when the sync is expected to bring a new issue, which is
when the "Getting today's news…" notification is shown.
]]
function Rules.decide(ctx)
    local est = Clock.estimate(ctx.now, ctx.skew)
    local L = Clock.london(est)
    local today = L.date
    local current = ctx.current_date
    local have_today = current ~= nil and current >= today
    local info = { today = today, hour = L.hour, expect_new = not have_today }

    if ctx.manual then
        return true, "manual", info
    end

    local st = ctx.sync or {}
    if st.next_auto_at and ctx.now < st.next_auto_at then
        local clock_went_back = st.last_attempt_at and ctx.now < st.last_attempt_at
        if not clock_went_back then
            info.expect_new = false
            return false, "backoff", info
        end
    end

    if not have_today and L.hour >= (ctx.earliest_hour or 5) then
        return true, "new_issue", info
    end

    info.expect_new = false
    if ctx.has_fresh_events then
        return true, "events", info
    end

    if have_today then
        local last = st.last_success_at
        if not last or ctx.now < last or (ctx.now - last) >= Const.RECHECK_INTERVAL then
            return true, "recheck", info
        end
    end

    return false, "idle", info
end

--- Records the outcome of a sync attempt (automatic or manual) in `st`.
-- kind: "ok" | "not_found" | "network" | "server"
function Rules.record(st, kind, now)
    st.last_attempt_at = now
    st.last_result = kind
    if kind == "ok" then
        st.next_auto_at = nil
        st.last_success_at = now
    elseif kind == "not_found" then
        st.next_auto_at = now + Const.BACKOFF_NOT_READY
    else
        st.next_auto_at = now + Const.BACKOFF_NETWORK
    end
    return st
end

return Rules
