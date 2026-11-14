--[[--
KOReader adapters for the pure modules: file system, HTTP transport,
settings backends, and clean-up of KOReader's own per-document files.

Everything KOReader-specific that the pure modules need goes through here,
so those modules stay testable without KOReader.

KOReader APIs used (checked against koreader master, 13 November 2026):
- libs/libkoreader-lfs: attributes, dir
- util.makePath, util.removePath (frontend/util.lua)
- ffi/util: purgeDir, realpath, dirname (koreader-base ffi/util.lua)
- socket.http request with a sink, ltn12.source.string, socket.skip
  (same pattern as plugins/opds.koplugin/opdsclient.lua)
- socketutil:set_timeout / reset_timeout / table_sink (frontend/socketutil.lua)
- LuaSettings:open / flush (frontend/luasettings.lua)
- DataStorage:getSettingsDir (datastorage.lua)
- DocSettings:getSidecarDir(path, "doc"|"dir"|"hash"), DocSettings.isHashLocationEnabled,
  DocSettings.setIsHashLocationEnabled (frontend/docsettings.lua)
- ReadHistory:removeItemByPath (frontend/readhistory.lua)
- BookList.resetBookInfoCache (frontend/ui/widget/booklist.lua)
]]

local Const = require("earlyeditionkids/const")
local logger = require("logger")

local Env = {}

---------------------------------------------------------------------------
-- File system (interface documented in issues.lua)
---------------------------------------------------------------------------

function Env.fs()
    local lfs = require("libs/libkoreader-lfs")
    local util = require("util")
    local ffiutil = require("ffi/util")
    local fs = {}

    function fs.isDir(p) return lfs.attributes(p, "mode") == "directory" end
    function fs.isFile(p) return lfs.attributes(p, "mode") == "file" end

    function fs.list(p)
        local out = {}
        local ok, iter, dir_obj = pcall(lfs.dir, p)
        if not ok then return out end
        for name in iter, dir_obj do
            if name ~= "." and name ~= ".." then table.insert(out, name) end
        end
        table.sort(out)
        return out
    end

    function fs.mkdirp(p)
        if fs.isDir(p) then return true end
        local ok, err = util.makePath(p)
        if fs.isDir(p) then return true end
        return ok, err
    end

    function fs.removeTree(p)
        if fs.isDir(p) then
            local ok, err = ffiutil.purgeDir(p)
            if not ok and err then logger.warn("Early Edition Kids: could not remove", p, err) end
            return ok, err
        elseif lfs.attributes(p, "mode") then
            return os.remove(p)
        end
        return true
    end

    function fs.removeFile(p) return os.remove(p) end
    function fs.rename(a, b) return os.rename(a, b) end

    -- Write to a side file then rename, so a power cut never leaves half a story.
    function fs.writeFile(p, data)
        local part = p .. ".part"
        local f, err = io.open(part, "wb")
        if not f then return nil, err end
        local ok, werr = f:write(data)
        f:close()
        if not ok then
            os.remove(part)
            return nil, werr
        end
        local rok, rerr = os.rename(part, p)
        if not rok then
            os.remove(part)
            return nil, rerr
        end
        return true
    end

    function fs.readFile(p)
        local f = io.open(p, "rb")
        if not f then return nil end
        local s = f:read("*a")
        f:close()
        return s
    end

    return fs
end

---------------------------------------------------------------------------
-- HTTP transport (interface documented in api.lua)
---------------------------------------------------------------------------

function Env.transport(req)
    local http = require("socket.http")
    local ltn12 = require("ltn12")
    local socket = require("socket")
    local socketutil = require("socketutil")

    local chunks = {}
    local request = {
        url = req.url,
        method = req.method,
        headers = req.headers,
        sink = socketutil.table_sink(chunks),
    }
    if req.body then
        request.source = ltn12.source.string(req.body)
    end
    socketutil:set_timeout(Const.HTTP_BLOCK_TIMEOUT, Const.HTTP_TOTAL_TIMEOUT)
    -- http.request returns 1, code, headers, status on success and nil, err on
    -- failure; socket.skip(1, ...) drops the first value (opdsclient.lua does the same).
    local ok, code, headers = pcall(function()
        return socket.skip(1, http.request(request))
    end)
    socketutil:reset_timeout()
    if not ok then
        return nil, tostring(code)
    end
    if type(code) ~= "number" then
        return nil, tostring(code or "no response")
    end
    local lower = {}
    for k, v in pairs(headers or {}) do lower[string.lower(k)] = v end
    return { status = code, headers = lower, body = table.concat(chunks) }
