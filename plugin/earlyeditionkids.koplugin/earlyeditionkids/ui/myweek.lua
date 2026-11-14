--[[--
A5 · My week (DESIGN 5.5): Monday to Sunday of this week, from the reading
log only, so it works with Wi-Fi off.

Day circles with how many stories he reached the end of (filled when at
least one; days still to come are dashed), stories this week, days in a
row, what he read about (bars per topic), and words he learned. Counts and
streaks only: nothing here is a score, and a day with no reading is just an
empty circle.

model: Models.myWeek output.
]]

local FrameContainer = require("ui/widget/container/framecontainer")
local Geom = require("ui/geometry")
local LineWidget = require("ui/widget/linewidget")
local W = require("earlyeditionkids/ui/widgets")

local MyWeekScreen = W.Page:extend{
    name = "eek_myweek",
    model = nil,
    pad_top = 48,
    pad_bottom = 40,
    on_front_page = nil,
}

local MAX_TOPICS = 5

local function dayCircle(d)
    local size = W.px(104)
    local circle
    local fg = W.INK
    if d.when == "future" then
        circle = W.Image(W.iconPath("circle-dashed"), size, size)
    elseif (d.count or 0) > 0 then
        circle = W.circleBlock(size, true, 0)
        fg = W.WHITE
    else
        circle = W.circleBlock(size, false, W.px(3))
    end
    local group = W.OverlapGroup:new{ dimen = Geom:new{ w = size, h = size }, circle }
    if d.count then
        table.insert(group, W.Fixed(W.Text{ text = tostring(d.count), face = W.face(W.SANS_BOLD, 34), color = fg },
                                    size, size, "center"))
    end
    return group
end

function MyWeekScreen:days()
    local cw = self.content_w
    local gap = W.px(12)
    local colw = math.floor((cw - 6 * gap) / 7)
    local cols = {}
    for i, d in ipairs(self.model.days) do
        cols[i] = W.Fixed(W.VCol({ W.Label(d.name, 24), dayCircle(d) }, W.px(12), "center"), colw, nil, "center")
    end
    return W.HRow(cols, gap, "top")
end

local function statCard(width, label, number, extra)
    local num = W.DisplayText(tostring(number), 112, width)
    local line = extra and W.HRow({ num, extra }, W.px(18), "bottom") or num
    return W.Box{ content = W.VCol({ W.Label(label, 22), line }, W.px(10)),
                  border = 3, pad_h = 32, pad_v = 28, width = width, background = W.CARD }
end

function MyWeekScreen:stats()
    local m = self.model
    local gap = W.px(24)
    local w = math.floor((self.content_w - gap) / 2)
    return W.HRow({
        statCard(w, "Stories this week", m.total),
        statCard(w, "Days in a row", m.streak, W.Icon("sunrise-small", 72)),
    }, gap, "top")
end

function MyWeekScreen:topics()
    local cw = self.content_w
    local rows = { W.Label("What you read about", 22) }
    local max_n = 1
    for _, t in ipairs(self.model.topics) do max_n = math.max(max_n, t.n) end
    local name_w, num_w, gap = W.px(300), W.px(40), W.px(20)
    local bar_w = cw - name_w - num_w - 2 * gap
    local bar_h, b = W.px(34), W.px(2)
    for i, t in ipairs(self.model.topics) do
        if i > MAX_TOPICS then break end
        local inner_w, inner_h = bar_w - 2 * b, bar_h - 2 * b
        local fill = math.max(0, math.floor(inner_w * t.n / max_n + 0.5))
        local bar = FrameContainer:new{
            bordersize = b, color = W.INK, margin = 0, padding = 0, background = W.PAPER,
            W.Fixed(LineWidget:new{ dimen = Geom:new{ w = math.max(1, fill), h = inner_h }, background = W.INK },
                    inner_w, inner_h, "left"),
        }
        rows[#rows + 1] = W.HRow({
            W.Fixed(W.Text{ text = t.name, face = W.fitFace(t.name, W.SERIF_BOLD, 30, name_w, 24), max_width = name_w }, name_w, nil, "left"),
            bar,
            W.Fixed(W.Text{ text = tostring(t.n), face = W.face(W.SANS_BOLD, 28) }, num_w, nil, "right"),
        }, gap)
    end
    return W.VCol(rows, W.px(16))
end

function MyWeekScreen:words()
    local cw = self.content_w
    local border, ph, pv = 2, 30, 26
    local inner = cw - 2 * (W.px(border) + W.px(ph))
    local gap = W.px(12)
    local lines, line, used = {}, {}, 0
    for _, word in ipairs(self.model.words) do
        local chip = W.Box{ content = W.Text{ text = word, face = W.face(W.SERIF_BOLD, 28), max_width = inner - W.px(40) },
                            border = 2, pad_h = 18, pad_v = 8 }
        local w = chip:getSize().w
        if #line > 0 and used + gap + w > inner then
            lines[#lines + 1] = W.HRow(line, gap)
            line, used = {}, 0
            if #lines >= 2 then break end -- two rows of words at most
        end
        line[#line + 1] = chip
        used = used + (#line > 1 and gap or 0) + w
    end
    if #line > 0 and #lines < 2 then lines[#lines + 1] = W.HRow(line, gap) end
    return W.Box{ content = W.VCol({ W.Label("Words you learned", 22), W.VCol(lines, gap) }, W.px(14)),
                  border = border, pad_h = ph, pad_v = pv, width = cw }
end

function MyWeekScreen:build()
    local m = self.model
    local cw = self.content_w
    local list = {
        W.SectionHeader(cw, "My week", m.range),
        { space = 30 },
        W.DoubleRule(cw),
        { space = 30 },
        self:days(),
        { space = 30 },
    }
    if m.empty then
        list[#list + 1] = W.Box{
            content = W.TextBox{ text = "Read your first story to start your week.", face = W.face(W.SERIF_BOLD, 40),
                                 width = cw - 2 * (W.px(3) + W.px(32)), bg = W.CARD, align = "center" },
            border = 3, pad_h = 32, pad_v = 40, width = cw, background = W.CARD,
        }
    else
        list[#list + 1] = self:stats()
        if #m.topics > 0 then
            list[#list + 1] = { space = 30 }
            list[#list + 1] = self:topics()
        end
        if #m.words > 0 then
            list[#list + 1] = { space = 30 }
            list[#list + 1] = self:words()
        end
    end
    list[#list + 1] = { flex = true }
    list[#list + 1] = { space = 24 }
    list[#list + 1] = W.Button{ text = "Front page", icon_left = "arrow-left", width = cw, height = 96,
                                callback = function() if self.on_front_page then self.on_front_page() end end }
    return list
end

return MyWeekScreen
