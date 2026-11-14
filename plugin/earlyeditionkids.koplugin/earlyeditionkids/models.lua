--[[--
View models for the Early Edition screens: plain data worked out from the
issue index, the per-issue state and the reading log. No KOReader
dependency, so all of the choices below are covered by the specs.

- Models.firstUnread       "FIRST UP" on the front page, the Start reading target
- Models.wordOfTheDay      the front page's Word of the day tile
- Models.editionNumber     "No. N" (API `number`, else issues on the device)
- Models.updatedText       "Updated 05:31" (API `created_at`, else download time)
- Models.frontPage         everything on the front page
- Models.backIssues        the back-issue cards
- Models.myWeek            "My week", from the reading log only
]]

local Clock = require("earlyeditionkids/clock")
local ReadingLog = require("earlyeditionkids/readinglog")
local Store = require("earlyeditionkids/store")
local StoryInfo = require("earlyeditionkids/storyinfo")

local Models = {}

local function key(id) return Store.idKey(id) end

--- First story (in position order) not yet read, or nil when all are read.
-- `read` is a set keyed by story id key ("41").
function Models.firstUnread(stories, read)
    for _, s in ipairs(stories or {}) do
        if not (read and read[key(s.id)]) then return s end
    end
    return nil
end

--[[--
Word of the day. The first unread story's word, else the first story's word
(both in position order; stories without a word are skipped in the fallback).
`wordFor(story)` returns { word, definition } or nil; it prefers the API's
`word_to_know` and falls back to the story page's box (see controller).
Returns { word, definition, story } or nil.
]]
function Models.wordOfTheDay(stories, read, wordFor)
    local first = Models.firstUnread(stories, read)
    if first then
        local w = wordFor(first)
        if w then return { word = w.word, definition = w.definition, story = first } end
    end
    for _, s in ipairs(stories or {}) do
        local w = wordFor(s)
        if w then return { word = w.word, definition = w.definition, story = s } end
    end
    return nil
end

--- Edition number: the API's `number`, else how many issues on the device
-- are dated on or before this one (at least 1).
function Models.editionNumber(idx, stored_dates, date)
    local n = idx and tonumber(idx.number)
    if n and n > 0 then return math.floor(n) end
    local count = 0
    for _, d in ipairs(stored_dates or {}) do
        if d <= date then count = count + 1 end
    end
    return math.max(1, count)
end

--- "Updated HH:MM" (Europe/London) from the API's `created_at`, else from the
-- time we downloaded it (device clock + skew). nil if neither is known.
function Models.updatedText(idx, state, skew)
    local epoch = idx and Clock.parseIso(idx.created_at)
    if not epoch and state and state.downloaded_at then
        epoch = Clock.estimate(state.downloaded_at, skew)
    end
    if not epoch then return nil end
    return "Updated " .. Clock.londonHHMM(epoch)
end

