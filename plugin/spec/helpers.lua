-- Test helpers: a tiny test framework, an in-memory file system, a fake
-- HTTP transport and memory backends. Lua 5.1 compatible.

local H = {}

---------------------------------------------------------------------------
-- Framework
---------------------------------------------------------------------------

H.results = { passed = 0, failed = 0, failures = {} }
local current_suite = ""

function H.describe(name, fn)
    local prev = current_suite
    current_suite = (prev ~= "" and (prev .. " / ") or "") .. name
    fn()
    current_suite = prev
end

function H.it(name, fn)
    local full = current_suite .. " :: " .. name
    local ok, err = xpcall(fn, function(e) return debug.traceback(tostring(e), 2) end)
    if ok then
        H.results.passed = H.results.passed + 1
    else
        H.results.failed = H.results.failed + 1
        table.insert(H.results.failures, full .. "\n    " .. tostring(err))
    end
end

local function fmt(v)
    if type(v) == "string" then return string.format("%q", v) end
    return tostring(v)
end

function H.eq(actual, expected, msg)
    if actual ~= expected then
        error((msg and (msg .. ": ") or "") .. "expected " .. fmt(expected) .. ", got " .. fmt(actual), 2)
    end
end

function H.truthy(v, msg)
    if not v then error((msg or "expected truthy") .. ", got " .. fmt(v), 2) end
end

function H.falsy(v, msg)
    if v then error((msg or "expected falsy") .. ", got " .. fmt(v), 2) end
end

---------------------------------------------------------------------------
-- In-memory file system matching the fs interface in issues.lua
---------------------------------------------------------------------------

function H.memfs()
    local files, dirs = {}, { ["/"] = true }
    local fs = { files = files, dirs = dirs }

    local function parent(p) return p:match("^(.*)/[^/]+$") or "/" end

    function fs.isDir(p) return dirs[p] == true end
    function fs.isFile(p) return files[p] ~= nil end
    function fs.mkdirp(p)
        local acc = ""
        for part in p:gmatch("[^/]+") do
            acc = acc .. "/" .. part
            if files[acc] then return nil, "file in the way" end
            dirs[acc] = true
        end
        return true
    end
    function fs.list(p)
        local out, seen = {}, {}
        local prefix = p .. "/"
        local function add(path)
            if path:sub(1, #prefix) == prefix then
                local name = path:sub(#prefix + 1):match("^[^/]+")
                if name and not seen[name] then seen[name] = true; table.insert(out, name) end
            end
        end
        for k in pairs(files) do add(k) end
        for k in pairs(dirs) do add(k) end
        table.sort(out)
        return out
    end
    function fs.removeTree(p)
        local prefix = p .. "/"
        for k in pairs(files) do if k == p or k:sub(1, #prefix) == prefix then files[k] = nil end end
        for k in pairs(dirs) do if k == p or k:sub(1, #prefix) == prefix then dirs[k] = nil end end
        return true
    end
    function fs.removeFile(p) files[p] = nil; return true end
    function fs.rename(a, b)
        if not dirs[a] and not files[a] then return nil, "no such path" end
        if dirs[b] or files[b] then return nil, "target exists" end
        local pa = a .. "/"
        local moves_f, moves_d = {}, {}
        for k, v in pairs(files) do
            if k == a then moves_f[b] = v; files[k] = nil
            elseif k:sub(1, #pa) == pa then moves_f[b .. k:sub(#a + 1)] = v; files[k] = nil end
        end
        for k in pairs(dirs) do
            if k == a then moves_d[b] = true; dirs[k] = nil
            elseif k:sub(1, #pa) == pa then moves_d[b .. k:sub(#a + 1)] = true; dirs[k] = nil end
        end
        for k, v in pairs(moves_f) do files[k] = v end
        for k in pairs(moves_d) do dirs[k] = true end
        return true
    end
    function fs.writeFile(p, data)
        if not dirs[parent(p)] then return nil, "no parent dir for " .. p end
        files[p] = data
        return true
    end
    function fs.readFile(p) return files[p] end
    return fs
end

---------------------------------------------------------------------------
-- Fake HTTP transport
---------------------------------------------------------------------------

-- routes["GET /api/issue/today"] = function(req) return {status=..., body=..., headers=...} end
-- or a response table; or the string "down" for a network failure.
function H.transport(routes)
    local t = { requests = {}, routes = routes or {} }
    t.fn = function(req)
        table.insert(t.requests, req)
        local path = req.url:gsub("^https?://[^/]+", "")
        local route = t.routes[req.method .. " " .. path]
        if t.down or route == "down" then return nil, "connection refused" end
        if type(route) == "function" then route = route(req) end
        if not route then return { status = 404, headers = {}, body = '{"detail":"Not Found"}' } end
        return { status = route.status or 200, headers = route.headers or {}, body = route.body or "" }
    end
    return t
end

---------------------------------------------------------------------------
-- Memory backends and a fixed clock
---------------------------------------------------------------------------

function H.memBackend(initial)
    local b = { data = initial, saves = 0 }
    b.load = function() return b.data end
    b.save = function(d) b.data = d; b.saves = b.saves + 1 end
    return b
end

function H.counterIds()
    local n = 0
    return function()
        n = n + 1
        return string.format("00000000-0000-4000-8000-%012d", n)
    end
end

return H
