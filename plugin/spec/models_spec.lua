local H = require("helpers")
local Clock = require("earlyeditionkids/clock")
local Icons = require("earlyeditionkids/icons")
local Models = require("earlyeditionkids/models")
local StoryInfo = require("earlyeditionkids/storyinfo")
local describe, it, eq, truthy, falsy = H.describe, H.it, H.eq, H.truthy, H.falsy

local function stories(n)
    local out = {}
    for i = 1, n do
        out[i] = { id = 40 + i, position = i, topic = "Space", title = "Story " .. (40 + i), minutes = 2 }
    end
    return out
end

describe("first unread", function()
    it("is the first story not read, in position order", function()
        local s = stories(4)
        eq(Models.firstUnread(s, {}).id, 41)
        eq(Models.firstUnread(s, { ["41"] = true, ["43"] = true }).id, 42)
    end)
    it("is nil when everything is read", function()
        local s = stories(2)
        eq(Models.firstUnread(s, { ["41"] = true, ["42"] = true }), nil)
        eq(Models.firstUnread({}, {}), nil)
    end)
end)

describe("word of the day", function()
    local words = { [41] = { word = "Cap", definition = "a game for your country" },
                    [43] = { word = "Reusable", definition = "able to be used again" } }
    local function wordFor(s) return words[s.id] end

    it("is the first unread story's word", function()
        local w = Models.wordOfTheDay(stories(4), { ["41"] = true, ["42"] = true }, wordFor)
        eq(w.word, "Reusable"); eq(w.story.id, 43)
    end)
    it("falls back to the first story's word when the first unread has none", function()
        local w = Models.wordOfTheDay(stories(4), { ["41"] = true }, wordFor) -- first unread is 42, no word
        eq(w.word, "Cap")
    end)
    it("falls back to the first story's word when all are read", function()
        local w = Models.wordOfTheDay(stories(4), { ["41"] = true, ["42"] = true, ["43"] = true, ["44"] = true }, wordFor)
        eq(w.word, "Cap")
    end)
    it("is nil when no story has a word", function()
        eq(Models.wordOfTheDay(stories(2), {}, function() return nil end), nil)
    end)
    it("prefers the API field, else parses the story page", function()
        local html = '<div class="box">\n<p class="label">WORD TO KNOW</p>\n<p><b>Cold stunning</b>: When a sea turtle gets so cold that it becomes weak, slow and dazed.</p>\n</div>'
        local from_page = Models.wordFor({ id = 1 }, function() return html end)
        eq(from_page.word, "Cold stunning")
        eq(from_page.definition, "When a sea turtle gets so cold that it becomes weak, slow and dazed.")
        local from_api = Models.wordFor({ id = 1, word_to_know = { word = "ceremony", definition = "a special event." } },
                                        function() return html end)
        eq(from_api.word, "ceremony")
        -- API null (decoded as nil) falls back to the page.
        eq(Models.wordFor({ id = 1, word_to_know = nil }, function() return html end).word, "Cold stunning")
    end)
end)

describe("story page parsing", function()
    it("reads the source line and decodes entities", function()
        eq(StoryInfo.source('<p class="source">Source: BBC Newsround</p>'), "BBC Newsround")
        eq(StoryInfo.source('<p class="source">Source: Science News Explores &amp; friends</p>'), "Science News Explores & friends")
        eq(StoryInfo.source("<p>nothing</p>"), nil)
        local w = StoryInfo.wordToKnow('<p class="label">WORD TO KNOW</p><p><b>Captain&#39;s armband</b>: a band the captain wears.</p>')
        eq(w.word, "Captain's armband")
        eq(StoryInfo.wordToKnow("<p>no box</p>"), nil)
    end)
end)

describe("edition number", function()
    it("uses the API number when present", function()
        eq(Models.editionNumber({ number = 12 }, { "2026-11-13" }, "2026-11-13"), 12)
    end)
    it("else counts the issues on the device up to this date", function()
        local dates = { "2026-11-13", "2026-11-12", "2026-11-10" }
        eq(Models.editionNumber({}, dates, "2026-11-13"), 3)
        eq(Models.editionNumber({}, dates, "2026-11-12"), 2)
        eq(Models.editionNumber(nil, {}, "2026-11-13"), 1)
    end)
end)

