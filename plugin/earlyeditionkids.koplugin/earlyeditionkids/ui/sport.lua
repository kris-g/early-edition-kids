--[[--
Sport (docs/sports-page.md, mockups in docs/mockups/sports-page/): the
Premier League page, one screen per tab and no scrolling.

  Matches  the latest matchday by day; a played match opens (→ ui/sportmatch.lua)
  Table    ten clubs a page (1 to 10, 11 to 20), opening on his club's half
  Next     the next matchday's fixtures

While Sport is closed (read first, section 2.7) the same page shows the
padlock, how many stories are needed, how far he has got, and the way back
to the paper; no scores show behind it.

Model (controller.lua): { tab, closed = { needed, counted, togo } or nil,
  results_text, matchday, next (Sport.matchday), table (Sport.tableHalf), empty }
]]

local W = require("earlyeditionkids/ui/widgets")

local SportScreen = W.Page:extend{
    name = "eek_sport",
    model = nil,
    pad_top = 36,
    pad_bottom = 32,
    on_tab = nil,          -- function("matches"|"table"|"next", half)
    on_match = nil,        -- function(id)
    on_front_page = nil,
    on_paper = nil,        -- closed: the next story to read
}

function SportScreen:init()
    -- Swiping sideways moves between the table's two halves.
    self.on_swipe = function(dir)
        local m = self.model or {}
        if m.tab ~= "table" or not m.table then return false end
        local h = m.table.half + (dir == "west" and 1 or (dir == "east" and -1 or 0))
        if h ~= m.table.half and h >= 1 and h <= m.table.halves then
            if self.on_tab then self.on_tab("table", h) end
            return true
        end
        return false
    end
    W.Page.init(self)
end

function SportScreen:header()
    local m = self.model
    local cw = self.content_w
    local sub = m.tab == "table" and "Premier League \194\183 Table"
                or (m.tab == "next" and m.next and ("Premier League \194\183 Matchday " .. m.next.number))
                or (m.matchday and ("Premier League \194\183 Matchday " .. m.matchday.number)) or "Premier League"
    local right = W.Text{ text = m.closed and "" or (m.results_text or ""), face = W.face(W.SANS_BOLD, 25) }
    local left_w = cw - right:getSize().w - W.px(24)
    local left = W.VCol({
        W.DisplayText("Sport", 68, left_w),
        W.Text{ text = sub, face = W.face(W.SANS, 26), color = W.SECONDARY, max_width = left_w },
    }, W.px(4))
    return W.SplitRow(cw, left, right, "bottom")
end

