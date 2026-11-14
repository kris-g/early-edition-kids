--[[--
A3 · Story finished: the panel docked at the bottom of the reader when he
turns forward from a story's last page (DESIGN 5.1 step 6).

READ stamp (with today's date), "Story finished!", progress dots and
"2 of 6 read", a black NEXT STORY button with the next story's topic icon,
then "All headlines" and "Front page". When every story is read, the black
button becomes "Back to the front page".

Tapping above the panel closes it and leaves him on the last page. Only the
panel's own area is painted and refreshed ("ui"), like ButtonDialog.
]]

local BottomContainer = require("ui/widget/container/bottomcontainer")
local Device = require("device")
local FrameContainer = require("ui/widget/container/framecontainer")
local Geom = require("ui/geometry")
local GestureRange = require("ui/gesturerange")
local InputContainer = require("ui/widget/container/inputcontainer")
local UIManager = require("ui/uimanager")
local W = require("earlyeditionkids/ui/widgets")
local Screen = Device.screen

local FinishedPanel = InputContainer:extend{
    name = "eek_finished",
    read = 0,
    total = 0,
    stamp_date = "",
    next_story = nil,      -- { topic, title, minutes } or nil when all read
    on_next = nil,
    on_headlines = nil,
    on_front_page = nil,
    on_dismiss = nil,
}

function FinishedPanel:init()
    local sw, sh = Screen:getWidth(), Screen:getHeight()
    self.dimen = Geom:new{ x = 0, y = 0, w = sw, h = sh }
    if Device:hasKeys() then
        self.key_events.Close = { { Device.input.group.Back } }
    end
    self.ges_events.TapOutside = { GestureRange:new{ ges = "tap", range = self.dimen } }

    local pad_h = W.px(64)
    local iw = sw - 2 * pad_h

    local stamp = W.Image(W.stampPath(self.stamp_date), W.px(180), W.px(180))
    local text_w = iw - W.px(180) - W.px(36)
    local title = W.VCol({
        W.DisplayText("Story finished!", 72, text_w),
        W.HRow({
            W.Dots(self.total, self.read, 30, 3, 10, text_w * 0.6),
            W.Text{ text = string.format("%d of %d read", self.read, self.total), face = W.face(W.SANS_BOLD, 30) },
        }, W.px(18)),
    }, W.px(14))
    local top = W.HRow({ stamp, title }, W.px(36))

    local main
    if self.next_story then
        local s = self.next_story
        local bpad_h, bpad_v = 36, 28
        local inner = iw - 2 * W.px(bpad_h)
        local col_w = inner - W.px(84) - W.px(48) - 2 * W.px(28)
        local col = W.VCol({
            W.Label(string.format("Next story · %d min", tonumber(s.minutes) or 1), 24, W.WHITE, col_w),
            W.FitLine{ text = s.title or "", file = W.SERIF_BOLD, n = 40, min_n = 32, width = col_w,
                       color = W.WHITE, bg = W.INK },
        }, W.px(6))
        local content = W.HRow({ W.TopicIcon(s.topic, 84, W.ICON_WHITE), col, W.Icon("arrow-right", 48, W.ICON_WHITE) }, W.px(28))
        main = W.tappable(W.Box{ content = content, border = 0, pad_h = bpad_h, pad_v = bpad_v, width = iw,
                                 min_height = W.px(150), background = W.INK },
                          function() self:choose(self.on_next) end)
    else
        main = W.Button{ text = "Back to the front page", filled = true, width = iw, height = 150, text_size = 40,
                         icon_left = "arrow-left", icon_size = 44, callback = function() self:choose(self.on_front_page) end }
    end

    local gap = W.px(20)
    local bw = math.floor((iw - gap) / 2)
    local row
    if self.next_story then
        row = W.HRow({
            W.Button{ text = "All headlines", width = bw, height = 100, callback = function() self:choose(self.on_headlines) end },
            W.Button{ text = "Front page", width = bw, height = 100, callback = function() self:choose(self.on_front_page) end },
        }, gap)
    else
        row = W.Button{ text = "All headlines", width = iw, height = 100, callback = function() self:choose(self.on_headlines) end }
    end

    local body = FrameContainer:new{
        bordersize = 0, margin = 0, padding = 0,
        padding_left = pad_h, padding_right = pad_h, padding_top = W.px(44), padding_bottom = W.px(48),
        background = W.CARD,
        W.VCol({ top, main, row }, W.px(30)),
    }
    self.frame = FrameContainer:new{
        bordersize = 0, margin = 0, padding = 0, background = W.CARD,
        W.VCol({ W.Rule(sw, W.px(4)), body }, 0),
    }
    self[1] = BottomContainer:new{ dimen = Geom:new{ w = sw, h = sh }, self.frame }
end

function FinishedPanel:choose(fn)
    UIManager:close(self)
    if fn then fn() end
end

function FinishedPanel:onShow()
    UIManager:setDirty(self, function() return "ui", self.frame.dimen end)
    return true
end

function FinishedPanel:onCloseWidget()
    UIManager:setDirty(nil, function() return "ui", self.frame.dimen end)
    if self.on_dismiss then self.on_dismiss() end
end

function FinishedPanel:onTapOutside(_, ges)
    -- Same test as ButtonDialog:onTapClose.
    if self.frame.dimen and ges and ges.pos and not ges.pos:notIntersectWith(self.frame.dimen) then
        return true
    end
    UIManager:close(self)
    return true
end

function FinishedPanel:onClose()
    UIManager:close(self)
    return true
end

return FinishedPanel
