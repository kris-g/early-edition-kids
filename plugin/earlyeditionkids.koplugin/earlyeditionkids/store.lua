--[[--
Settings/state store with no KOReader dependency.

KOReader creates a separate plugin instance for the file manager and for
each opened document, so nothing may live only in a plugin instance. This
store is a module-level singleton (one per KOReader process, shared by all
instances through `package.loaded`) and every change is written through to
the settings file by `save()`.

The backend is `{ load = function() return table end, save = function(data) end }`;
in KOReader it wraps LuaSettings, in the tests a plain table.

Layout of `data`:

    device_id   = "uuid"
    current_date = "2026-11-13"          -- newest issue on the device
    clock_skew   = 12                    -- server minus device clock, seconds
    sync = { next_auto_at, last_attempt_at, last_success_at, last_result }
    queue = { event, ... }               -- see events.lua
    issues = { [date] = { version, opened = {[id]=true}, read = {[id]=true},
                          hidden = {[id]=true}, list_shown = true } }
    session = { active, saved_lastfile, return_to_book, switching,
                return_screen = { kind, date }, return_pending }
    settings = { auto_open = true|false|nil (nil: default, see Store:autoOpen) }
]]

local Store = {}
Store.__index = Store

function Store.new(backend)
    local self = setmetatable({ backend = backend }, Store)
    local ok, data = pcall(backend.load)
    self.data = (ok and type(data) == "table") and data or {}
    return self
end

function Store:get(key, default)
    local v = self.data[key]
    if v == nil and default ~= nil then
        self.data[key] = default
        v = default
    end
    return v
end

function Store:set(key, value)
    self.data[key] = value
end

function Store:save()
    self.backend.save(self.data)
end

--- Story ids are kept as string keys ("41") so the Lua dump stays a hash.
function Store.idKey(id)
    if type(id) == "number" then
        return string.format("%d", id)
    end
    return tostring(id)
end

function Store:deviceId(make_id)
    local id = self.data.device_id
    if type(id) ~= "string" or id == "" then
        id = make_id()
        self.data.device_id = id
        self:save()
    end
    return id
end

function Store:syncState()
    return self:get("sync", {})
end

function Store:session()
    return self:get("session", {})
end

function Store:clearSession()
    self.data.session = {}
end

function Store:issueState(date)
    local issues = self:get("issues", {})
    local st = issues[date]
    if not st then
        st = {}
        issues[date] = st
    end
    st.opened = st.opened or {}
    st.read = st.read or {}
    st.hidden = st.hidden or {}
    return st
end

function Store:resetIssueState(date, version, downloaded_at)
    local issues = self:get("issues", {})
    issues[date] = { version = version, opened = {}, read = {}, hidden = {},
                     downloaded_at = downloaded_at }
    return issues[date]
end

--- User settings with defaults (stored under data.settings).
Store.SETTING_DEFAULTS = {}

function Store:setting(key)
    local s = self:get("settings", {})
    if s[key] == nil then return Store.SETTING_DEFAULTS[key] end
    return s[key]
end

function Store:setSetting(key, value)
    self:get("settings", {})[key] = value
end

--[[--
"Open Early Edition by itself": whether the front page may open on its own,
at KOReader start and when a sync brings a new issue with no book open.

An explicit choice wins. The older "open_on_start" switch only covered
KOReader start; it was stored only when the user changed it, so a stored
value is an explicit choice and is carried over once. Otherwise the default
is off when Simple UI is the home screen, on without it.
]]
function Store:autoOpen(simpleui_present)
    local s = self:get("settings", {})
    if s.auto_open == nil and s.open_on_start ~= nil then
        s.auto_open = s.open_on_start and true or false
        s.open_on_start = nil
        self:save()
    end
    if s.auto_open ~= nil then return s.auto_open end
    return not simpleui_present
end

function Store:setAutoOpen(value)
    local s = self:get("settings", {})
    s.auto_open = value and true or false
    s.open_on_start = nil
end

function Store:dropIssueState(date)
    local issues = self:get("issues", {})
    issues[date] = nil
end

function Store:anyOpened(date)
    local issues = self:get("issues", {})
    local st = issues[date]
    return st ~= nil and st.opened ~= nil and next(st.opened) ~= nil
end

return Store
