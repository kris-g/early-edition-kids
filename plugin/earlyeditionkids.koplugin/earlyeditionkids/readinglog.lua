--[[--
The on-device reading log (DESIGN 5.1 step 8, 5.5).

One entry per closed story:

    { date = "2026-11-13", story_id = 41, topic = "Football",
      title = "...", active_seconds = 95, finished = true, ts = <device epoch>,
      day = "2026-11-14",            -- Europe/London day he read it (clock-skew corrected)
      word = "Cold stunning" }       -- the story's word to know, if any

`day` and `word` were added for "My week"; older entries without `day` count
on their issue `date`.

It is a separate settings file from the state store, is never cleared by an
event upload, is never touched by the 7-day issue tidy, and keeps a year of
entries. It is what the later stats screen for the child will read, so the
small query helpers live here too.
]]

local Clock = require("earlyeditionkids/clock")
local Const = require("earlyeditionkids/const")

local ReadingLog = {}
ReadingLog.__index = ReadingLog

function ReadingLog.new(backend)
    local self = setmetatable({ backend = backend }, ReadingLog)
    local ok, data = pcall(backend.load)
    self.data = (ok and type(data) == "table") and data or {}
    self.data.entries = self.data.entries or {}
    return self
end

function ReadingLog:entries()
    return self.data.entries
end

function ReadingLog:save()
    self.backend.save(self.data)
end

function ReadingLog:append(entry)
    table.insert(self.data.entries, {
        date = entry.date,
        story_id = entry.story_id,
        topic = entry.topic,
        title = entry.title,
        active_seconds = entry.active_seconds or 0,
        finished = entry.finished and true or false,
        ts = entry.ts,
        day = entry.day,
        word = entry.word,
    })
end

--- Drops entries older than a year before `today` (an ISO date).
-- Entries are judged by their issue date, which came from the server, not
-- by the device clock. Returns the number removed.
function ReadingLog:prune(today, keep_days)
    keep_days = keep_days or Const.LOG_KEEP_DAYS
    local cutoff = Clock.addDays(today, -keep_days)
    if not cutoff then return 0 end
    local kept, removed = {}, 0
    for _, e in ipairs(self.data.entries) do
        if type(e.date) == "string" and e.date < cutoff then
            removed = removed + 1
        else
            table.insert(kept, e)
        end
    end
    self.data.entries = kept
    return removed
end

--- Drops entries read before `since` (ISO date), after a reading reset on the
-- server (CONTRACT "Reading since"). Returns the number removed.
function ReadingLog:dropBefore(since)
    if type(since) ~= "string" then return 0 end
    local kept, removed = {}, 0
    for _, e in ipairs(self.data.entries) do
        local d = ReadingLog.dayOf(e)
        if type(d) == "string" and d < since then
            removed = removed + 1
        else
            table.insert(kept, e)
        end
    end
    self.data.entries = kept
    return removed
end

--- Distinct stories finished on or after `since` (ISO date). For the stats screen.
function ReadingLog:finishedSince(since)
    local seen, n = {}, 0
    for _, e in ipairs(self.data.entries) do
        if e.finished and e.date and e.date >= since and not seen[e.story_id] then
            seen[e.story_id] = true
            n = n + 1
        end
    end
    return n
end

--- Count of finished stories per topic, for the stats screen.
function ReadingLog:topicCounts()
    local counts, seen = {}, {}
    for _, e in ipairs(self.data.entries) do
        if e.finished and e.topic and not seen[e.story_id] then
            seen[e.story_id] = true
            counts[e.topic] = (counts[e.topic] or 0) + 1
        end
    end
    return counts
end

--- The day an entry counts on: when he read it, else its issue date.
function ReadingLog.dayOf(e)
    return e.day or e.date
end

--- Consecutive days, ending today or yesterday, on which he reached the end
-- of at least one story.
function ReadingLog:streak(today)
    local days = {}
    for _, e in ipairs(self.data.entries) do
        local d = ReadingLog.dayOf(e)
        if e.finished and d then days[d] = true end
    end
    local d = today
    if not days[d] then d = Clock.addDays(today, -1) end
    local n = 0
    while d and days[d] do
        n = n + 1
        d = Clock.addDays(d, -1)
    end
    return n
end

return ReadingLog
