--[[--
A2 · Today's paper: the headline list (DESIGN 5.2, mockup A-Headlines).

Header: "Early Edition", "date · N stories · about M minutes", "N of M read"
with progress dots. One row per story: topic icon in a circle, label,
headline, teaser, and a boxed "2 min" chip, or a filled tick once read (read
rows are greyed). While today's Sport is closed, a story read to the end too
quickly to count for it has a fast-forward mark instead of the tick, is not
greyed, and says so in place of its teaser. Footer: Front page / Back issues.

Rows that do not fit (a parent can add stories during the day) go on further
pages, reached by a tappable "N more stories" row at the bottom and a "Back"
row at the top, or by swiping left/right.

Model (controller.lua headlineModel):
  { subtitle, read_text, read, total, stories = { { topic, title, teaser,
    minutes_text, done, too_fast, story } }, empty_text, date }
]]

local W = require("earlyeditionkids/ui/widgets")

local HeadlinesScreen = W.Page:extend{
    name = "eek_headlines",
    model = nil,
    page = 1,
    pad_top = 48,
    pad_bottom = 40,
    on_story = nil,        -- function(story)
    on_front_page = nil,
    on_back_issues = nil,
}

function HeadlinesScreen:init()
    self.on_swipe = function(dir)
        if dir == "west" then self:nextPage() return true end
        if dir == "east" then self:prevPage() return true end
        return false
    end
    W.Page.init(self)
end

function HeadlinesScreen:header()
    local m = self.model
    local cw = self.content_w
    local right = W.VCol({
        W.Text{ text = m.read_text or "", face = W.face(W.SANS_BOLD, 28) },
        W.Dots(m.total or 0, m.read or 0, 22, 2, 8, cw * 0.35),
    }, W.px(10), "right")
    local left_w = cw - right:getSize().w - W.px(24)
    local left = W.VCol({
        W.DisplayText("Early Edition", 68, left_w),
        W.Text{ text = m.subtitle or "", face = W.face(W.SANS, 26), color = W.SECONDARY, max_width = left_w },
    }, W.px(6))
    return W.SplitRow(cw, left, right, "bottom")
end

local function chip(text)
    return W.Box{ content = W.Text{ text = text, face = W.face(W.SANS_BOLD, 28) }, border = 2, pad_h = 14, pad_v = 6 }
end

--- One story row (also used for the page navigation rows).
--- Width left for the text column of a row whose right-hand item is `right_w` wide.
function HeadlinesScreen:textWidth(right_w)
    return self.content_w - W.px(88) - right_w - 2 * W.px(28)
end