end

---------------------------------------------------------------------------
-- Settings backends (LuaSettings files in KOReader's settings folder)
---------------------------------------------------------------------------

function Env.settingsBackend(filename)
    local LuaSettings = require("luasettings")
    local DataStorage = require("datastorage")
    local path = DataStorage:getSettingsDir() .. "/" .. filename
    local settings
    return {
        path = path,
        load = function()
            settings = LuaSettings:open(path)
            return settings.data
        end,
        save = function(data)
            settings = settings or LuaSettings:open(path)
            settings.data = data
            settings:flush()
        end,
    }
end

---------------------------------------------------------------------------
-- KOReader's per-document leftovers
---------------------------------------------------------------------------

--[[--
Called for each story file before Early Edition Kids deletes it (tidy, hidden story,
replaced version). Removes:

- the sidecar folder KOReader keeps for the file (reading position etc.) in
  each possible location: next to the file ("doc", which is inside our date
  folder anyway), under koreader/docsettings ("dir"), and under
  koreader/hashdocsettings ("hash", named by a hash of the file, so it must
  be worked out before the file goes);
- the file's history entry, and BookList's cached info for the path.
]]
function Env.cleanupDocFile(path)
    local ok, err = pcall(function()
        local DocSettings = require("docsettings")
        local ffiutil = require("ffi/util")
        local lfs = require("libs/libkoreader-lfs")
        local util = require("util")
        local locations = { "doc", "dir" }
        local hash_enabled = DocSettings.isHashLocationEnabled()
        if hash_enabled then table.insert(locations, "hash") end
        for _, loc in ipairs(locations) do
            local sdr = DocSettings:getSidecarDir(path, loc)
            if sdr and sdr ~= "" and lfs.attributes(sdr, "mode") == "directory" then
                ffiutil.purgeDir(sdr)
                if loc ~= "doc" then
                    -- Prune now-empty parent folders, as DocSettings.removeSidecarDir does.
                    util.removePath(ffiutil.dirname(sdr))
                end
            end
        end
        if hash_enabled then
            DocSettings.setIsHashLocationEnabled(nil) -- re-check, the hash folder may be gone now
        end
        require("readhistory"):removeItemByPath(path)
        require("ui/widget/booklist").resetBookInfoCache(path)
    end)
    if not ok then
        logger.warn("Early Edition Kids: sidecar clean-up failed for", path, err)
    end
end

--- KOReader side of the Simple UI bridge (simpleui.lua documents the API).
function Env.simpleUI()
    local env = {}
    function env.pluginEnabled()
        -- PluginLoader keeps the list of enabled plugin modules (pluginloader.lua);
        -- a plugin disabled in the Plugin manager is not in it.
        local PluginLoader = require("pluginloader")
        for _, p in ipairs(PluginLoader.enabled_plugins or {}) do
            if p.name == "simpleui" then return true end
        end
        return false
    end
    function env.settingEnabled()
        local store = package.loaded["infra/sui_store"]
        if store and store.nilOrTrue then
            return store:nilOrTrue("simpleui_enabled")
        end
        local LuaSettings = require("luasettings")
        local DataStorage = require("datastorage")
        local path = DataStorage:getSettingsDir() .. "/simpleui/sui_settings.lua"
        local lfs = require("libs/libkoreader-lfs")
        if lfs.attributes(path, "mode") ~= "file" then return true end
        return LuaSettings:open(path):readSetting("simpleui_enabled") ~= false
    end
    function env.loadedQA()
        return package.loaded["features/sui_quickactions"]
    end
    function env.requireQA()
        return require("features/sui_quickactions")
    end
    function env.goHome()
        local Dispatcher = require("dispatcher")
        Dispatcher:execute({ simpleui_go_homescreen = true })
    end
    function env.log(level, ...)
        (logger[level] or logger.info)("Early Edition Kids:", ...)
    end
    return env
end

--- Wall clock (device epoch seconds); the tests replace it.
function Env.now() return os.time() end

--- Monotonic seconds (stops during suspend on Linux), for the reading timer.
function Env.monotonic()
    local time = require("ui/time")
    return time.to_s(time.monotonic())
end

return Env
