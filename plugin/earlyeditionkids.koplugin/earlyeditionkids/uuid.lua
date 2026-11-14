--[[--
Random UUID v4 strings (lower case, with dashes).

KOReader's own `random.uuid` seeds math.random with os.time() only, so two
boots with a wrong clock could repeat ids. The server de-duplicates on
(device_id, client_event_id), so a repeat would silently lose an event. We
read /dev/urandom when we can and only fall back to math.random.
]]

local UUID = {}

local seeded = false

local function seed()
    if seeded then return end
    seeded = true
    local addr = tonumber(tostring({}):match("0x(%x+)") or "0", 16) or 0
    math.randomseed((os.time() + math.floor(os.clock() * 1000000) + addr) % 2147483647)
    -- Discard the first few values, some libc generators are poor at the start.
    for _ = 1, 5 do math.random() end
end

local function urandomBytes(n)
    local f = io.open("/dev/urandom", "rb")
    if not f then return nil end
    local s = f:read(n)
    f:close()
    if not s or #s ~= n then return nil end
    local t = {}
    for i = 1, n do t[i] = s:byte(i) end
    return t
end

local function mathBytes(n)
    seed()
    local t = {}
    for i = 1, n do t[i] = math.random(0, 255) end
    return t
end

--- Returns a v4 UUID. `bytes_fn(n)` can be injected for tests.
function UUID.v4(bytes_fn)
    local b = (bytes_fn or urandomBytes)(16) or mathBytes(16)
    b[7] = (b[7] % 16) + 64   -- version 4
    b[9] = (b[9] % 64) + 128  -- variant 10xx
    return string.format(
        "%02x%02x%02x%02x-%02x%02x-%02x%02x-%02x%02x-%02x%02x%02x%02x%02x%02x",
        b[1], b[2], b[3], b[4], b[5], b[6], b[7], b[8],
        b[9], b[10], b[11], b[12], b[13], b[14], b[15], b[16])
end

function UUID.isValid(s)
    return type(s) == "string"
        and s:match("^%x%x%x%x%x%x%x%x%-%x%x%x%x%-4%x%x%x%-[89ab]%x%x%x%-%x%x%x%x%x%x%x%x%x%x%x%x$") ~= nil
end

return UUID
