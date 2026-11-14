--[[--
Bridge to the Simple UI plugin (simpleui.koplugin by doctorhetfield-cmd, MIT),
the home screen many KOReader users run. Checked against its commit 08000cb
(11 Nov 2026):

- features/sui_quickactions.lua, "EXTERNAL PLUGIN API":
    QA.register(descriptor)  descriptor = { id, label, icon, get_label,
                             get_icon, is_active, is_in_place,
                             is_async_in_place, execute(ctx) }
    QA.unregister(id)
  The registry is in memory only, so it must be filled again on every
  KOReader start. QA.getEntry() calls get_label() without a pcall, so ours
  must never raise.
- main.lua registers the Dispatcher action "simpleui_go_homescreen" (event
  SimpleUIGoHomescreen): closes the reader if one is open and shows its home
  screen.
- Its own on/off switch is the "simpleui_enabled" key of
  settings/simpleui/sui_settings.lua (nil counts as on).

Load order: plugins are instantiated in path order, so Early Edition
("earlyeditionkids") initialises before Simple UI ("simpleui"). Simple UI's
init prunes navigation-bar tabs whose action is not registered yet
(QA.sanitizeQASlots), so we register as early as we can: the QA module is
required by name if Simple UI is enabled but has not loaded it yet. Every
later file-manager start registers again if Simple UI's module was reloaded
(e.g. after one of its own updates). Every call into Simple UI is wrapped in
pcall, so a change on its side can only cost the Quick Action, never Early
Edition itself.

No KOReader dependency: `env` supplies
  env.pluginEnabled()   -> bool   Simple UI is in KOReader's enabled plugins
  env.settingEnabled()  -> bool   its own switch is not off
  env.loadedQA()        -> QA table if Simple UI has loaded it, else nil
  env.requireQA()       -> QA table (may raise)
  env.goHome()          -> runs simpleui_go_homescreen (may raise)
  env.log(level, ...)
]]

local Bridge = {}
Bridge.__index = Bridge

function Bridge.new(env)
    return setmetatable({ env = env, registered_with = nil, ids = {} }, Bridge)
end

local function safe(fn, ...)
    if type(fn) ~= "function" then return false end
    local ok, res = pcall(fn, ...)
    if not ok then return false end
    return res
end

function Bridge:log(level, ...)
    if self.env.log then pcall(self.env.log, level, ...) end
end

--- Simple UI is installed, enabled in KOReader and switched on.
function Bridge:present()
    if not safe(self.env.pluginEnabled) then return false end
    local ok, on = pcall(self.env.settingEnabled)
    if ok and on == false then return false end
    return true
end

--- The QA module, loading it by name if Simple UI is present but has not yet.
function Bridge:qa()
    local qa = safe(self.env.loadedQA)
    if type(qa) == "table" then return qa end
    if not self:present() then return nil end
    local ok, mod = pcall(self.env.requireQA)
    if ok and type(mod) == "table" then return mod end
    if not ok then self:log("warn", "Simple UI quick actions not loadable yet:", tostring(mod)) end
    return nil
end

--[[--
Registers `descriptors` once per loaded copy of Simple UI's QA module.
Returns true when they are (now or already) registered.
]]
function Bridge:register(descriptors)
    local qa = self:qa()
    if not qa or type(qa.register) ~= "function" then return false end
    if self.registered_with == qa then return true end
    local all_ok = true
    self.ids = {}
    for _, d in ipairs(descriptors) do
        local ok, err = pcall(qa.register, d)
        if ok then
            self.ids[#self.ids + 1] = d.id
        else
            all_ok = false
            self:log("warn", "Simple UI QA.register failed for", d.id, tostring(err))
        end
    end
    if all_ok then
        self.registered_with = qa
        self:log("info", "registered Simple UI quick actions:", table.concat(self.ids, ", "))
    end
    return all_ok
end

--- Removes our actions again (plugin stopped or KOReader exiting).
function Bridge:unregister()
    local qa = self.registered_with or safe(self.env.loadedQA)
    if type(qa) == "table" and type(qa.unregister) == "function" then
        for _, id in ipairs(self.ids) do pcall(qa.unregister, id) end
    end
    self.registered_with = nil
    self.ids = {}
end

--- Shows Simple UI's home screen. Returns true if that was attempted.
function Bridge:goHome()
    if not self:present() then return false end
    local ok, err = pcall(self.env.goHome)
    if not ok then self:log("warn", "Simple UI home screen failed:", tostring(err)) end
    return ok
end

--- "Early Edition · 4 new", or "Early Edition" when nothing is unread.
function Bridge.labelWithCount(base, unread)
    if type(unread) == "number" and unread > 0 then
        return string.format("%s · %d new", base, unread)
    end
    return base
end

return Bridge
