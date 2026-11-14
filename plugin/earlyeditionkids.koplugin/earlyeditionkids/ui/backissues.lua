--[[--
A4 · Back issues: one card per issue stored on the Kindle (the last 7 days),
newest first, read only from local files (no network).

Each card: day of week and day number, "TODAY · 6 STORIES", the lead
headline, "N of M" or "All read" with dots. The newest issue's card is
highlighted. Tapping a card opens that issue's headline list.

rows: Models.backIssues output.
]]

local Geom = require("ui/geometry")
local LineWidget = require("ui/widget/linewidget")
local W = require("earlyeditionkids/ui/widgets")

local BackIssuesScreen = W.Page:extend{
    name = "eek_backissues",
    rows = nil,
    pad_top = 48,
    pad_bottom = 40,
    on_pick = nil,         -- function(date)
    on_front_page = nil,
}

function BackIssuesScreen:card(r)
    local cw = self.content_w
    local bg = r.highlight and W.HILITE or W.PAPER
    local border, ph, pv = 2, 26, 18
    local inner = cw - 2 * (W.px(border) + W.px(ph))
    local date_col = W.Fixed(W.VCol({
        W.Label(r.dow, 22),
        W.DisplayText(r.day, 58, W.px(92)),
    }, W.px(4), "center"), W.px(92), nil, "center")
    local right = W.VCol({
        W.Text{ text = r.read_text, face = W.face(W.SANS_BOLD, 26) },
        W.Dots(r.total, r.read, 18, 2, 6, W.px(200)),
    }, W.px(10), "right")
    local gap = W.px(28)
    local mid_w = inner - W.px(92) - W.px(22) - W.px(2) - right:getSize().w - 2 * gap
    local mid = W.VCol({
        W.Label(r.label, 20, nil, mid_w),
        W.Text{ text = r.lead, face = W.fitFace(r.lead or "", W.SERIF_BOLD, 34, mid_w, 28), max_width = mid_w },
    }, W.px(6))
    local h = math.max(date_col:getSize().h, mid:getSize().h, right:getSize().h)
    local content = W.HRow({
        W.Fixed(date_col, W.px(92), h, "center"),
        W.HSpace(W.px(22)),
        LineWidget:new{ dimen = Geom:new{ w = W.px(2), h = h }, background = W.INK },
        W.HSpace(gap),
        W.Fixed(mid, mid_w, h, "left"),
        W.HSpace(gap),
        W.Fixed(right, right:getSize().w, h, "right"),
    }, 0)
    local box = W.Box{ content = content, border = border, pad_h = ph, pad_v = pv, width = cw,
                       min_height = W.px(132), background = bg }
    return W.tappable(box, function() if self.on_pick then self.on_pick(r.date) end end)
end

function BackIssuesScreen:build()
    local cw = self.content_w
    local header = W.SectionHeader(cw, "Back issues", "The last 7 papers, kept on your Kindle")
    local footer = W.Button{ text = "Front page", icon_left = "arrow-left", width = cw, height = 96,
                             callback = function() if self.on_front_page then self.on_front_page() end end }
    local avail = self.dimen.h - W.px(self.pad_top) - W.px(self.pad_bottom) - header:getSize().h
                  - W.px(24) - W.px(6) - W.px(28) - W.px(24) - footer:getSize().h

    local list = { header, { space = 24 }, W.DoubleRule(cw), { space = 28 } }
    local used = 0
    local rows = self.rows or {}
    if #rows == 0 then
        list[#list + 1] = W.Fixed(W.TextBox{ text = "There are no papers on this Kindle yet.",
                                             face = W.face(W.SERIF, 32), width = cw, align = "center" },
                                  cw, W.px(200), "center")
    end
    for i, r in ipairs(rows) do
        local card = self:card(r)
        local h = card:getSize().h + (i > 1 and W.px(10) or 0)
        if used + h > avail then
            card:free()
            break -- (at most 7 issues are kept; this only trims on very small screens)
        end
        if i > 1 then list[#list + 1] = { space = 16 } end
        list[#list + 1] = card
        used = used + h
    end
    list[#list + 1] = { flex = true }
    list[#list + 1] = { space = 24 }
    list[#list + 1] = footer
    return list
end

return BackIssuesScreen
