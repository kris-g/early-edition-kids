--[[--
A played match on the Kindle (docs/sports-page.md 2.4): two screens.

  1  the score and goals, then cards, substitutions and injuries, two columns
     (home left, away right); a part with nothing in it is left out
  2  both line-ups side by side, by line, then the bench

And nothing else. Model: Sport.match (sport.lua).
]]

local Blitbuffer = require("ffi/blitbuffer")
local W = require("earlyeditionkids/ui/widgets")

--- A yellow card in grey on e-ink: dark enough to read as a filled card, lighter than a red one.
local YELLOW = Blitbuffer.Color8(0xA8)

--- `content` at the top of a w x h box (W.Fixed centres it vertically).
local function top(content, w, h)
    local ch = content:getSize().h
    return W.Fixed(h > ch and W.VCol({ content, W.VSpace(h - ch) }, 0) or content, w, h, "left")
end

local MatchScreen = W.Page:extend{
    name = "eek_sportmatch",
    model = nil,
    page = 1,
    pad_top = 36,
    pad_bottom = 32,
    on_page = nil,         -- function(page)
    on_back = nil,         -- back to Matches
}

function MatchScreen:init()
    self.on_swipe = function(dir)
        if dir == "west" and self.page == 1 then self.on_page(2) return true end
        if dir == "east" and self.page == 2 then self.on_page(1) return true end
        return false
    end
    W.Page.init(self)
end

