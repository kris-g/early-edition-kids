--[[--
HTTP client for the Early Edition Kids server (CONTRACT "HTTP API").

The transport is injected:

    transport{ method, url, headers, body } -> { status = 200, headers = {...lower-case...}, body = "..." }
                                            or nil, "error message"

In KOReader it is built on socket.http + ltn12 + socketutil (env.lua); in
the tests it is a fake. Every call returns a result table:

    { kind = "ok" | "not_found" | "network" | "server", status, data, body,
      date_header, message }

`network` means no HTTP response at all (Wi-Fi down, timeout, refused);
`server` means a response other than 200/404, or a 200 we could not parse.
]]

local Api = {}
Api.__index = Api

function Api.new(opts)
    local self = setmetatable({}, Api)
    self.base_url = (opts.base_url or ""):gsub("/+$", "")
    self.transport = opts.transport
    self.json = opts.json
    return self
end

--- Joins the configured server URL and a server-relative path from the API.
-- The plugin never builds story paths itself (CONTRACT).
function Api.joinUrl(base, path)
    base = (base or ""):gsub("/+$", "")
    if type(path) ~= "string" or path == "" then return base end
    if path:match("^https?://") then return path end
    if path:sub(1, 1) ~= "/" then path = "/" .. path end
    return base .. path
end

local function call(self, method, path, body, accept)
    local headers = { ["accept"] = accept or "application/json" }
    if body then
        headers["content-type"] = "application/json"
        headers["content-length"] = tostring(#body)
    end
    local ok, resp, err = pcall(self.transport, {
        method = method,
        url = Api.joinUrl(self.base_url, path),
        headers = headers,
        body = body,
    })
    if not ok then
        return { kind = "network", message = tostring(resp) }
    end
    if type(resp) ~= "table" or type(resp.status) ~= "number" then
        return { kind = "network", message = tostring(err or resp) }
    end
    local h = resp.headers or {}
    local result = {
        status = resp.status,
        body = resp.body or "",
        date_header = h["date"],
    }
    if resp.status == 200 then
        result.kind = "ok"
    elseif resp.status == 404 then
        result.kind = "not_found"
    else
        result.kind = "server"
        result.message = "HTTP " .. resp.status
    end
    return result
end

local function decodeOk(self, result)
    if result.kind ~= "ok" then return result end
    local data, err = self.json.decode(result.body)
    if type(data) ~= "table" then
        result.kind = "server"
        result.message = "bad JSON: " .. tostring(err)
        return result
    end
    result.data = data
    return result
end

--- Checks the shape of an issue response. Returns true or false, reason.
function Api.validIssue(data)
    if type(data) ~= "table" then return false, "not an object" end
    if type(data.date) ~= "string" or not data.date:match("^%d%d%d%d%-%d%d%-%d%d$") then
        return false, "bad date"
    end
    if type(data.version) ~= "number" then return false, "bad version" end
    if type(data.stories) ~= "table" then return false, "no stories" end
    for _, s in ipairs(data.stories) do
        if type(s) ~= "table" or type(s.id) ~= "number" or type(s.path) ~= "string" then
            return false, "bad story"
        end
    end
    return true
end

function Api:getIssueToday()
    local r = decodeOk(self, call(self, "GET", "/api/issue/today"))
    if r.kind == "ok" then
        local valid, why = Api.validIssue(r.data)
        if not valid then
            r.kind = "server"
            r.message = "bad issue: " .. why
            r.data = nil
        end
    end
    return r
end

--- GET /api/issue/{YYYY-MM-DD}: a back issue, same shape as today's; 404
-- (kind "not_found") when that date has no issue (CONTRACT "HTTP API").
function Api:getIssue(date)
    if type(date) ~= "string" or not date:match("^%d%d%d%d%-%d%d%-%d%d$") then
        return { kind = "server", message = "bad date " .. tostring(date) }
    end
    local r = decodeOk(self, call(self, "GET", "/api/issue/" .. date))
    if r.kind == "ok" then
        local valid, why = Api.validIssue(r.data)
        if valid and r.data.date ~= date then
            valid, why = false, "asked for " .. date .. ", got " .. tostring(r.data.date)
        end
        if not valid then
            r.kind = "server"
            r.message = "bad issue: " .. why
            r.data = nil
        end
    end
    return r
end

--- `wire_events` are already in wire form (events.lua Queue.toWire).
-- `paper` is the stored { id, root } of the paper the events belong to, or
-- nil; the server refuses (409) events meant for another child's paper.
function Api:postEvents(device_id, wire_events, paper)
    local profile, profile_root
    if type(paper) == "table" and type(paper.id) == "string" then
        profile, profile_root = paper.id, paper.root == true
    end
    local body, err = self.json.encode({
        device_id = device_id,
        events = self.json.array(wire_events),
        profile = profile,
        profile_root = profile_root,
    })
    if not body then
        return { kind = "server", message = "encode failed: " .. tostring(err) }
    end
    local r = decodeOk(self, call(self, "POST", "/api/events", body))
    if r.kind == "ok" then
        local accepted = r.data.accepted
        if type(accepted) ~= "table" then
            r.kind = "server"
            r.message = "no accepted list"
        else
            r.accepted = accepted
        end
    end
    return r
end

--- Downloads a story file from a server-relative path.
--- Downloads a story page (or, with accept = "image/jpeg", its photo).
function Api:download(path, accept)
    local r = call(self, "GET", path, nil, accept or "text/html")
    if r.kind == "ok" and (r.body == nil or r.body == "") then
        r.kind = "server"
        r.message = "empty body"
    end
    return r
end

return Api
