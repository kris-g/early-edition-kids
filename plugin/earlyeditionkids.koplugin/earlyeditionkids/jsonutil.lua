--[[--
JSON adapter.

KOReader ships two JSON libraries (checked in koreader-base/thirdparty):
`rapidjson` (lua-rapidjson, C, used by the calibre and exporter plugins) and
`json` (harningt/luajson, used by wikipedia.lua and opds). We prefer
`rapidjson`. If neither loads (the test runner), a small pure-Lua codec
below is used, which follows the same conventions:

- `__jsontype = "object" | "array"` metafield decides how a table encodes
  (lua-rapidjson and luajson both honour it);
- `null` is a sentinel value that encodes as JSON null.

Decoded JSON null becomes Lua nil (rapidjson's null sentinel is stripped),
so callers never see a userdata.
]]

local JSON = {}

local ok_rj, rapidjson = pcall(require, "rapidjson")
if not ok_rj or type(rapidjson) ~= "table" or not rapidjson.decode then
    rapidjson = nil
end

JSON.backend = rapidjson and "rapidjson" or "pure-lua"

local NULL = rapidjson and rapidjson.null or setmetatable({}, { __tostring = function() return "null" end })
JSON.null = NULL

function JSON.object(t)
    t = t or {}
    if rapidjson and rapidjson.object then return rapidjson.object(t) end
    return setmetatable(t, { __jsontype = "object" })
end

function JSON.array(t)
    t = t or {}
    if rapidjson and rapidjson.array then return rapidjson.array(t) end
    return setmetatable(t, { __jsontype = "array" })
end

---------------------------------------------------------------------------
-- Pure-Lua codec (fallback and tests)
---------------------------------------------------------------------------

local escapes = { ['"'] = '\\"', ["\\"] = "\\\\", ["\b"] = "\\b", ["\f"] = "\\f",
                  ["\n"] = "\\n", ["\r"] = "\\r", ["\t"] = "\\t" }

local function encodeString(s)
    return '"' .. s:gsub('[%c"\\]', function(c)
        return escapes[c] or string.format("\\u%04x", c:byte())
    end) .. '"'
end

local function isArray(t)
    local mt = getmetatable(t)
    if mt and mt.__jsontype then return mt.__jsontype == "array" end
    local n = 0
    for k in pairs(t) do
        if type(k) ~= "number" or k < 1 or math.floor(k) ~= k then return false end
        n = n + 1
    end
    if n == 0 then return false end -- empty table encodes as an object, like rapidjson
    for i = 1, n do if t[i] == nil then return false end end
    return true
end

local encodeValue

encodeValue = function(v, out)
    local tv = type(v)
    if v == NULL or v == nil then
        out[#out + 1] = "null"
    elseif tv == "boolean" then
        out[#out + 1] = v and "true" or "false"
    elseif tv == "number" then
        if v ~= v or v == math.huge or v == -math.huge then
            out[#out + 1] = "null"
        elseif math.floor(v) == v and math.abs(v) < 1e15 then
            out[#out + 1] = string.format("%d", v)
        else
            out[#out + 1] = string.format("%.14g", v)
        end
    elseif tv == "string" then
        out[#out + 1] = encodeString(v)
    elseif tv == "table" then
        if isArray(v) then
            out[#out + 1] = "["
            for i = 1, #v do
                if i > 1 then out[#out + 1] = "," end
                encodeValue(v[i], out)
            end
            out[#out + 1] = "]"
        else
            out[#out + 1] = "{"
            local keys = {}
            for k in pairs(v) do keys[#keys + 1] = tostring(k) end
            table.sort(keys)
            for i, k in ipairs(keys) do
                if i > 1 then out[#out + 1] = "," end
                out[#out + 1] = encodeString(k)
                out[#out + 1] = ":"
                local val = v[k]
                if val == nil then val = v[tonumber(k)] end
                encodeValue(val, out)
            end
            out[#out + 1] = "}"
        end
    else
        error("cannot encode " .. tv)
    end
end

local function pureEncode(v)
    local out = {}
    encodeValue(v, out)
    return table.concat(out)
end

local function utf8char(cp)
    if cp < 0x80 then return string.char(cp) end
    if cp < 0x800 then
        return string.char(0xC0 + math.floor(cp / 64), 0x80 + cp % 64)
    end
    if cp < 0x10000 then
        return string.char(0xE0 + math.floor(cp / 4096), 0x80 + math.floor(cp / 64) % 64, 0x80 + cp % 64)
    end
    return string.char(0xF0 + math.floor(cp / 262144), 0x80 + math.floor(cp / 4096) % 64,
                       0x80 + math.floor(cp / 64) % 64, 0x80 + cp % 64)
end

local function pureDecode(str)
    local pos = 1
    local function err(msg) error(string.format("JSON %s at %d", msg, pos), 0) end
    local function ws() pos = str:find("[^ \t\r\n]", pos) or (#str + 1) end
    local value

    local function parseString()
        pos = pos + 1
        local buf = {}
        while true do
            local c = str:sub(pos, pos)
            if c == "" then err("unterminated string") end
            if c == '"' then pos = pos + 1; break end
            if c == "\\" then
                local e = str:sub(pos + 1, pos + 1)
                local map = { b = "\b", f = "\f", n = "\n", r = "\r", t = "\t", ['"'] = '"', ["\\"] = "\\", ["/"] = "/" }
                if map[e] then
                    buf[#buf + 1] = map[e]; pos = pos + 2
                elseif e == "u" then
                    local hex = str:sub(pos + 2, pos + 5)
                    local cp = tonumber(hex, 16) or err("bad \\u escape")
                    pos = pos + 6
                    if cp >= 0xD800 and cp <= 0xDBFF and str:sub(pos, pos + 1) == "\\u" then
                        local lo = tonumber(str:sub(pos + 2, pos + 5), 16)
                        if lo and lo >= 0xDC00 and lo <= 0xDFFF then
                            cp = 0x10000 + (cp - 0xD800) * 1024 + (lo - 0xDC00)
                            pos = pos + 6
                        end
                    end
                    buf[#buf + 1] = utf8char(cp)
                else
                    err("bad escape")
                end
            else
                local j = str:find('["\\]', pos) or (#str + 1)
                buf[#buf + 1] = str:sub(pos, j - 1)
                pos = j
            end
        end
        return table.concat(buf)
    end

    value = function()
        ws()
        local c = str:sub(pos, pos)
        if c == "{" then
            pos = pos + 1
            local t = {}
            ws()
            if str:sub(pos, pos) == "}" then pos = pos + 1; return setmetatable(t, { __jsontype = "object" }) end
            while true do
                ws()
                if str:sub(pos, pos) ~= '"' then err("expected key") end
                local k = parseString()
                ws()
                if str:sub(pos, pos) ~= ":" then err("expected ':'") end
                pos = pos + 1
                t[k] = value()
                ws()
                local d = str:sub(pos, pos)
                pos = pos + 1
                if d == "}" then break end
                if d ~= "," then err("expected ',' or '}'") end
            end
            return setmetatable(t, { __jsontype = "object" })
        elseif c == "[" then
            pos = pos + 1
            local t, n = {}, 0
            ws()
            if str:sub(pos, pos) == "]" then pos = pos + 1; return setmetatable(t, { __jsontype = "array" }) end
            while true do
                n = n + 1
                t[n] = value()
                ws()
                local d = str:sub(pos, pos)
                pos = pos + 1
                if d == "]" then break end
                if d ~= "," then err("expected ',' or ']'") end
            end
            return setmetatable(t, { __jsontype = "array" })
        elseif c == '"' then
            return parseString()
        elseif str:sub(pos, pos + 3) == "true" then
            pos = pos + 4; return true
        elseif str:sub(pos, pos + 4) == "false" then
            pos = pos + 5; return false
        elseif str:sub(pos, pos + 3) == "null" then
            pos = pos + 4; return nil
        else
            local num = str:match("^-?%d+%.?%d*[eE]?[-+]?%d*", pos)
            if not num or num == "" then err("unexpected character") end
            pos = pos + #num
            return tonumber(num) or err("bad number")
        end
    end

    local result = value()
    ws()
    if pos <= #str then err("trailing data") end
    return result
end

-- Replace rapidjson's null sentinel with nil, recursively.
local function stripNull(v)
    if v == NULL then return nil end
    if type(v) == "table" then
        for k, x in pairs(v) do
            if x == NULL then v[k] = nil
            elseif type(x) == "table" then stripNull(x) end
        end
    end
    return v
end

--- Returns value or nil, err. Never raises.
function JSON.decode(s)
    if type(s) ~= "string" then return nil, "not a string" end
    if rapidjson then
        local ok, v, e = pcall(rapidjson.decode, s)
        if not ok then return nil, tostring(v) end
        if v == nil then return nil, e or "decode failed" end
        return stripNull(v)
    end
    local ok, v = pcall(pureDecode, s)
    if not ok then return nil, v end
    return v
end

--- Returns string or nil, err. Never raises.
function JSON.encode(v)
    if rapidjson then
        local ok, s, e = pcall(rapidjson.encode, v)
        if not ok then return nil, tostring(s) end
        if s == nil then return nil, e or "encode failed" end
        return s
    end
    local ok, s = pcall(pureEncode, v)
    if not ok then return nil, s end
    return s
end

-- Exposed for the tests, so the fallback is covered even where rapidjson exists.
JSON._pureEncode = pureEncode
JSON._pureDecode = pureDecode

return JSON
