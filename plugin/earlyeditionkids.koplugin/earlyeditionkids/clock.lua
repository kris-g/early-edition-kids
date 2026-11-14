--[[--
Date and time helpers with no KOReader dependency.

The Kindle clock may be wrong and its time zone may not be set, so Early Edition Kids
never asks the device what the local date is. Instead:

- `os.time()` gives epoch seconds (this is UTC-based whatever the device TZ);
- a clock skew learnt from the server's HTTP `Date` header is added to it;
- Europe/London local time is worked out here from the UK summer-time rule
  (BST from 01:00 UTC on the last Sunday of March to 01:00 UTC on the last
  Sunday of October).

Dates are ISO strings ("2026-11-13"), which sort and compare correctly as
plain strings.
]]

local Clock = {}

local floor = math.floor

-- Days since 1970-01-01 for a proleptic Gregorian date (Howard Hinnant's algorithm).
local function daysFromCivil(y, m, d)
    if m <= 2 then y = y - 1 end
    local era = floor(y / 400)
    local yoe = y - era * 400
    local mp = (m + 9) % 12
    local doy = floor((153 * mp + 2) / 5) + d - 1
    local doe = yoe * 365 + floor(yoe / 4) - floor(yoe / 100) + doy
    return era * 146097 + doe - 719468
end

local function civilFromDays(z)
    z = z + 719468
    local era = floor(z / 146097)
    local doe = z - era * 146097
    local yoe = floor((doe - floor(doe / 1460) + floor(doe / 36524) - floor(doe / 146096)) / 365)
    local y = yoe + era * 400
    local doy = doe - (365 * yoe + floor(yoe / 4) - floor(yoe / 100))
    local mp = floor((5 * doy + 2) / 153)
    local d = doy - floor((153 * mp + 2) / 5) + 1
    local m = mp < 10 and mp + 3 or mp - 9
    if m <= 2 then y = y + 1 end
    return y, m, d
end

Clock.daysFromCivil = daysFromCivil
Clock.civilFromDays = civilFromDays

-- 0 = Sunday ... 6 = Saturday. 1970-01-01 was a Thursday.
local function weekdayOfDays(days)
    return (days + 4) % 7
end

local function lastSundayDays(y, m)
    local next_y, next_m = y, m + 1
    if next_m == 13 then next_y, next_m = y + 1, 1 end
    local last = daysFromCivil(next_y, next_m, 1) - 1
    return last - weekdayOfDays(last)
end

--- Offset of Europe/London from UTC, in seconds, at a given epoch.
function Clock.londonOffset(epoch)
    local y = civilFromDays(floor(epoch / 86400))
    local bst_start = lastSundayDays(y, 3) * 86400 + 3600
    local bst_end = lastSundayDays(y, 10) * 86400 + 3600
    if epoch >= bst_start and epoch < bst_end then
        return 3600
    end
    return 0
end

local function pad2(n) return string.format("%02d", n) end

local function isoDate(y, m, d)
    return string.format("%04d-%02d-%02d", y, m, d)
end

--- Europe/London wall-clock parts for an epoch.
function Clock.london(epoch)
    local local_secs = epoch + Clock.londonOffset(epoch)
    local days = floor(local_secs / 86400)
    local secs = local_secs - days * 86400
    local y, m, d = civilFromDays(days)
    return {
        year = y, month = m, day = d,
        hour = floor(secs / 3600),
        min = floor((secs % 3600) / 60),
        sec = secs % 60,
        wday = weekdayOfDays(days),
        date = isoDate(y, m, d),
    }
end

--- Best estimate of the true epoch: device clock plus learnt skew.
function Clock.estimate(device_now, skew)
    return device_now + (tonumber(skew) or 0)
end

function Clock.today(device_now, skew)
    return Clock.london(Clock.estimate(device_now, skew)).date
end

--- Parse "YYYY-MM-DD"; returns y, m, d or nil.
function Clock.parseDate(s)
    if type(s) ~= "string" then return nil end
    local y, m, d = s:match("^(%d%d%d%d)%-(%d%d)%-(%d%d)$")
    if not y then return nil end
    y, m, d = tonumber(y), tonumber(m), tonumber(d)
    if m < 1 or m > 12 or d < 1 or d > 31 then return nil end
    return y, m, d
end

function Clock.isDate(s)
    return Clock.parseDate(s) ~= nil
end

function Clock.dateToDays(s)
    local y, m, d = Clock.parseDate(s)
    if not y then return nil end
    return daysFromCivil(y, m, d)
end

function Clock.addDays(s, n)
    local days = Clock.dateToDays(s)
    if not days then return nil end
    return isoDate(civilFromDays(days + n))
end

--- Whole days from date a to date b (b - a).
function Clock.daysBetween(a, b)
    local da, db = Clock.dateToDays(a), Clock.dateToDays(b)
    if not da or not db then return nil end
    return db - da
end

Clock.WEEKDAYS = { [0] = "Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday" }
Clock.MONTHS = { "January", "February", "March", "April", "May", "June", "July",
                 "August", "September", "October", "November", "December" }

--- "Friday 13 November" for an ISO date (taken from the issue, not the device clock).
function Clock.longDate(s)
    local y, m, d = Clock.parseDate(s)
    if not y then return s or "" end
    local wd = weekdayOfDays(daysFromCivil(y, m, d))
    return string.format("%s %d %s", Clock.WEEKDAYS[wd], d, Clock.MONTHS[m])
end

local MONTH_ABBR = { Jan = 1, Feb = 2, Mar = 3, Apr = 4, May = 5, Jun = 6,
                     Jul = 7, Aug = 8, Sep = 9, Oct = 10, Nov = 11, Dec = 12 }

--- Parse an RFC 7231 HTTP date ("Fri, 13 Nov 2026 07:02:03 GMT") to epoch seconds.
function Clock.parseHttpDate(s)
    if type(s) ~= "string" then return nil end
    local d, mon, y, hh, mm, ss = s:match("^%a+, (%d+) (%a+) (%d+) (%d+):(%d+):(%d+) GMT$")
    if not d then return nil end
    local m = MONTH_ABBR[mon]
    if not m then return nil end
    return daysFromCivil(tonumber(y), m, tonumber(d)) * 86400
        + tonumber(hh) * 3600 + tonumber(mm) * 60 + tonumber(ss)
end

--- Skew (server minus device) from a response Date header, or nil.
function Clock.skewFromHeader(date_header, device_now)
    local server = Clock.parseHttpDate(date_header)
    if not server then return nil end
    return server - device_now
end

--- Day of week for an ISO date: 0 = Sunday ... 6 = Saturday.
function Clock.weekday(s)
    local days = Clock.dateToDays(s)
    if not days then return nil end
    return weekdayOfDays(days)
end

--- Monday of the week (Monday to Sunday) containing an ISO date.
function Clock.mondayOf(s)
    local wd = Clock.weekday(s)
    if not wd then return nil end
    return Clock.addDays(s, -((wd + 6) % 7))
end

Clock.WEEKDAY_ABBR = { [0] = "SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT" }

--- "FRIDAY 13 NOVEMBER 2026" (the masthead date line).
function Clock.mastheadDate(s)
    local y, m, d = Clock.parseDate(s)
    if not y then return "" end
    return string.upper(string.format("%s %d %s %d", Clock.WEEKDAYS[Clock.weekday(s)], d, Clock.MONTHS[m], y))
end

--- "Monday 9 to Sunday 15 November" or "Monday 28 October to Sunday 3 November".
function Clock.weekRange(monday)
    local sunday = Clock.addDays(monday, 6)
    local _, m1, d1 = Clock.parseDate(monday)
    local _, m2, d2 = Clock.parseDate(sunday)
    if not m1 or not m2 then return "" end
    if m1 == m2 then
        return string.format("Monday %d to Sunday %d %s", d1, d2, Clock.MONTHS[m2])
    end
    return string.format("Monday %d %s to Sunday %d %s", d1, Clock.MONTHS[m1], d2, Clock.MONTHS[m2])
end

--- Parse an ISO 8601 timestamp ("2026-11-13T05:31:07+00:00", "...Z",
-- fractional seconds allowed, no zone = UTC) to epoch seconds, or nil.
function Clock.parseIso(s)
    if type(s) ~= "string" then return nil end
    local y, mo, d, hh, mm, ss, rest = s:match("^(%d%d%d%d)%-(%d%d)%-(%d%d)[T ](%d%d):(%d%d):(%d%d)(.*)$")
    if not y then return nil end
    rest = rest:gsub("^%.%d+", "")
    local offset = 0
    if rest ~= "" and rest ~= "Z" then
        local sign, oh, om = rest:match("^([+-])(%d%d):?(%d%d)$")
        if not sign then return nil end
        offset = (tonumber(oh) * 3600 + tonumber(om) * 60) * (sign == "-" and -1 or 1)
    end
    return daysFromCivil(tonumber(y), tonumber(mo), tonumber(d)) * 86400
        + tonumber(hh) * 3600 + tonumber(mm) * 60 + tonumber(ss) - offset
end

--- "05:31" in Europe/London for a true epoch.
function Clock.londonHHMM(epoch)
    local L = Clock.london(epoch)
    return string.format("%02d:%02d", L.hour, L.min)
end

Clock.pad2 = pad2

return Clock
