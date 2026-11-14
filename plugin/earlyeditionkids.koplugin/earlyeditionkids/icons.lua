--[[--
Icon names, colour variants and the READ stamp.

The SVG files in icons/ are drawn in ink (#121212) on a 48-unit grid with
2.5-unit strokes, like the mockups. KOReader renders SVG files through
ImageWidget -> RenderImage:renderSVGImageFile (NanoSVG), which has no
`currentColor` and no <text>, so:

- other colours (grey for read rows, white on the black buttons) are made by
  rewriting the colour in the file text and caching the result;
- the stamp's "READ" and its date are drawn as stroked paths by a tiny
  stroke font below, so the whole stamp can be rotated like the mockup.

No KOReader dependency (the controller writes the files).
]]

local Icons = {}

Icons.INK = "#121212"

Icons.TOPICS = {
    ["Liverpool FC"] = "topic-team",
    ["England"] = "topic-england",
    ["Football"] = "topic-football",
    ["Science"] = "topic-science",
    ["Space"] = "topic-space",
    ["Animals and nature"] = "topic-animals",
    ["Games and tech"] = "topic-games",
    ["Weather"] = "topic-weather",
    ["Weird but true"] = "topic-weird",
}
Icons.FALLBACK_TOPIC = "topic-generic"

function Icons.forTopic(topic)
    return Icons.TOPICS[topic or ""] or Icons.FALLBACK_TOPIC
end

--- Returns the SVG text with the ink colour replaced.
function Icons.recolor(svg, color)
    if not color or color:lower() == Icons.INK then return svg end
    return (svg:gsub("#121212", color))
end

---------------------------------------------------------------------------
-- Stroke font (cap height 6 units, width 4) for the stamp
---------------------------------------------------------------------------

local BOX = { { 0, 0 }, { 4, 0 }, { 4, 6 }, { 0, 6 }, { 0, 0 } }
local GLYPHS = {
    ["0"] = { BOX },
    ["1"] = { { { 1, 1 }, { 2, 0 }, { 2, 6 } }, { { 1, 6 }, { 3, 6 } } },
    ["2"] = { { { 0, 0 }, { 4, 0 }, { 4, 3 }, { 0, 3 }, { 0, 6 }, { 4, 6 } } },
    ["3"] = { { { 0, 0 }, { 4, 0 }, { 4, 6 }, { 0, 6 } }, { { 1, 3 }, { 4, 3 } } },
    ["4"] = { { { 0, 0 }, { 0, 3 }, { 4, 3 } }, { { 4, 0 }, { 4, 6 } } },
    ["5"] = { { { 4, 0 }, { 0, 0 }, { 0, 3 }, { 4, 3 }, { 4, 6 }, { 0, 6 } } },
    ["6"] = { { { 4, 0 }, { 0, 0 }, { 0, 6 }, { 4, 6 }, { 4, 3 }, { 0, 3 } } },
    ["7"] = { { { 0, 0 }, { 4, 0 }, { 2, 6 } } },
    ["8"] = { BOX, { { 0, 3 }, { 4, 3 } } },
    ["9"] = { { { 4, 3 }, { 0, 3 }, { 0, 0 }, { 4, 0 }, { 4, 6 }, { 0, 6 } } },
    A = { { { 0, 6 }, { 2, 0 }, { 4, 6 } }, { { 0.7, 4 }, { 3.3, 4 } } },
    B = { { { 0, 3 }, { 0, 0 }, { 3, 0 }, { 4, 1 }, { 4, 2 }, { 3, 3 }, { 0, 3 }, { 0, 6 }, { 3, 6 }, { 4, 5 }, { 4, 4 }, { 3, 3 } } },
    C = { { { 4, 0 }, { 0, 0 }, { 0, 6 }, { 4, 6 } } },
    D = { { { 0, 0 }, { 2.5, 0 }, { 4, 1.5 }, { 4, 4.5 }, { 2.5, 6 }, { 0, 6 }, { 0, 0 } } },
    E = { { { 4, 0 }, { 0, 0 }, { 0, 6 }, { 4, 6 } }, { { 0, 3 }, { 3, 3 } } },
    F = { { { 4, 0 }, { 0, 0 }, { 0, 6 } }, { { 0, 3 }, { 3, 3 } } },
    G = { { { 4, 0 }, { 0, 0 }, { 0, 6 }, { 4, 6 }, { 4, 3 }, { 2, 3 } } },
    J = { { { 1, 0 }, { 4, 0 } }, { { 3, 0 }, { 3, 6 }, { 0, 6 }, { 0, 4.5 } } },
    L = { { { 0, 0 }, { 0, 6 }, { 4, 6 } } },
    M = { { { 0, 6 }, { 0, 0 }, { 2, 3 }, { 4, 0 }, { 4, 6 } } },
    N = { { { 0, 6 }, { 0, 0 }, { 4, 6 }, { 4, 0 } } },
    O = { BOX },
    P = { { { 0, 6 }, { 0, 0 }, { 4, 0 }, { 4, 3 }, { 0, 3 } } },
    R = { { { 0, 6 }, { 0, 0 }, { 4, 0 }, { 4, 3 }, { 0, 3 } }, { { 1.5, 3 }, { 4, 6 } } },
    S = { { { 4, 0 }, { 0, 0 }, { 0, 3 }, { 4, 3 }, { 4, 6 }, { 0, 6 } } },
    T = { { { 0, 0 }, { 4, 0 } }, { { 2, 0 }, { 2, 6 } } },
    U = { { { 0, 0 }, { 0, 6 }, { 4, 6 }, { 4, 0 } } },
    V = { { { 0, 0 }, { 2, 6 }, { 4, 0 } } },
    Y = { { { 0, 0 }, { 2, 3 }, { 4, 0 } }, { { 2, 3 }, { 2, 6 } } },
}
Icons.GLYPHS = GLYPHS

local function fmt(n)
    local s = string.format("%.2f", n):gsub("0+$", ""):gsub("%.$", "")
    return s
end

--- SVG path data for `text` with its top at y, centred on cx, cap height h, letter gap g.
function Icons.strokeText(text, cx, top, h, gap)
    local scale = h / 6
    local w = 4 * scale
    local space = 2.5 * scale
    local widths = 0
    local chars = {}
    for ch in text:gmatch(".") do
        chars[#chars + 1] = ch
        widths = widths + ((ch == " ") and space or w)
    end
    widths = widths + gap * math.max(0, #chars - 1)
    local x = cx - widths / 2
    local d = {}
    for i, ch in ipairs(chars) do
        local glyph = GLYPHS[ch]
        if glyph then
            for _, line in ipairs(glyph) do
                for j, p in ipairs(line) do
                    d[#d + 1] = (j == 1 and "M" or "L") .. fmt(x + p[1] * scale) .. " " .. fmt(top + p[2] * scale)
                end
            end
        end
        x = x + ((ch == " ") and space or w) + ((i < #chars) and gap or 0)
    end
    return table.concat(d, " ")
end

--- The READ stamp from the A3 mockup, with `date_text` ("13 NOV") under READ.
function Icons.stampSvg(date_text, color)
    color = color or Icons.INK
    return table.concat({
        '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="120" viewBox="0 0 120 120">',
        '<g transform="rotate(-8 60 60)">',
        '<circle cx="60" cy="60" r="56" fill="none" stroke="', color, '" stroke-width="4"/>',
        '<circle cx="60" cy="60" r="47" fill="none" stroke="', color, '" stroke-width="1.5" stroke-dasharray="3 4"/>',
        '<path d="M60 22l5.5 11.2 12.3 1.8-8.9 8.7 2.1 12.3L60 50.2 49 56l2.1-12.3-8.9-8.7 12.3-1.8z" fill="', color, '"/>',
        '<path d="', Icons.strokeText("READ", 60, 69, 15, 4), '" fill="none" stroke="', color,
        '" stroke-width="3" stroke-linejoin="miter" stroke-linecap="square"/>',
        '<path d="', Icons.strokeText(string.upper(date_text or ""), 60, 92, 8, 2.4), '" fill="none" stroke="', color,
        '" stroke-width="1.7" stroke-linejoin="miter" stroke-linecap="square"/>',
        '</g></svg>',
    })
end

return Icons
