--[[--
A1 · Front page: the entry point of Early Edition.

Date line and "No. N", the sunrise masthead, the "Today's paper" card (read
count, stories and minutes, topic icons, FIRST UP with its photo when it
has one, a big Start reading button), four tiles (Back issues, My week, Word of the day, Check for news)
and the sources line.

Differs from the mockup on purpose: a "Close" button sits at the bottom
right next to the sources line, because a full-screen page needs a way out
for a child (swipe down and the Back key also close it).

The model comes from models.lua (Models.frontPage); this file only lays it out.
]]

local W = require("earlyeditionkids/ui/widgets")

local FrontPage = W.Page:extend{
    name = "eek_frontpage",
    model = nil,
    pad_top = 44,
    pad_bottom = 34,
    on_start = nil,        -- function(story or nil)
    on_headlines = nil,    -- function(): today's headline list
    on_back_issues = nil,
    on_my_week = nil,
    on_check = nil,
    on_sport = nil,        -- the Sport strip: Sport when open, else the next story to read
}

function FrontPage:card()
    local m = self.model
    local cw = self.content_w
    local border, ph, pv = 3, 40, 26
    local iw = cw - 2 * (W.px(border) + W.px(ph))
    local items = {}

    local title = W.Text{ text = m.card_title or "Today's paper", face = W.face(W.SERIF_BOLD, 44), max_width = iw * 0.65 }
    local count = m.read_text and W.Text{ text = m.read_text, face = W.face(W.SANS_BOLD, 28) } or nil
    local title_row = W.SplitRow(iw, title, count, "bottom")

    if not m.has_issue then
        table.insert(items, title_row)
        table.insert(items, W.TextBox{ text = "No news yet. It usually arrives early in the morning; tap below to look now.",
                                       face = W.face(W.SERIF, 30), color = W.SECONDARY, width = iw, bg = W.CARD })
        table.insert(items, W.Button{ text = "Check for news", filled = true, width = iw, height = 112, text_size = 40,
                                      icon_right = "refresh", icon_size = 44, callback = self.on_check })
        return W.Box{ content = W.VCol(items, W.px(26)), border = border, pad_h = ph, pad_v = pv, width = cw, background = W.CARD }
    end

    -- The card's top half (title, summary, topic icons) also opens the
    -- headline list, so the whole paper is one tap away, not only via a story.
    local header = { title_row, W.Text{ text = (m.fallback and "Stories you missed · " or "") .. m.summary,
                                        face = W.face(W.SANS, 30), color = W.SECONDARY, max_width = iw } }
    if m.topics and #m.topics > 0 then
        local size, gap = 60, 18
        local fit = math.max(1, math.floor((iw + W.px(gap)) / (W.px(size) + W.px(gap))))
        local icons = {}
        for i, t in ipairs(m.topics) do
            if i > fit then break end
            icons[#icons + 1] = W.TopicIcon(t, size)
        end
        header[#header + 1] = W.HRow(icons, W.px(gap))
    end
    table.insert(items, W.tappable(W.VCol(header, W.px(16)), self.on_headlines))

    local first = {}
    if m.first_up and m.first_up_photo then
        local s = m.first_up
        -- The whole photo (16:9) beside the label and headline; the photo stands in for the teaser.
        local pw, gap = W.px(330), W.px(28)
        local ph = math.floor(pw * W.PHOTO_H / W.PHOTO_W + 0.5)
        local tw = iw - pw - gap
        local label = W.Label("First up · " .. (s.topic or ""), 22, nil, tw)
        -- The headline keeps to the photo's height: a smaller size for a long one.
        local room = ph - label:getSize().h - W.px(10)
        local headline
        for _, n in ipairs({ 40, 36, 32, 28 }) do
            headline = W.TextBox{ text = s.title or "", face = W.face(W.SERIF_BOLD, n), width = tw, bg = W.CARD }
            if headline:getSize().h <= room then break end
        end
        local row = W.HRow({ W.Photo(m.first_up_photo, pw, ph), W.VCol({ label, headline }, W.px(10)) }, gap, "top")
        -- Like the iPad's lead photo, the photo and headline open the story.
        first = { W.tappable(row, function() if self.on_start then self.on_start(s) end end) }
    elseif m.first_up then
        local s = m.first_up
        first = {
            W.Label("First up · " .. (s.topic or ""), 22, nil, iw),
            W.FitLine{ text = s.title or "", file = W.SERIF_BOLD, n = 44, min_n = 34, width = iw, bg = W.CARD },
            W.Text{ text = s.teaser or "", face = W.face(W.SERIF, 28), color = W.SECONDARY, max_width = iw },
        }
    else
        first = {
            W.Label("All read", 22),
            W.TextBox{ text = "You have read every story in today's paper.", face = W.face(W.SERIF_BOLD, 40), width = iw, bg = W.CARD },
        }
    end
    table.insert(items, W.VCol({ W.Rule(iw, W.px(1)), W.VSpace(W.px(22) - W.px(8)), W.VCol(first, W.px(8)) }, W.px(8)))

    if m.all_read or not m.first_up then
        table.insert(items, W.Button{
            text = "See the headlines", filled = true, width = iw, height = 100, text_size = 40,
            icon_right = "arrow-right", icon_size = 40,
            callback = function() if self.on_headlines then self.on_headlines() end end,
        })
    else
        -- Two ways in: straight into the first unread story, or the full list.
        local gap = W.px(18)
        local start_w = math.floor((iw - gap) * 0.56)
        table.insert(items, W.HRow({
            W.Button{ text = "Start reading", filled = true, width = start_w, height = 100, text_size = 36,
                      icon_right = "arrow-right", icon_size = 36,
                      callback = function() if self.on_start then self.on_start(m.first_up) end end },
            W.Button{ text = "All headlines", width = iw - gap - start_w, height = 100, text_size = 32,
                      callback = function() if self.on_headlines then self.on_headlines() end end },
        }, gap))
    end
    return W.Box{ content = W.VCol(items, W.px(16)), border = border, pad_h = ph, pad_v = pv, width = cw, background = W.CARD }
end

local function tileText(title, sub, width)
    local col = { W.Text{ text = title, face = W.face(W.SERIF_BOLD, 34), max_width = width } }
    if sub then
        col[2] = W.Text{ text = sub, face = W.face(W.SANS, 24), color = W.SECONDARY, max_width = width }
    end
    return W.VCol(col, W.px(4))
end

function FrontPage:tiles()
    local m = self.model
    local cw = self.content_w
    local gap = W.px(18)
    local tw = math.floor((cw - gap) / 2)
    local border, ph, pv = 2, 28, 14
    local inner = tw - 2 * (W.px(border) + W.px(ph))
    local icon, igap = 60, W.px(22)
    local text_w = inner - W.px(icon) - igap

    local contents = {
        W.HRow({ W.Icon("backissues", icon), tileText("Back issues", "Yesterday and this week", text_w) }, igap),
        W.HRow({ W.Icon("calendar", icon), tileText("My week", "Stories, streak, words", text_w) }, igap),
    }
    if m.word then
        contents[3] = W.VCol({
            W.Label("Word of the day", 22, nil, inner),
            W.Text{ text = m.word.word, face = W.face(W.SERIF_BOLD, 34), max_width = inner },
            W.TextBox{ text = m.word.definition or "", face = W.face(W.SERIF, 22), color = W.SECONDARY,
                       width = inner, line_height = 0.1, height = math.ceil(W.px(22) * 1.5) * 2 },
        }, W.px(2))
    else
        contents[3] = W.VCol({
            W.Label("Word of the day", 22, nil, inner),
            W.Text{ text = "Not today", face = W.face(W.SERIF_BOLD, 34), max_width = inner },
        }, W.px(6))
    end
    -- On a day with Sport (docs/sports-page.md 2.5), Sport takes this tile and Check for
    -- news moves to the footer: the page has no room for another row. Never a score;
    -- closed, a padlock and how many more stories first.
    local sport = m.sport
    if sport then
        contents[4] = W.HRow({ sport.open and W.TopicIcon("Football", icon) or W.Icon("lock", icon),
                               tileText("Sport", sport.tile_sub, text_w) }, igap)
    else
        contents[4] = W.HRow({ W.Icon("refresh", icon), tileText("Check for news", m.updated or "Tap to look now", text_w) }, igap)
    end

    -- Each row as tall as its own tallest tile: the top row needs less than Word of the day,
    -- which leaves the page room for even gaps around the tiles.
    local function rowHeight(a, b)
        local h = W.px(124)
        for _, c in ipairs({ a, b }) do h = math.max(h, c:getSize().h + 2 * (W.px(border) + W.px(pv))) end
        return h
    end
    local h1, h2 = rowHeight(contents[1], contents[2]), rowHeight(contents[3], contents[4])
    local function tile(content, callback, h)
        local box = W.Box{ content = content, border = border, pad_h = ph, pad_v = pv, width = tw, min_height = h }
        return callback and W.tappable(box, callback) or box
    end
    return W.VCol({
        W.HRow({ tile(contents[1], self.on_back_issues, h1), tile(contents[2], self.on_my_week, h1) }, gap),
        W.HRow({ tile(contents[3], nil, h2), tile(contents[4], sport and function() if self.on_sport then self.on_sport(sport.open) end end
                                                         or self.on_check, h2) }, gap),
    }, gap)
end

function FrontPage:footer()
    local cw = self.content_w
    local close = W.Button{ text = "Close", width = W.px(170), height = 90, text_size = 28, border = 2,
                            callback = function() self:onClose() end }
    local text_w = cw - close:getSize().w - W.px(24)
    if self.model.sport then
        -- Sport has the tile: Check for news is here instead, with when the paper came.
        local check = W.Button{ text = "Check for news", icon_left = "refresh", icon_size = 30, height = 90, text_size = 26, border = 2,
                                callback = function() if self.on_check then self.on_check() end end }
        local updated = W.Text{ text = self.model.updated or "", face = W.face(W.SANS, 22), color = W.SECONDARY }
        local left = W.HRow({ check, updated }, W.px(20))
        return W.SplitRow(cw, left, close, "center")
    end
    local sources = W.TextBox{ text = self.model.sources_text or "", face = W.face(W.SANS, 22),
                               color = W.SECONDARY, width = text_w }
    return W.SplitRow(cw, sources, close, "center")
end

function FrontPage:build()
    local m = self.model or {}
    local cw = self.content_w
    -- A photo in the card: a little less air around it, so the page still fits.
    local tight = m.first_up_photo ~= nil
    local masthead = W.VCol({
        W.Image(W.iconPath("sunrise"), W.px(152), W.px(64)),
        W.VSpace(W.px(8)),
        W.DisplayText("Early Edition", 100, cw),
        W.VSpace(W.px(16)),
        W.Label("The news, written for you", 24),
    }, 0, "center")
    local items = {
        W.SplitRow(cw, W.Label(m.date_line or "", 24), m.number_text and W.Label(m.number_text, 24) or nil),
        { space = 16 },
        W.Rule(cw, W.px(2)),
        { space = 22 },
        W.Fixed(masthead, cw, nil, "center"),
        { space = 16 },
        W.DoubleRule(cw),
        { space = tight and 18 or 30 },
        self:card(),
        { space = tight and 18 or 26 },
        self:tiles(),
    }
    local tail = {
        { flex = true },
        { space = 16 },
        self:footer(),
    }
    for _, it in ipairs(tail) do items[#items + 1] = it end
    return items
end

return FrontPage