--- Distinct source names, in story order.
function Models.sources(stories, sourceFor)
    local out, seen = {}, {}
    for _, s in ipairs(stories or {}) do
        local src = sourceFor(s)
        if src and not seen[src] then
            seen[src] = true
            out[#out + 1] = src
        end
    end
    return out
end

local function plural(n, one, many)
    return n == 1 and ("1 " .. one) or (n .. " " .. many)
end
Models.plural = plural

--- "6 stories · about 12 minutes"
function Models.storiesLine(n, minutes)
    return plural(n, "story", "stories") .. " · about " .. plural(minutes, "minute", "minutes")
end

--[[--
Front page model.

opts: date (issue date or nil), today, idx (index or nil), stories (visible,
position order), state (issue state), stored_dates, wordFor, sourceFor, skew
]]
function Models.frontPage(opts)
    local m = {}
    local date = opts.date or opts.today
    m.date_line = Clock.mastheadDate(date)
    m.has_issue = opts.idx ~= nil
    if not m.has_issue then
        m.number_text = nil
        m.card_title = "Today's paper"
        return m
    end
    local stories = opts.stories or {}
    local read = opts.state and opts.state.read or {}
    m.number = Models.editionNumber(opts.idx, opts.stored_dates, date)
    m.number_text = "NO. " .. m.number
    m.card_title = (date == opts.today) and "Today's paper" or "Latest paper"
    m.total = #stories
    m.read = 0
    m.minutes = 0
    m.topics = {}
    for _, s in ipairs(stories) do
        if read[key(s.id)] then m.read = m.read + 1 end
        m.minutes = m.minutes + (tonumber(s.minutes) or 1)
        m.topics[#m.topics + 1] = s.topic
    end
    m.read_text = string.format("%d of %d read", m.read, m.total)
    m.summary = Models.storiesLine(m.total, m.minutes)
    m.first_up = Models.firstUnread(stories, read)
    m.all_read = m.total > 0 and m.first_up == nil
    m.word = Models.wordOfTheDay(stories, read, opts.wordFor or function() return nil end)
    m.updated = Models.updatedText(opts.idx, opts.state, opts.skew)
    local sources = Models.sources(stories, opts.sourceFor or function() return nil end)
    if #sources > 0 then m.sources_text = "Sources: " .. table.concat(sources, " · ") end
    m.fallback = opts.idx.fallback and true or false
    return m
end

--[[--
Back-issue cards, newest first. opts: dates (stored, newest first),
current (the newest issue date), summaryFor(date) -> { total, read, lead }.
]]
function Models.backIssues(opts)
    local rows = {}
    for _, date in ipairs(opts.dates or {}) do
        local sum = opts.summaryFor(date)
        local _, _, d = Clock.parseDate(date)
        local is_current = date == opts.current
        local stories_text = string.upper(plural(sum.total, "story", "stories"))
        rows[#rows + 1] = {
            date = date,
            dow = Clock.WEEKDAY_ABBR[Clock.weekday(date)],
            day = tostring(d),
            label = is_current and (opts.current_is_today == false and "LATEST · " or "TODAY · ") .. stories_text
                    or stories_text,
            lead = sum.lead or "",
            read = sum.read,
            total = sum.total,
            read_text = (sum.total > 0 and sum.read >= sum.total) and "All read"
                        or string.format("%d of %d", sum.read, sum.total),
            highlight = is_current,
        }
    end
    return rows
end

--[[--
"My week": Monday to Sunday of the week containing `today`, from the
reading log only. A story counts on a day when he reached its end that day.

Returns {
  range = "Monday 9 to Sunday 15 November",
  days = { { name = "MON", date, count, when = "past"|"today"|"future" } x7 },
  total = stories finished this week (distinct),
  streak = days in a row ending today or yesterday,
  topics = { { name, n } } most read first,
  words = { "Cold stunning", ... } from stories finished this week,
  empty = true when nothing was finished this week,
}
]]
function Models.myWeek(entries, today)
    local monday = Clock.mondayOf(today)
    local sunday = Clock.addDays(monday, 6)
    local m = { range = Clock.weekRange(monday), days = {}, topics = {}, words = {} }

    local per_day, seen_day = {}, {}
    local seen_week, topic_n, word_seen = {}, {}, {}
    m.total = 0
    for _, e in ipairs(entries or {}) do
        local d = ReadingLog.dayOf(e)
        if e.finished and d and d >= monday and d <= sunday then
            local id = tostring(e.story_id)
            seen_day[d] = seen_day[d] or {}
            if not seen_day[d][id] then
                seen_day[d][id] = true
                per_day[d] = (per_day[d] or 0) + 1
            end
            if not seen_week[id] then
                seen_week[id] = true
                m.total = m.total + 1
                if e.topic then topic_n[e.topic] = (topic_n[e.topic] or 0) + 1 end
                if e.word and e.word ~= "" and not word_seen[e.word] then
                    word_seen[e.word] = true
                    m.words[#m.words + 1] = e.word
                end
            end
        end
    end

    for i = 0, 6 do
        local d = Clock.addDays(monday, i)
        local when = (d < today) and "past" or ((d == today) and "today" or "future")
        m.days[#m.days + 1] = {
            name = Clock.WEEKDAY_ABBR[(i + 1) % 7],
            date = d,
            count = (when ~= "future") and (per_day[d] or 0) or nil,
            when = when,
        }
    end

    for name, n in pairs(topic_n) do m.topics[#m.topics + 1] = { name = name, n = n } end
    table.sort(m.topics, function(a, b)
        if a.n ~= b.n then return a.n > b.n end
        return a.name < b.name
    end)

    local log = ReadingLog.new{ load = function() return { entries = entries or {} } end, save = function() end }
    m.streak = log:streak(today)
    m.empty = m.total == 0
    return m
end

--- Word for a story: the API field, else the parsed page (via readFile).
function Models.wordFor(story, readFile)
    local w = StoryInfo.apiWord(story.word_to_know)
    if w then return w end
    if readFile then return StoryInfo.wordToKnow(readFile(story)) end
    return nil
end

return Models
