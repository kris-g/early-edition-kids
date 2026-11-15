--[[--
The server address typed on the Kindle (Early Edition settings → Server address).

normalize() tidies what was typed: it trims spaces, adds http:// when there is
no scheme, and drops trailing slashes. It returns nil and a message for text
that can't be an address, so the dialog can say what's wrong.
]]

local ServerUrl = {}

ServerUrl.HINT = "http://192.168.1.50:8080"

function ServerUrl.normalize(text)
    local s = tostring(text or ""):gsub("^%s+", ""):gsub("%s+$", "")
    if s == "" then return "" end -- empty clears the setting
    if not s:find("^%a[%w+.-]*://") then s = "http://" .. s end
    s = s:gsub("/+$", "")
    local scheme, host, port = s:match("^(%a[%w+.-]*)://([^/:]+):?(%d*)")
    if not scheme or (scheme:lower() ~= "http" and scheme:lower() ~= "https") then
        return nil, "The address should start with http://, for example " .. ServerUrl.HINT
    end
    if not host or not host:find("^[%w][%w.-]*$") or s:find("%s") then
        return nil, "That doesn't look like an address. It should look like " .. ServerUrl.HINT
    end
    if port ~= "" and (tonumber(port) < 1 or tonumber(port) > 65535) then
        return nil, "The port number after the colon should be between 1 and 65535."
    end
    return s
end

return ServerUrl
