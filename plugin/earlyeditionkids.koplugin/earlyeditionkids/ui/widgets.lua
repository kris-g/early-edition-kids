--[[--
The "Morning paper" design system: reusable pieces for every Early Edition
screen (front page, today's paper, story finished, back issues, my week).

Sizes are given in pixels of the 1072 x 1448 px (300 ppi) mockups and go
through Screen:scaleBySize, so a 536 x 724 emulator looks the same at half
size.

Colours (mockup -> KOReader greyscale):
  paper #ECEAE4 -> white   (see PAPER below: the light paper tone is not
                            painted; on e-ink a 0xEB grey costs contrast and
                            shows ghosting under "ui" refreshes)
  card  #F7F6F2 -> white, cards keep their black border; the highlighted
                   back-issue card uses a light grey (0xEE)
  ink   #121212 -> black
  secondary text #3A3A38 -> 0x3A
  read / greyed  #555451 -> 0x55, read-row icons #6B6A66 -> 0x6B

KOReader pieces used (checked in the app's frontend/ui/widget/*):
FrameContainer (bordersize, padding_*, background, radius, width/height for
the background only), LeftContainer/RightContainer/CenterContainer (dimen),
HorizontalGroup (align top/center/bottom), VerticalGroup, OverlapGroup
(overlap_offset), HorizontalSpan/VerticalSpan, LineWidget, TextWidget
(max_width), TextBoxWidget (width, alignment, bgcolor: it paints its own
background), ImageWidget (file = SVG -> RenderImage:renderSVGImageFile with
NanoSVG; alpha = true keeps it transparent), InputContainer with ges_events
and GestureRange (range may be a function), Font:getFace (newer versions accept an
absolute font path, font.lua), Blitbuffer.Color8.
]]

local Blitbuffer = require("ffi/blitbuffer")
local CenterContainer = require("ui/widget/container/centercontainer")
local Device = require("device")
local Font = require("ui/font")
local FrameContainer = require("ui/widget/container/framecontainer")
local Geom = require("ui/geometry")
local GestureRange = require("ui/gesturerange")
local HorizontalGroup = require("ui/widget/horizontalgroup")
local HorizontalSpan = require("ui/widget/horizontalspan")
local ImageWidget = require("ui/widget/imagewidget")
local InputContainer = require("ui/widget/container/inputcontainer")
local LeftContainer = require("ui/widget/container/leftcontainer")
local LineWidget = require("ui/widget/linewidget")
local OverlapGroup = require("ui/widget/overlapgroup")
local RightContainer = require("ui/widget/container/rightcontainer")
local TextBoxWidget = require("ui/widget/textboxwidget")
local TextWidget = require("ui/widget/textwidget")
local VerticalGroup = require("ui/widget/verticalgroup")
local VerticalSpan = require("ui/widget/verticalspan")
local Icons = require("earlyeditionkids/icons")
local Screen = Device.screen

local W = {}

---------------------------------------------------------------------------
-- Colours and fonts
---------------------------------------------------------------------------

W.INK = Blitbuffer.COLOR_BLACK
W.WHITE = Blitbuffer.COLOR_WHITE
W.PAPER = Blitbuffer.COLOR_WHITE
W.CARD = Blitbuffer.COLOR_WHITE
W.HILITE = Blitbuffer.COLOR_GRAY_E
W.SECONDARY = Blitbuffer.Color8(0x3A)
W.GREYED = Blitbuffer.Color8(0x55)
W.ICON_GREY = "#6B6A66"
W.ICON_WHITE = "#FFFFFF"

W.SERIF = "NotoSerif-Regular.ttf"
W.SERIF_BOLD = "NotoSerif-Bold.ttf"
W.SANS = "NotoSans-Regular.ttf"
W.SANS_BOLD = "NotoSans-Bold.ttf"
W.DISPLAY = nil -- Playfair Display Black, as a path from KOReader's fonts folder (W.configure)
W.DISPLAY_ABS = nil -- the same font by its absolute path

W.icon_dir = nil
W.cache_dir = nil
W.writeFile = nil

--[[--
A font file's name as Font:getFace wants it. KOReader before v2026.07.2
always opens FontList.fontdir .. "/" .. name, so an absolute path fails there
(the Kindle's masthead fell back to Noto Serif). From the fonts folder's real
path, climb to the root and come back down: "../../../../mnt/us/...". Newer
KOReader joins a name like this to the fonts folder too, so it works on both.
]]
function W.fontPathFrom(font_dir, file)
    if type(font_dir) ~= "string" or font_dir:sub(1, 1) ~= "/" or file:sub(1, 1) ~= "/" then return file end
    local up = 0
    for _ in font_dir:gmatch("[^/]+") do up = up + 1 end
    return string.rep("../", up) .. file:sub(2)
end

--- Called once by the controller: plugin folder (absolute), a cache folder
-- for recoloured icons, a file writer, and KOReader's fonts folder (absolute).
function W.configure(opts)
    W.icon_dir = opts.plugin_path .. "/icons"
    W.cache_dir = opts.cache_dir
    W.writeFile = opts.writeFile
    W.readFile = opts.readFile
    W.DISPLAY_ABS = opts.plugin_path .. "/fonts/PlayfairDisplay-Black.ttf"
    W.DISPLAY = W.fontPathFrom(opts.font_dir, W.DISPLAY_ABS)
end

-- Mockup pixels -> device pixels (exact on the 1072 px wide PW3).
local MOCKUP_TO_SCALE = 600 / 1072
function W.px(n)
    if n <= 0 then return 0 end
    return Screen:scaleBySize(n * MOCKUP_TO_SCALE)
end

local face_cache = {}
--- A face at `n` mockup pixels. Font:getFace returns nil for a missing file;
-- Playfair falls back to Noto Serif Bold, the rest to KOReader's UI fonts.
function W.face(file, n)
    file = file or W.SANS
    local k = file .. "@" .. n
    if face_cache[k] then return face_cache[k] end
    local size = math.max(6, math.floor(n * MOCKUP_TO_SCALE + 0.5))
    local face = Font:getFace(file, size)
    if not face and file == W.DISPLAY then
        if W.DISPLAY_ABS ~= W.DISPLAY then face = Font:getFace(W.DISPLAY_ABS, size) end
        if not face then face = Font:getFace(W.SERIF_BOLD, size) end
    end
    if not face then
        face = Font:getFace(file:find("Bold") and "smallinfofontbold" or "smallinfofont", size)
    end
    face_cache[k] = face
    return face
end

function W.display(n) return W.face(W.DISPLAY or W.SERIF_BOLD, n) end

local HAIR = "\226\128\138"  -- U+200A, about 0.1 em
local THIN = "\226\128\137"  -- U+2009, about 0.2 em
--- Letter-spaced capitals ("FIRST UP"): hair spaces between letters, a
-- wider gap between words.
function W.spaced(text)
    text = string.upper(text or "")
    local out = {}
    for ch in text:gmatch("[%z\1-\127\194-\244][\128-\191]*") do
        if ch == " " then
            out[#out + 1] = " " .. THIN
        else
            out[#out + 1] = ch
        end
    end
    return table.concat(out, HAIR)
end

---------------------------------------------------------------------------
-- Text
---------------------------------------------------------------------------

function W.Text(t)
    return TextWidget:new{
        text = t.text or "",
        face = t.face,
        fgcolor = t.color or W.INK,
        padding = 0,
        max_width = t.max_width,
        forced_height = t.forced_height,
        forced_baseline = t.forced_baseline,
    }
end

--- Wrapping text. `bg` must match what is behind it (TextBoxWidget paints
-- its own background).
function W.TextBox(t)
    return TextBoxWidget:new{
        text = t.text or "",
        face = t.face,
        width = t.width,
        fgcolor = t.color or W.INK,
        bgcolor = t.bg or W.PAPER,
        alignment = t.align or "left",
        line_height = t.line_height or 0.15,
        height = t.height,
        height_overflow_show_ellipsis = t.height ~= nil,
    }
end

--- A label in spaced capitals (sans bold).
function W.Label(text, n, color, max_width)
    return W.Text{ text = W.spaced(text), face = W.face(W.SANS_BOLD, n or 22), color = color, max_width = max_width }
end

--- Largest face (from n downwards) at which `text` fits in max_width.
function W.fitFace(text, file, n, max_width, min_n)
    min_n = min_n or math.floor(n * 0.6)
    local size = n
    while size > min_n do
        local probe = TextWidget:new{ text = text, face = W.face(file, size), padding = 0 }
        local w = probe:getSize().w
        probe:free()
        if w <= max_width then break end
        size = size - 2
    end
    return W.face(file, size), size
end

--- One line of text at size n, shrunk (down to min_n) to fit `width`; if it
-- still does not fit, wrapped at min_n onto at most `lines` lines.
function W.FitLine(t)
    local min_n = t.min_n or math.floor(t.n * 0.75)
    local face, size = W.fitFace(t.text or "", t.file, t.n, t.width, min_n)
    local probe = TextWidget:new{ text = t.text or "", face = face, padding = 0 }
    local fits = probe:getSize().w <= t.width
    probe:free()
    if fits then
        return W.Text{ text = t.text, face = face, color = t.color }
    end
    return W.TextBox{ text = t.text, face = W.face(t.file, min_n), color = t.color, bg = t.bg,
                      width = t.width, line_height = 0.05 }
end

--- Playfair Display text laid out like CSS line-height: 1 (box = font size,
-- baseline at 0.915 em for Playfair's metrics), shrunk to fit max_width.
function W.DisplayText(text, n, max_width, color)
    local face, size = W.fitFace(text, W.DISPLAY or W.SERIF_BOLD, n, max_width)
    return W.Text{ text = text, face = face, color = color, max_width = max_width,
                   forced_height = W.px(size), forced_baseline = W.px(size * 0.915) }
end

---------------------------------------------------------------------------
-- Icons
---------------------------------------------------------------------------

local icon_paths = {}
--- Path of an icon in the given colour ("#RRGGBB"); recoloured copies are
-- written once to the cache folder.
function W.iconPath(name, color)
    local base = W.icon_dir .. "/" .. name .. ".svg"
    if not color or color == Icons.INK then return base end
    local k = name .. color
    if icon_paths[k] then return icon_paths[k] end
    local out = string.format("%s/%s-%s.svg", W.cache_dir, name, color:gsub("#", ""))
    local svg = W.readFile and W.readFile(base)
    if svg and W.writeFile(out, Icons.recolor(svg, color)) then
        icon_paths[k] = out
        return out
    end
    return base
end

--- Path of the READ stamp for a date ("13 NOV").
function W.stampPath(date_text)
    local k = "stamp" .. date_text
    if icon_paths[k] then return icon_paths[k] end
    local out = string.format("%s/stamp-%s.svg", W.cache_dir, date_text:gsub("%s", ""))
    if W.writeFile(out, Icons.stampSvg(date_text)) then
        icon_paths[k] = out
        return out
    end
    return W.icon_dir .. "/stamp.svg"
end

function W.Image(file, w, h)
    return ImageWidget:new{ file = file, width = w, height = h or w, alpha = true }
end

--- A story photo (the server's 1000 x 563 Kindle copy) filling w x h pixels:
-- scaled to cover the box and cropped around its centre, never stretched.
W.PHOTO_W, W.PHOTO_H = 1000, 563
function W.Photo(file, w, h)
    local scale = math.max(w / W.PHOTO_W, h / W.PHOTO_H)
    return ImageWidget:new{ file = file, width = w, height = h, scale_factor = scale,
                            center_x_ratio = 0.5, center_y_ratio = 0.5 }
end

--- An icon `size` mockup pixels square.
function W.Icon(name, size, color)
    local s = W.px(size)
    return W.Image(W.iconPath(name, color), s, s)
end

function W.TopicIcon(topic, size, color)
    return W.Icon(Icons.forTopic(topic), size, color)
end

---------------------------------------------------------------------------
-- Rules, spacing, boxes
---------------------------------------------------------------------------

function W.Rule(width, thickness, color)
    return LineWidget:new{ dimen = Geom:new{ w = width, h = math.max(1, thickness) }, background = color or W.INK }
end

--- The 6 px double rule under mastheads: 2 px line, 2 px gap, 2 px line.
function W.DoubleRule(width)
    return VerticalGroup:new{
        align = "left",
        W.Rule(width, W.px(2)),
        VerticalSpan:new{ width = W.px(2) },
        W.Rule(width, W.px(2)),
    }
end

function W.VSpace(n) return VerticalSpan:new{ width = n } end
function W.HSpace(n) return HorizontalSpan:new{ width = n } end

--- A fixed-size box with its content aligned left / centre / right.
function W.Fixed(content, w, h, align)
    local C = (align == "center" and CenterContainer) or (align == "right" and RightContainer) or LeftContainer
    return C:new{ dimen = Geom:new{ w = w, h = h or content:getSize().h }, content }
end

--[[--
Bordered box. opts: content, border (mockup px), pad_h, pad_v (mockup px or
device px with raw = true), background, width (outer, device px),
min_height (outer, device px), align (content alignment inside the width).
]]
function W.Box(opts)
    local b = W.px(opts.border or 2)
    local ph = opts.raw and opts.pad_h or W.px(opts.pad_h or 0)
    local pv = opts.raw and opts.pad_v or W.px(opts.pad_v or 0)
    local content = opts.content
    local cs = content:getSize()
    local inner_w = opts.width and (opts.width - 2 * (b + ph)) or cs.w
    local inner_h = cs.h
    if opts.min_height then inner_h = math.max(inner_h, opts.min_height - 2 * (b + pv)) end
    if inner_w ~= cs.w or inner_h ~= cs.h then
        content = W.Fixed(content, inner_w, inner_h, opts.align or "left")
    end
    return FrameContainer:new{
        bordersize = b, color = W.INK, margin = 0, padding = 0,
        padding_left = ph, padding_right = ph, padding_top = pv, padding_bottom = pv,
        background = opts.background or W.PAPER,
        content,
    }
end

--- Horizontal row: left widget at the left, right widget at the right.
function W.SplitRow(width, left, right, align)
    local lw, rw = left:getSize().w, right and right:getSize().w or 0
    local row = HorizontalGroup:new{ align = align or "center", left }
    if right then
        table.insert(row, HorizontalSpan:new{ width = math.max(0, width - lw - rw) })
        table.insert(row, right)
    end
    return row
end

--- Items laid out left to right with a gap.
function W.HRow(items, gap, align)
    local row = HorizontalGroup:new{ align = align or "center" }
    for i, it in ipairs(items) do
        if i > 1 and gap and gap > 0 then table.insert(row, HorizontalSpan:new{ width = gap }) end
        table.insert(row, it)
    end
    return row
end

--- Items top to bottom with a gap.
function W.VCol(items, gap, align)
    local col = VerticalGroup:new{ align = align or "left" }
    for i, it in ipairs(items) do
        if i > 1 and gap and gap > 0 then table.insert(col, VerticalSpan:new{ width = gap }) end
        table.insert(col, it)
    end
    return col
end

---------------------------------------------------------------------------
-- Circles and dots
---------------------------------------------------------------------------

local function circleBlock(size, filled, b)
    local inner = filled and size or (size - 2 * b)
    return FrameContainer:new{
        bordersize = filled and 0 or b, color = W.INK, margin = 0, padding = 0,
        radius = math.floor(size / 2),
        background = filled and W.INK or nil,
        CenterContainer:new{ dimen = Geom:new{ w = inner, h = inner }, W.HSpace(0) },
    }
end
W.circleBlock = circleBlock

--- Progress dots: `filled` of `total`, size and border in mockup px.
-- Too many dots for `max_width` are shrunk to fit.
function W.Dots(total, filled, size, border, gap, max_width)
    local s, b, g = W.px(size), math.max(1, W.px(border)), W.px(gap)
    if max_width and total > 0 then
        while total * s + (total - 1) * g > max_width and s > W.px(8) do
            s = s - 1
            g = math.max(1, math.floor(g * 0.9))
        end
    end
    local items = {}
    for i = 1, total do items[i] = circleBlock(s, i <= filled, b) end
    return W.HRow(items, g)
end

---------------------------------------------------------------------------
-- Tappable things
---------------------------------------------------------------------------

--- Wraps any widget so a tap anywhere on it calls `callback`.
W.Tappable = InputContainer:extend{ callback = nil }

function W.Tappable:init()
    local size = self[1]:getSize()
    self.dimen = Geom:new{ x = 0, y = 0, w = size.w, h = size.h }
    self.ges_events = {
        TapEEK = { GestureRange:new{ ges = "tap", range = function() return self.dimen end } },
    }
end

function W.Tappable:onTapEEK()
    if self.callback then self.callback() end
    return true
end

function W.tappable(widget, callback)
    return W.Tappable:new{ widget, callback = callback }
end

--[[--
Button. opts: text, width (device px), height (mockup px, default 96),
filled (black), border (mockup px, default 3), text_size (default 32),
icon_left / icon_right (icon names), icon_size, callback.
]]
function W.Button(opts)
    local fg = opts.filled and W.WHITE or W.INK
    local icon_color = opts.filled and W.ICON_WHITE or nil
    local parts = {}
    if opts.icon_left then parts[#parts + 1] = W.Icon(opts.icon_left, opts.icon_size or 34, icon_color) end
    parts[#parts + 1] = W.Text{ text = opts.text, face = W.face(W.SANS_BOLD, opts.text_size or 32), color = fg,
                                max_width = opts.width and (opts.width - W.px(48)) or nil }
    if opts.icon_right then parts[#parts + 1] = W.Icon(opts.icon_right, opts.icon_size or 40, icon_color) end
    local content = W.HRow(parts, W.px(opts.gap or 14))
    local box = W.Box{
        content = content,
        border = opts.filled and 0 or (opts.border or 3),
        pad_h = 24,
        width = opts.width,
        min_height = W.px(opts.height or 96),
        background = opts.filled and W.INK or W.PAPER,
        align = "center",
    }
    return W.tappable(box, opts.callback)
end

---------------------------------------------------------------------------
-- Page frame: a full-screen InputContainer with the shared furniture
---------------------------------------------------------------------------

--[[--
Lays out `items` top to bottom inside a page of `height`:
  a widget, or { space = n } (mockup px gap, shrinks if the page is too
  full), or { flex = true } (takes what is left; several share it).
Returns a VerticalGroup exactly `height` tall (or taller if nothing can
shrink enough).
]]
function W.stack(items, height)
    local fixed, spaces, flexes = 0, 0, 0
    for _, it in ipairs(items) do
        if it.space then spaces = spaces + W.px(it.space)
        elseif it.flex then flexes = flexes + 1
        else fixed = fixed + it:getSize().h end
    end
    local room = height - fixed
    local scale = 1
    if spaces > 0 and spaces > room then scale = math.max(0, room / spaces) end
    local used_spaces = 0
    local group = VerticalGroup:new{ align = "left" }
    for _, it in ipairs(items) do
        if it.space then
            local h = math.floor(W.px(it.space) * scale)
            used_spaces = used_spaces + h
            table.insert(group, VerticalSpan:new{ width = h })
        elseif not it.flex then
            table.insert(group, it)
        end
    end
    local left = math.max(0, room - used_spaces)
    if flexes > 0 then
        -- Rebuild with the flexible gaps inserted at their positions.
        local each = math.floor(left / flexes)
        local g2 = VerticalGroup:new{ align = "left" }
        local i = 1
        for _, it in ipairs(items) do
            if it.flex then
                table.insert(g2, VerticalSpan:new{ width = each })
            else
                table.insert(g2, group[i])
                i = i + 1
            end
        end
        return g2, scale
    end
    return group, scale
end

--- A full-screen page: paper background, side padding, swipe/keys hooks.
W.Page = InputContainer:extend{
    name = "eek_page",
    on_close = nil,       -- swipe down / Back key
    on_swipe = nil,       -- function(direction) -> handled
}

function W.Page:init()
    self.dimen = Geom:new{ x = 0, y = 0, w = Screen:getWidth(), h = Screen:getHeight() }
    self.covers_fullscreen = true
    if Device:hasKeys() then
        self.key_events.Close = { { Device.input.group.Back } }
    end
    self.ges_events.Swipe = { GestureRange:new{ ges = "swipe", range = self.dimen } }
    self.pad_h = W.px(64)
    self.content_w = self.dimen.w - 2 * self.pad_h
    self:rebuild()
end

--- Subclasses implement build() returning a list for W.stack, plus
-- top/bottom padding in mockup px (self.pad_top, self.pad_bottom).
function W.Page:rebuild()
    local items = self:build()
    local top, bottom = W.px(self.pad_top or 48), W.px(self.pad_bottom or 40)
    local body = W.stack(items, self.dimen.h - top - bottom)
    self.body_height = body:getSize().h
    self.body_room = self.dimen.h - top - bottom
    self[1] = FrameContainer:new{
        width = self.dimen.w, height = self.dimen.h,
        bordersize = 0, margin = 0, padding = 0,
        padding_left = self.pad_h, padding_right = self.pad_h,
        padding_top = top, padding_bottom = bottom,
        background = W.PAPER,
        body,
    }
end

function W.Page:refresh(mode)
    self:free()
    self:rebuild()
    require("ui/uimanager"):setDirty(self, mode or "ui")
end

function W.Page:onSwipe(_, ges)
    local dir = ges and ges.direction
    if self.on_swipe and self.on_swipe(dir) then return true end
    if dir == "south" then return self:onClose() end
    return false
end

function W.Page:onClose()
    if self.on_close then self.on_close() end
    return true
end

--- Kicker + big display title + subtitle, used by Back issues and My week.
function W.SectionHeader(width, title, subtitle)
    return W.VCol({
        W.Label("Early Edition", 24),
        W.DisplayText(title, 80, width),
        W.Text{ text = subtitle or "", face = W.face(W.SANS, 26), color = W.SECONDARY, max_width = width },
    }, W.px(6))
end

W.OverlapGroup = OverlapGroup

return W
