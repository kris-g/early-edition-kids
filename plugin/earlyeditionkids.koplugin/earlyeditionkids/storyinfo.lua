--[[--
Reads small facts out of a stored story page (DESIGN 4.8), for when the API
does not send them: the "Word to know" box and the source line.

The story page is our own server's HTML, so simple patterns are enough:

    <div class="box"><p class="label">WORD TO KNOW</p>
    <p><b>Cold stunning</b>: When a sea turtle gets so cold ...</p></div>
    ...
    <p class="source">Source: Science News Explores</p>

No KOReader dependency.
]]

local StoryInfo = {}

local ENTITIES = {
    amp = "&", lt = "<", gt = ">", quot = '"', apos = "'", nbsp = " ",
    rsquo = "\226\128\153", lsquo = "\226\128\152", ldquo = "\226\128\156", rdquo = "\226\128\157",
    ndash = "\226\128\147", mdash = "\226\128\148", hellip = "\226\128\166",
}

local function utf8char(cp)
    if cp < 0x80 then return string.char(cp) end
    if cp < 0x800 then return string.char(0xC0 + math.floor(cp / 64), 0x80 + cp % 64) end
    if cp < 0x10000 then
        return string.char(0xE0 + math.floor(cp / 4096), 0x80 + math.floor(cp / 64) % 64, 0x80 + cp % 64)
    end
    return string.char(0xF0 + math.floor(cp / 262144), 0x80 + math.floor(cp / 4096) % 64,
                       0x80 + math.floor(cp / 64) % 64, 0x80 + cp % 64)
end

--- Strips tags, decodes entities and collapses white space.
function StoryInfo.plainText(html)
    if not html then return "" end
    local s = html:gsub("<[^>]*>", "")
    s = s:gsub("&#[xX](%x+);", function(h) return utf8char(tonumber(h, 16)) end)
    s = s:gsub("&#(%d+);", function(d) return utf8char(tonumber(d)) end)
    s = s:gsub("&(%a+);", function(name) return ENTITIES[name] or ("&" .. name .. ";") end)
    s = s:gsub("%s+", " "):gsub("^ ", ""):gsub(" $", "")
    return s
end

--- { word, definition } from the "Word to know" box, or nil.
function StoryInfo.wordToKnow(html)
    if type(html) ~= "string" then return nil end
    local start = html:find("WORD TO KNOW", 1, true)
    if not start then return nil end
    local rest = html:sub(start)
    local word, def = rest:match("<b>(.-)</b>%s*:%s*(.-)</p>")
    if not word then
        -- Fall back to "Word: definition" without bold.
        local para = rest:match("</p>%s*<p[^>]*>(.-)</p>")
        if para then word, def = StoryInfo.plainText(para):match("^(.-)%s*:%s*(.+)$") end
    end
    if not word then return nil end
    word = StoryInfo.plainText(word)
    def = StoryInfo.plainText(def)
    if word == "" then return nil end
    return { word = word, definition = def }
end

--- Source name from the source line, or nil.
function StoryInfo.source(html)
    if type(html) ~= "string" then return nil end
    local line = html:match('<p class="source">(.-)</p>')
    if not line then return nil end
    local text = StoryInfo.plainText(line):gsub("^[Ss]ource[s]?:%s*", "")
    if text == "" then return nil end
    return text
end

--- Normalises the API's word_to_know (table or nil); returns nil if empty.
function StoryInfo.apiWord(w)
    if type(w) ~= "table" or type(w.word) ~= "string" or w.word == "" then return nil end
    return { word = w.word, definition = type(w.definition) == "string" and w.definition or "" }
end

return StoryInfo