function SportScreen:tabs()
    local m = self.model
    local cw = self.content_w
    local gap = W.px(16)
    local list = {}
    if m.matchday then list[#list + 1] = { "matches", "Matches" } end
    if m.table then list[#list + 1] = { "table", "Table" } end
    if m.next then list[#list + 1] = { "next", "Next" } end
    if #list < 2 then return nil end
    local bw = math.floor((cw - gap * (#list - 1)) / #list)
    local buttons = {}
    for i, t in ipairs(list) do
        buttons[i] = W.Button{ text = t[2], width = bw, height = 76, text_size = 28, filled = m.tab == t[1],
                               callback = function() if self.on_tab then self.on_tab(t[1]) end end }
    end
    return W.HRow(buttons, gap)
end

function SportScreen:footer()
    local cw = self.content_w
    return W.VCol({
        W.DoubleRule(cw),
        W.VSpace(W.px(20)),
        W.Button{ text = "Front page", icon_left = "arrow-left", width = cw, height = 92,
                  callback = function() if self.on_front_page then self.on_front_page() end end },
    }, 0)
end

-- ---------- Matches and Next ----------

local function teamText(name, bold, width, align)
    local t = W.Text{ text = name or "", face = W.face(bold and W.SERIF_BOLD or W.SERIF, 33), max_width = width }
    return t
end

function SportScreen:matchRow(r, h)
    -- His team's row has a border inside the same width, so its columns are narrower by it.
    local cw = self.content_w - (r.fav and 2 * W.px(3) or 0)
    local score_w, state_w = W.px(150), W.px(180)
    local pad = W.px(12)
    local team_w = math.floor((cw - score_w - state_w - 2 * pad) / 2)
    local score = r.score_text == "v"
        and W.Text{ text = "v", face = W.face(W.SANS, 24), color = W.SECONDARY }
        or W.Text{ text = r.score_text, face = W.face(W.SERIF_BOLD, 38) }
    local state = W.Text{ text = r.state_text .. (r.opens and "  \226\128\186" or ""), face = W.face(W.SANS_BOLD, 25) }
    local inner_h = h - W.px(r.fav and 6 or 1)
    local line = W.HRow({
        W.HSpace(pad),
        W.Fixed(teamText(r.home, r.home_win or r.home_fav, team_w - W.px(12)), team_w, inner_h, "right"),
        W.Fixed(score, score_w, inner_h, "center"),
        W.Fixed(teamText(r.away, r.away_win or r.away_fav, team_w - W.px(12)), team_w, inner_h, "left"),
        W.Fixed(state, state_w - pad, inner_h, "right"),
        W.HSpace(pad),
    }, 0)
    local block
    if r.fav then
        -- His team's match: outlined, not moved and not coloured (section 2.1).
        block = W.Box{ content = line, border = 3, width = self.content_w, raw = true, pad_h = 0, pad_v = 0 }
    else
        block = W.VCol({ line, W.Rule(cw, W.px(1)) }, 0)
    end
    if r.opens then
        return W.tappable(block, function() if self.on_match then self.on_match(r.id) end end)
    end
    return block
end

function SportScreen:dayHead(day)
    local cw = self.content_w
    return W.VCol({
        W.SplitRow(cw, W.Label(day.name, 19), W.Text{ text = day.date_text, face = W.face(W.SANS, 24), color = W.SECONDARY }, "bottom"),
        W.VSpace(W.px(8)),
        W.Rule(cw, W.px(2)),
    }, 0)
end

--- The day headings and rows, with the row height chosen so the whole round fits one screen.
function SportScreen:matchList(md, avail)
    local heads, rows = 0, 0
    for _, d in ipairs(md.days) do
        heads = heads + 1
        rows = rows + #d.matches
    end
    local head_h = self:dayHead(md.days[1] or { name = "", date_text = "" }):getSize().h + W.px(14)
    local h = math.floor((avail - heads * head_h) / math.max(1, rows))
    h = math.max(W.px(60), math.min(W.px(88), h))
    local items = {}
    for _, d in ipairs(md.days) do
        items[#items + 1] = W.VSpace(W.px(14))
        items[#items + 1] = self:dayHead(d)
        for _, r in ipairs(d.matches) do items[#items + 1] = self:matchRow(r, h) end
    end
    return W.VCol(items, 0)
end

-- ---------- Table ----------

local COLS = { { "P", "played", 64 }, { "W", "won", 52 }, { "D", "drawn", 52 }, { "L", "lost", 52 }, { "GD", "gd_text", 100 }, { "PTS", "points", 104 } }

function SportScreen:tableRow(r, row_h)
    local cw = self.content_w
    local fg = r.fav and W.WHITE or W.INK
    local pos_w = W.px(70)
    local fixed = pos_w
    for _, c in ipairs(COLS) do fixed = fixed + W.px(c[3]) end
    local club_w = cw - fixed
    local cells = {
        W.Fixed(W.Text{ text = tostring(r.position or ""), face = W.face(W.SANS, 34), color = fg }, pos_w, row_h, "center"),
        W.Fixed(W.Text{ text = r.club or "", face = W.face(r.fav and W.SERIF_BOLD or W.SERIF, 42), color = fg, max_width = club_w - W.px(16) },
                club_w, row_h, "left"),
    }
    for _, c in ipairs(COLS) do
        local bold = r.fav or c[2] == "points"
        cells[#cells + 1] = W.Fixed(W.Text{ text = tostring(r[c[2]] or ""), face = W.face(bold and W.SANS_BOLD or W.SANS, 34), color = fg },
                                    W.px(c[3]) - W.px(14), row_h, "right")
        cells[#cells + 1] = W.HSpace(W.px(14))
    end
    local line = W.HRow(cells, 0)
    if r.fav then
        -- His club: white on black.
        line = W.Box{ content = line, border = 0, width = cw, raw = true, pad_h = 0, pad_v = 0, background = W.INK }
    end
    return W.VCol({ line, W.Rule(cw, r.cut and W.px(3) or W.px(1), (r.cut or r.fav) and W.INK or W.HILITE) }, 0)
end

function SportScreen:tableBody(t, avail)
    local cw = self.content_w
    local gap = W.px(16)
    local halves = {}
    if t.halves > 1 then
        local bw = math.floor((cw - gap) / 2)
        halves = { W.HRow({
            W.Button{ text = "1 to 10", width = bw, height = 64, text_size = 26, filled = t.half == 1, border = 2,
                      callback = function() if self.on_tab then self.on_tab("table", 1) end end },
            W.Button{ text = "11 to 20", width = bw, height = 64, text_size = 26, filled = t.half == 2, border = 2,
                      callback = function() if self.on_tab then self.on_tab("table", 2) end end },
        }, gap), W.VSpace(W.px(16)) }
    end
    local head_cells = { W.Fixed(W.HSpace(0), W.px(70), W.px(36), "center") }
    local fixed = W.px(70)
    for _, c in ipairs(COLS) do fixed = fixed + W.px(c[3]) end
    head_cells[#head_cells + 1] = W.Fixed(W.Label("Club", 19), cw - fixed, W.px(36), "left")
    for _, c in ipairs(COLS) do
        head_cells[#head_cells + 1] = W.Fixed(W.Label(c[1], 19), W.px(c[3]) - W.px(14), W.px(36), "right")
        head_cells[#head_cells + 1] = W.HSpace(W.px(14))
    end
    local items = {}
    for _, x in ipairs(halves) do items[#items + 1] = x end
    items[#items + 1] = W.HRow(head_cells, 0)
    items[#items + 1] = W.Rule(cw, W.px(2))
    local zones = #t.zones > 0 and W.Text{ text = table.concat(t.zones, "   "), face = W.face(W.SANS, 24), color = W.SECONDARY, max_width = cw } or nil
    local used = 0
    for _, x in ipairs(items) do used = used + x:getSize().h end
    if zones then used = used + zones:getSize().h + W.px(14) end
    local row_h = math.floor((avail - used) / math.max(1, #t.rows)) - W.px(1)
    row_h = math.max(W.px(48), math.min(W.px(82), row_h))
    for _, r in ipairs(t.rows) do items[#items + 1] = self:tableRow(r, row_h) end
    if zones then
        items[#items + 1] = W.VSpace(W.px(14))
        items[#items + 1] = zones
    end
    return W.VCol(items, 0)
end

-- ---------- closed ----------

function SportScreen:closedBody(c, avail)
    local cw = self.content_w
    local col = W.VCol({
        W.Icon("lock", 120),
        W.VSpace(W.px(28)),
        W.TextBox{ text = string.format("Sport opens after reading %d of today's stories", c.needed), face = W.face(W.SERIF_BOLD, 52),
                   width = math.floor(cw * 0.86), align = "center" },
        W.VSpace(W.px(30)),
        W.Dots(c.needed, c.counted, 48, 4, 18, cw),
        W.VSpace(W.px(22)),
        W.Text{ text = string.format("%d more to go", c.togo), face = W.face(W.SANS_BOLD, 32), color = W.SECONDARY },
        W.VSpace(W.px(34)),
        W.Button{ text = "Today's paper", filled = true, width = math.floor(cw * 0.55), height = 96, text_size = 32,
                  icon_right = "arrow-right", icon_size = 36,
                  callback = function() if self.on_paper then self.on_paper() end end },
    }, 0, "center")
    return W.Fixed(col, cw, avail, "center")
end

function SportScreen:build()
    local m = self.model or {}
    local cw = self.content_w
    local header = self:header()
    local tabs = not m.closed and self:tabs() or nil
    local footer = self:footer()
    local avail = self.dimen.h - W.px(self.pad_top) - W.px(self.pad_bottom) - header:getSize().h
                  - W.px(14) - W.px(6) - footer:getSize().h - W.px(16)
                  - (tabs and (tabs:getSize().h + W.px(18)) or 0)
    local body
    if m.closed then
        body = self:closedBody(m.closed, avail)
    elseif m.tab == "table" and m.table then
        body = self:tableBody(m.table, avail - W.px(12))
    elseif m.tab == "next" and m.next then
        body = self:matchList(m.next, avail)
    elseif m.matchday then
        body = self:matchList(m.matchday, avail)
    else
        body = W.Fixed(W.TextBox{ text = "The scores aren't here yet. They come with the morning paper.",
                                  face = W.face(W.SERIF, 32), width = cw, align = "center" }, cw, avail, "center")
    end
    self.body_widget = body
    local list = { header, { space = 14 }, W.DoubleRule(cw) }
    if tabs then
        list[#list + 1] = { space = 18 }
        list[#list + 1] = tabs
    end
    list[#list + 1] = { space = m.tab == "table" and 12 or 0 }
    list[#list + 1] = body
    list[#list + 1] = { flex = true }
    list[#list + 1] = { space = 16 }
    list[#list + 1] = footer
    return list
end

return SportScreen