describe("updated time", function()
    it("uses created_at in London time", function()
        eq(Models.updatedText({ created_at = "2026-11-13T05:31:07+00:00" }, {}, 0), "Updated 05:31")
        eq(Models.updatedText({ created_at = "2026-07-01T04:31:07Z" }, {}, 0), "Updated 05:31") -- BST
        eq(Models.updatedText({ created_at = "2026-11-13T06:31:07.123+01:00" }, {}, 0), "Updated 05:31")
    end)
    it("else the download time corrected by the clock skew", function()
        local true_epoch = Clock.parseIso("2026-11-13T07:02:00Z")
        eq(Models.updatedText({}, { downloaded_at = true_epoch - 3600 }, 3600), "Updated 07:02")
        eq(Models.updatedText({}, {}, 0), nil)
    end)
end)

describe("front page model", function()
    it("counts, topics, first up, word, sources", function()
        local s = stories(6)
        s[1].topic = "Football"
        local m = Models.frontPage{
            date = "2026-11-13", today = "2026-11-13",
            idx = { number = 3, created_at = "2026-11-13T05:31:00Z" },
            stories = s, state = { read = { ["41"] = true } },
            stored_dates = { "2026-11-13" },
            wordFor = function(st) return st.id == 42 and { word = "Orbit", definition = "a path" } or nil end,
            sourceFor = function(st) return st.id % 2 == 0 and "BBC Newsround" or "BBC Sport" end,
        }
        eq(m.read_text, "1 of 6 read")
        eq(m.summary, "6 stories · about 12 minutes")
        eq(m.number_text, "NO. 3")
        eq(m.first_up.id, 42)
        eq(m.word.word, "Orbit")
        eq(m.updated, "Updated 05:31")
        eq(m.sources_text, "Sources: BBC Sport · BBC Newsround")
        eq(m.topics[1], "Football")
        eq(m.card_title, "Today's paper")
        falsy(m.all_read)
    end)
    it("an older newest issue is the latest paper; no issue at all is handled", function()
        local m = Models.frontPage{ date = "2026-11-12", today = "2026-11-13", idx = {}, stories = stories(1),
                                    state = { read = { ["41"] = true } }, stored_dates = { "2026-11-12" } }
        eq(m.card_title, "Latest paper")
        truthy(m.all_read)
        local none = Models.frontPage{ today = "2026-11-13" }
        falsy(none.has_issue)
        eq(none.date_line, "FRIDAY 13 NOVEMBER 2026")
    end)
end)

describe("back issues", function()
    it("labels today, counts and all read", function()
        local sums = {
            ["2026-11-13"] = { total = 6, read = 1, lead = "Harry Kane" },
            ["2026-11-12"] = { total = 6, read = 6, lead = "Why is it cold?" },
        }
        local rows = Models.backIssues{ dates = { "2026-11-13", "2026-11-12" }, current = "2026-11-13",
                                        summaryFor = function(d) return sums[d] end }
        eq(rows[1].label, "TODAY · 6 STORIES"); eq(rows[1].read_text, "1 of 6"); truthy(rows[1].highlight)
        eq(rows[1].dow, "FRI"); eq(rows[1].day, "13")
        eq(rows[2].label, "6 STORIES"); eq(rows[2].read_text, "All read"); falsy(rows[2].highlight)
        eq(rows[2].dow, "THU")
    end)
end)