local function minuteLine(minute, text, width, extra)
    local parts = {
        W.Fixed(W.Text{ text = minute or "", face = W.face(W.SANS_BOLD, 24) }, W.px(78), W.px(40), "left"),
    }
    if extra then parts[#parts + 1] = extra end
    parts[#parts + 1] = W.Text{ text = text or "", face = W.face(W.SERIF, 29), max_width = width - W.px(78) - (extra and extra:getSize().w or 0) }
    return W.HRow(parts, 0)
end

--- A small upright card: solid black for red, mid grey with a black edge for yellow.
local function card(kind)
    local box = W.Box{ content = W.HSpace(W.px(18)), border = 2, pad_h = 0, pad_v = 14,
                       background = kind == "red" and W.INK or YELLOW }
    return W.HRow({ box, W.HSpace(W.px(12)) }, 0)
end

function MatchScreen:part(label, cols)
    local cw = self.content_w
    local gap = W.px(28)
    local half = math.floor((cw - gap - W.px(1)) / 2)
    local function column(items)
        if #items == 0 then return W.Text{ text = "None", face = W.face(W.SANS, 24), color = W.SECONDARY } end
        return W.VCol(items, W.px(6))
    end
    local left, right = column(cols.home), column(cols.away)
    local h = math.max(left:getSize().h, right:getSize().h)
    return W.VCol({
        W.Rule(cw, W.px(2)),
        W.VSpace(W.px(12)),
        W.Label(label, 19),
        W.VSpace(W.px(10)),
        W.HRow({ top(left, half, h), W.HSpace(gap / 2), W.Rule(W.px(1), h), W.HSpace(gap / 2), top(right, half, h) }, 0, "top"),
        W.VSpace(W.px(16)),
    }, 0)
end

function MatchScreen:scoreHead()
    local m = self.model
    local cw = self.content_w
    local score = W.Text{ text = m.score_text, face = W.face(W.SERIF_BOLD, 88) }
    local side_w = math.floor((cw - score:getSize().w - W.px(48)) / 2)
    local function name(text, align)
        return W.TextBox{ text = text, face = W.face(W.SERIF_BOLD, 42), width = side_w, align = align, line_height = 0.05 }
    end
    local home, away = name(m.home, "right"), name(m.away, "left")
    local h = math.max(home:getSize().h, away:getSize().h, score:getSize().h)
    local goals = function(list, align)
        local items = {}
        for _, g in ipairs(list) do
            items[#items + 1] = W.Text{ text = g, face = W.face(W.SERIF, 29), max_width = side_w }
        end
        local col = W.VCol(items, W.px(4), align == "right" and "right" or "left")
        return W.Fixed(col, side_w, col:getSize().h, align)
    end
    local gh, ga = goals(m.goals.home, "right"), goals(m.goals.away, "left")
    return W.VCol({
        W.HRow({ W.Fixed(home, side_w, h, "right"), W.HSpace(W.px(24)), W.Fixed(score, score:getSize().w, h, "center"),
                 W.HSpace(W.px(24)), W.Fixed(away, side_w, h, "left") }, 0),
        W.VSpace(W.px(10)),
        W.Fixed(W.Label(m.when_text or "", 22), cw, nil, "center"),
        W.VSpace(W.px(18)),
        W.HRow({ gh, W.HSpace(W.px(48) + score:getSize().w), ga }, 0, "top"),
        W.VSpace(W.px(22)),
    }, 0)
end

function MatchScreen:pageOne()
    local m = self.model
    local cw = self.content_w
    local half = math.floor((cw - W.px(29)) / 2)
    local items = { self:scoreHead() }
    local function lines(list, f)
        local out = { home = {}, away = {} }
        for _, side in ipairs({ "home", "away" }) do
            for _, x in ipairs(list[side]) do out[side][#out[side] + 1] = f(x) end
        end
        return out
    end
    local function has(list) return #list.home + #list.away > 0 end
    if has(m.penalties) then
        items[#items + 1] = self:part("Penalties missed", lines(m.penalties, function(x) return minuteLine(x.minute, x.text, half) end))
    end
    if has(m.cards) then
        items[#items + 1] = self:part("Cards", lines(m.cards, function(x)
            return minuteLine(x.minute, x.text .. (x.card == "red" and "  (sent off)" or ""), half, card(x.card))
        end))
    end
    if has(m.subs) then
        items[#items + 1] = self:part("Substitutions", lines(m.subs, function(x)
            return W.VCol({
                minuteLine(x.minute, "On: " .. x.on, half),
                W.HRow({ W.HSpace(W.px(78)), W.Text{ text = "Off: " .. x.off, face = W.face(W.SERIF, 26), color = W.SECONDARY,
                                                     max_width = half - W.px(78) } }, 0),
            }, W.px(2))
        end))
    end
    if m.injuries then
        local function inj(side)
            local out = {}
            local i = m.injuries[side]
            if #i.off > 0 then
                out[#out + 1] = W.Label("Went off injured", 18, W.SECONDARY)
                out[#out + 1] = W.TextBox{ text = table.concat(i.off, ", "), face = W.face(W.SERIF, 27), width = half }
            end
            if #i.out > 0 then
                out[#out + 1] = W.Label("Out injured", 18, W.SECONDARY)
                out[#out + 1] = W.TextBox{ text = table.concat(i.out, ", "), face = W.face(W.SERIF, 27), width = half }
            end
            return out
        end
        items[#items + 1] = self:part("Injuries", { home = inj("home"), away = inj("away") })
    end
    return W.VCol(items, 0)
end

function MatchScreen:lineupColumn(l, width, row_h)
    local items = { W.Text{ text = l.team, face = W.face(W.SERIF_BOLD, 40), max_width = width } }
    for _, g in ipairs(l.groups) do
        items[#items + 1] = W.VSpace(W.px(10))
        items[#items + 1] = W.Label(g.name, 17, W.SECONDARY)
        for _, p in ipairs(g.players) do
            -- The name has the note's room too when there is no note (most players).
            local note_w = (p.note ~= "") and W.px(110) or 0
            local name_w = width - W.px(52) - note_w
            local cells = {
                W.Fixed(W.Text{ text = p.number, face = W.face(W.SANS_BOLD, 22) }, W.px(52), row_h, "left"),
                W.Fixed(W.Text{ text = p.name, face = W.face(W.SERIF, 27), max_width = name_w }, name_w, row_h, "left"),
            }
            if note_w > 0 then
                cells[#cells + 1] = W.Fixed(W.Text{ text = p.note, face = W.face(W.SANS, 22), color = W.SECONDARY }, note_w, row_h, "right")
            end
            items[#items + 1] = W.HRow(cells, 0)
        end
    end
    return W.VCol(items, 0)
end

function MatchScreen:pageTwo(avail)
    local m = self.model
    local cw = self.content_w
    local gap = W.px(28)
    local half = math.floor((cw - gap - W.px(1)) / 2)
    -- The row height that fits the longer team on the screen.
    local most, groups = 0, 0
    for _, side in ipairs({ "home", "away" }) do
        local n, g = 0, 0
        for _, grp in ipairs(m.lineups[side].groups) do n = n + #grp.players; g = g + 1 end
        most, groups = math.max(most, n), math.max(groups, g)
    end
    local fixed = W.px(60) + groups * (W.px(10) + W.px(24))
    local row_h = math.max(W.px(34), math.min(W.px(48), math.floor((avail - fixed) / math.max(1, most))))
    local left = self:lineupColumn(m.lineups.home, half, row_h)
    local right = self:lineupColumn(m.lineups.away, half, row_h)
    local h = math.max(left:getSize().h, right:getSize().h)
    return W.HRow({ top(left, half, h), W.HSpace(gap / 2), W.Rule(W.px(1), h), W.HSpace(gap / 2), top(right, half, h) }, 0, "top")
end

function MatchScreen:footer()
    local cw = self.content_w
    local bw = math.floor(cw * 0.38)
    local where = W.Text{ text = string.format("%d of 2", self.page), face = W.face(W.SANS_BOLD, 25) }
    local back = W.Button{ text = self.page == 1 and "Matches" or "Back", icon_left = "arrow-left", width = bw, height = 92,
                           callback = function()
                               if self.page == 1 then self.on_back() else self.on_page(1) end
                           end }
    local fwd = W.Button{ text = self.page == 1 and "Line-ups" or "Matches", icon_right = self.page == 1 and "arrow-right" or nil,
                          width = bw, height = 92,
                          callback = function()
                              if self.page == 1 then self.on_page(2) else self.on_back() end
                          end }
    return W.VCol({
        W.DoubleRule(cw),
        W.VSpace(W.px(20)),
        W.SplitRow(cw, back, W.HRow({ where, W.HSpace(math.max(0, math.floor((cw - 2 * bw - where:getSize().w) / 2))), fwd }, 0), "center"),
    }, 0)
end

function MatchScreen:build()
    local footer = self:footer()
    local avail = self.dimen.h - W.px(self.pad_top) - W.px(self.pad_bottom) - footer:getSize().h - W.px(16)
    local body = self.page == 2 and self:pageTwo(avail) or self:pageOne()
    self.body_widget = body
    return { body, { flex = true }, { space = 16 }, footer }
end

return MatchScreen