function HeadlinesScreen:row(item, extra)
    local cw = self.content_w
    local fast = item.too_fast
    local done = item.done and not fast
    local fg = done and W.GREYED or W.INK
    local right
    if item.nav then
        right = W.Icon(item.nav == "next" and "arrow-right" or "arrow-left", 48)
    elseif fast then
        right = W.Icon("too-fast", 64)
    elseif done then
        right = W.Icon("tick", 64)
    else
        right = chip(item.minutes_text or "")
    end
    local icon = item.nav and W.Icon(item.nav == "next" and "arrow-right" or "arrow-left", 88)
                 or W.TopicIcon(item.topic, 88, done and W.ICON_GREY or nil)
    local gap = W.px(28)
    local text_w = cw - W.px(88) - right:getSize().w - 2 * gap
    local col = {}
    if item.topic and not item.nav then col[#col + 1] = W.Label(item.topic, 20, done and W.GREYED or nil, text_w) end
    -- All headlines share one size (self.title_n, worked out in build) so the
    -- list reads evenly; a headline still too long at that size wraps.
    local tn = item.nav and 40 or (self.title_n or 42)
    col[#col + 1] = W.FitLine{ text = item.title or "", file = W.SERIF_BOLD, n = tn, min_n = tn, width = text_w, color = fg }
    if fast then
        col[#col + 1] = W.Text{ text = "Read too fast to count for Sport", face = W.face(W.SANS_BOLD, 24),
                                color = W.INK, max_width = text_w }
    elseif item.teaser and item.teaser ~= "" then
        col[#col + 1] = W.Text{ text = item.teaser, face = W.face(W.SANS, 24),
                                color = done and W.GREYED or W.SECONDARY, max_width = text_w }
    end
    local text = W.VCol(col, W.px(4))
    local pad = W.px(18) + math.floor((extra or 0) / 2)
    local inner_h = math.max(text:getSize().h, W.px(88), W.px(140) - 2 * pad)
    local line = W.HRow({
        W.Fixed(icon, W.px(88), inner_h, "left"),
        W.Fixed(text, text_w, inner_h, "left"),
        W.Fixed(right, right:getSize().w, inner_h, "right"),
    }, gap)
    local block = W.VCol({ W.VSpace(pad), line, W.VSpace(pad), W.Rule(cw, W.px(1)) }, 0)
    return W.tappable(block, item.callback)
end

function HeadlinesScreen:footer()
    local cw = self.content_w
    local gap = W.px(20)
    local bw = math.floor((cw - gap) / 2)
    return W.VCol({
        W.DoubleRule(cw),
        W.VSpace(W.px(24)),
        W.HRow({
            W.Button{ text = "Front page", icon_left = "arrow-left", width = bw, height = 96,
                      callback = function() if self.on_front_page then self.on_front_page() end end },
            W.Button{ text = "Back issues", width = bw, height = 96,
                      callback = function() if self.on_back_issues then self.on_back_issues() end end },
        }, gap),
    }, 0)
end

function HeadlinesScreen:build()
    local m = self.model or {}
    local cw = self.content_w
    local header = self:header()
    local footer = self:footer()
    local avail = self.dimen.h - W.px(self.pad_top) - W.px(self.pad_bottom)
                  - header:getSize().h - W.px(22) - W.px(6) - footer:getSize().h

    local items = {}
    for _, it in ipairs(m.stories or {}) do
        items[#items + 1] = {
            topic = it.topic, title = it.title, teaser = it.teaser, minutes_text = it.minutes_text,
            done = it.done, too_fast = it.too_fast,
            callback = function() if self.on_story then self.on_story(it.story) end end,
        }
    end

    -- One headline size for the whole list: the largest (42 down to 32) at
    -- which every headline fits on one line.
    local chip_w = chip("9 min"):getSize().w
    local title_w = self:textWidth(math.max(chip_w, W.px(64)))
    self.title_n = 42
    for _, it in ipairs(items) do
        local _, n = W.fitFace(it.title or "", W.SERIF_BOLD, 42, title_w, 32)
        self.title_n = math.min(self.title_n, n)
    end

    local rows, total_h = {}, 0
    for i, it in ipairs(items) do
        rows[i] = self:row(it)
        total_h = total_h + rows[i]:getSize().h
    end
    -- Everything fits on one page: share the spare height out as row padding
    -- (rows stay at most about 190 px, like the mockup's 150 px minimum).
    if total_h <= avail and #items > 0 then
        local extra = math.floor((avail - total_h) / #items)
        extra = math.min(extra, math.max(0, W.px(190) - rows[1]:getSize().h))
        if extra > 1 then
            for _, r in ipairs(rows) do r:free() end
            total_h = 0
            for i, it in ipairs(items) do
                rows[i] = self:row(it, extra)
                total_h = total_h + rows[i]:getSize().h
            end
        end
    end

    local pages, heights = { {} }, { 0 }
    local page_avail = avail
    if total_h > avail then
        local probe = self:row{ nav = "next", title = "More stories" }
        page_avail = avail - 2 * probe:getSize().h
        probe:free()
    end
    for _, row in ipairs(rows) do
        local h = row:getSize().h
        if #pages[#pages] > 0 and heights[#pages] + h > page_avail then
            pages[#pages + 1] = {}
            heights[#pages] = 0
        end
        table.insert(pages[#pages], row)
        heights[#pages] = heights[#pages] + h
    end
    self.page_count = #pages
    self.page = math.max(1, math.min(self.page, self.page_count))

    local body = {}
    self.page_rows = {} -- { kind = "story"|"next"|"prev", widget } (for tests and the tour)
    if #items == 0 then
        body[1] = W.Fixed(W.TextBox{ text = m.empty_text or "No news yet.", face = W.face(W.SERIF, 32),
                                     width = cw, align = "center" }, cw, avail, "center")
    else
        local cur = pages[self.page]
        if self.page > 1 then
            body[#body + 1] = self:row{ nav = "prev", title = "Back to the first stories",
                                        teaser = string.format("Page %d of %d", self.page, self.page_count),
                                        callback = function() self:prevPage() end }
            table.insert(self.page_rows, 1, { kind = "prev", widget = body[#body] })
        end
        for _, r in ipairs(cur) do
            body[#body + 1] = r
            self.page_rows[#self.page_rows + 1] = { kind = "story", widget = r }
        end
        if self.page < self.page_count then
            local left = 0
            for p = self.page + 1, self.page_count do left = left + #pages[p] end
            body[#body + 1] = self:row{ nav = "next",
                                        title = left == 1 and "1 more story" or (left .. " more stories"),
                                        teaser = string.format("Page %d of %d", self.page, self.page_count),
                                        callback = function() self:nextPage() end }
            self.page_rows[#self.page_rows + 1] = { kind = "next", widget = body[#body] }
        end
    end

    local list = { header, { space = 22 }, W.DoubleRule(cw) }
    for _, b in ipairs(body) do list[#list + 1] = b end
    list[#list + 1] = { flex = true }
    list[#list + 1] = footer
    return list
end

function HeadlinesScreen:nextPage()
    if self.page < (self.page_count or 1) then
        self.page = self.page + 1
        self:refresh("ui")
    end
end

function HeadlinesScreen:prevPage()
    if self.page > 1 then
        self.page = self.page - 1
        self:refresh("ui")
    end
end

return HeadlinesScreen