describe("my week", function()
    -- Friday 13 November 2026: the week is Monday 9 to Sunday 15.
    local function e(day, id, topic, finished, word)
        return { date = day, day = day, story_id = id, topic = topic, finished = finished ~= false, word = word }
    end

    it("counts finished stories per day, Monday to Sunday", function()
        local entries = {
            e("2026-11-08", 1, "Space"),                  -- Sunday before: not this week
            e("2026-11-10", 2, "Football", true, "Cap"),
            e("2026-11-10", 3, "Football"),
            e("2026-11-10", 3, "Football"),               -- re-read: once
            e("2026-11-11", 4, "Science", true, "Reusable"),
            e("2026-11-12", 5, "Space", false),           -- not finished: does not count
            e("2026-11-13", 6, "Football", true, "Cap"),  -- word seen already
        }
        local m = Models.myWeek(entries, "2026-11-13")
        eq(m.range, "Monday 9 to Sunday 15 November")
        local counts = {}
        for i, d in ipairs(m.days) do counts[i] = d.name .. "=" .. tostring(d.count) .. "/" .. d.when end
        eq(table.concat(counts, " "),
           "MON=0/past TUE=2/past WED=1/past THU=0/past FRI=1/today SAT=nil/future SUN=nil/future")
        eq(m.total, 4)
        eq(m.topics[1].name, "Football"); eq(m.topics[1].n, 3)
        eq(m.topics[2].name, "Science")
        eq(table.concat(m.words, ","), "Cap,Reusable")
        falsy(m.empty)
    end)

    it("days in a row end today or yesterday and cross week boundaries", function()
        local entries = { e("2026-11-07", 1), e("2026-11-08", 2), e("2026-11-09", 3), e("2026-11-10", 4) }
        -- Today (Wednesday 11th) nothing yet: the streak still counts to yesterday.
        eq(Models.myWeek(entries, "2026-11-11").streak, 4)
        -- A missed day ends it, without fuss.
        eq(Models.myWeek(entries, "2026-11-12").streak, 0)
        table.insert(entries, e("2026-11-11", 5))
        eq(Models.myWeek(entries, "2026-11-11").streak, 5)
    end)

    it("uses the issue date for old log entries without a reading day", function()
        local m = Models.myWeek({ { date = "2026-11-12", story_id = 9, topic = "Space", finished = true } }, "2026-11-13")
        eq(m.days[4].count, 1)
    end)

    it("is empty before the first story of the week", function()
        local m = Models.myWeek({}, "2026-11-13")
        truthy(m.empty)
        eq(m.total, 0); eq(m.streak, 0)
        eq(#m.days, 7)
    end)

    it("handles a week across two months", function()
        eq(Models.myWeek({}, "2026-11-01").range, "Monday 26 October to Sunday 1 November")
    end)
end)

describe("clock additions", function()
    it("Monday of the week and ISO parsing", function()
        eq(Clock.mondayOf("2026-11-13"), "2026-11-09")
        eq(Clock.mondayOf("2026-11-09"), "2026-11-09")
        eq(Clock.mondayOf("2026-11-15"), "2026-11-09")
        eq(Clock.parseIso("bad"), nil)
        eq(Clock.mastheadDate("2026-11-13"), "FRIDAY 13 NOVEMBER 2026")
    end)
end)

describe("icons", function()
    it("maps every topic, with a fallback", function()
        for _, t in ipairs({ "Football", "Science", "Space", "Animals and nature", "Games and tech", "Weather", "Weird but true" }) do
            truthy(Icons.forTopic(t) ~= Icons.FALLBACK_TOPIC, t)
        end
        eq(Icons.forTopic("Cooking"), Icons.FALLBACK_TOPIC)
        eq(Icons.forTopic(nil), Icons.FALLBACK_TOPIC)
    end)
    it("recolours and draws the stamp with paths only (no <text>)", function()
        eq(Icons.recolor('<path stroke="#121212"/>', "#FFFFFF"), '<path stroke="#FFFFFF"/>')
        local svg = Icons.stampSvg("13 NOV")
        falsy(svg:find("<text", 1, true))
        truthy(svg:find("rotate(-8 60 60)", 1, true))
        -- Every character of the date has a glyph.
        for ch in ("0123456789 JANFEBMARAPRMAYJUNJULAUGSEPOCTNOVDECREAD"):gmatch(".") do
            truthy(ch == " " or Icons.GLYPHS[ch], "glyph " .. ch)
        end
    end)
end)
