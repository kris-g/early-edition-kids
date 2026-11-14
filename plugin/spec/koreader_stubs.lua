-- Minimal stand-ins for the KOReader modules that main.lua, controller.lua
-- and the ui/ modules require, so the glue code can be executed in tests.
-- They model only what Early Edition Kids relies on: event dispatch order, the widget
-- stack, scheduling, history and lastfile. They are NOT KOReader.

local H = require("helpers")

local S = {}

function S.install(opts)
    local memfs = opts.fs
    local loaded = package.loaded

    -- logger
    local logs = {}
    S.logs = logs
    local function logfn(level)
        return function(...)
            local parts = {}
            for i = 1, select("#", ...) do parts[#parts + 1] = tostring((select(i, ...))) end
            table.insert(logs, level .. " " .. table.concat(parts, " "))
        end
    end
    loaded["logger"] = { dbg = logfn("dbg"), info = logfn("info"), warn = logfn("warn"), err = logfn("err") }

    loaded["gettext"] = function(s) return s end

    -- G_reader_settings
    local gdata = opts.reader_settings or {}
    G_reader_settings = {
        data = gdata,
        readSetting = function(self, k) return self.data[k] end,
        saveSetting = function(self, k, v) self.data[k] = v end,
        isTrue = function(self, k) return self.data[k] == true end,
        flush = function() end,
    }

    -- lfs over the memory fs
    loaded["libs/libkoreader-lfs"] = {
        attributes = function(p, what)
            local mode = memfs.isDir(p) and "directory" or (memfs.isFile(p) and "file" or nil)
            if what == "mode" then return mode end
            if mode then return { mode = mode } end
            return nil
        end,
    }

    loaded["datastorage"] = {
        getFullDataDir = function() return "/data" end,
        getDataDir = function() return "/data" end,
        getSettingsDir = function() return "/data/settings" end,
    }

    loaded["ffi/util"] = {
        realpath = function(p) return p end,
        dirname = function(p) return p:match("^(.*)/[^/]*$") or "." end,
        template = function(fmt, ...)
            local args = { ... }
            return (fmt:gsub("%%(%d)", function(n) return tostring(args[tonumber(n)]) end))
        end,
        purgeDir = function(p) memfs.removeTree(p); return true end,
    }

    loaded["util"] = {
        makePath = function(p) return memfs.mkdirp(p) end,
        splitFilePathName = function(p)
            local dir, file = p:match("^(.*/)([^/]*)$")
            return dir or "", file or p
        end,
    }

    -- Blitbuffer colours
    local colors = {}
    for _, n in ipairs({ "BLACK", "WHITE", "GRAY_2", "GRAY_4", "GRAY_6", "GRAY_7", "GRAY_9", "GRAY_E" }) do
        colors["COLOR_" .. n] = n
    end
    colors.Color8 = function(v) return "C" .. v end
    loaded["ffi/blitbuffer"] = colors

    -- Geometry
    local Geom = {}
    Geom.__index = Geom
    function Geom:new(o)
        o = o or {}
        o.x = o.x or 0; o.y = o.y or 0; o.w = o.w or 0; o.h = o.h or 0
        return setmetatable(o, Geom)
    end
    function Geom:contains(g)
        return self.x <= g.x and self.y <= g.y and self.x + self.w >= g.x + (g.w or 0) and self.y + self.h >= g.y + (g.h or 0)
    end
    function Geom:notIntersectWith(g)
        return (self.x >= g.x + g.w) or (self.y >= g.y + g.h) or (g.x >= self.x + (self.w or 0)) or (g.y >= self.y + (self.h or 0))
    end
    loaded["ui/geometry"] = Geom

    loaded["ui/gesturerange"] = { new = function(_, o) return o end }

    -- Screen / Device
    local screen = {
        getWidth = function() return 1072 end,
        getHeight = function() return 1448 end,
        scaleBySize = function(_, px) return math.ceil(px * 1072 / 600) end,
    }
    loaded["device"] = {
        screen = screen,
        input = { group = { Back = "Back", PgFwd = "PgFwd", PgBack = "PgBack" } },
        hasKeys = function() return false end,
    }

    loaded["ui/font"] = {
        getFace = function(_, name, size) return { name = name, size = size } end,
    }

    -- Widgets: a generic class with naive sizes.
    local function class(name, sizefn)
        local C = { _name = name }
        C.__index = C
        function C:extend(o)
            o = o or {}
            setmetatable(o, self)
            self.__index = self
            return o
        end
        function C:new(o)
            o = self:extend(o or {})
            if o._init then o:_init() end
            if o.init then o:init() end
            return o
        end
        function C:getSize()
            if sizefn then return sizefn(self) end
            if self.dimen then return self.dimen end
            if self[1] then return self[1]:getSize() end
            return Geom:new{ w = 0, h = 0 }
        end
        function C:free() end
        function C:paintTo() end
        function C:handleEvent(ev)
            for _, child in ipairs(self) do
                if type(child) == "table" and child.handleEvent and child:handleEvent(ev) then return true end
            end
            local h = self["on" .. ev.name]
            if h then return h(self, unpack(ev.args or {})) end
        end
        return C
    end

    local WidgetContainer = class("WidgetContainer")
    loaded["ui/widget/container/widgetcontainer"] = WidgetContainer

    local InputContainer = class("InputContainer")
    function InputContainer:_init()
        self.key_events = self.key_events or {}
        self.ges_events = self.ges_events or {}
    end
    loaded["ui/widget/container/inputcontainer"] = InputContainer

    local function textSize(self)
        local w = #(self.text or "") * 10
        if self.max_width and w > self.max_width then w = self.max_width end
        return Geom:new{ w = w, h = 40 }
    end
    loaded["ui/widget/textwidget"] = class("TextWidget", textSize)
    loaded["ui/widget/textboxwidget"] = class("TextBoxWidget", function(self) return Geom:new{ w = self.width or 400, h = 60 } end)
    loaded["ui/widget/linewidget"] = class("LineWidget")
    loaded["ui/widget/imagewidget"] = class("ImageWidget", function(self) return Geom:new{ w = self.width or 10, h = self.height or 10 } end)
    loaded["ui/widget/overlapgroup"] = class("OverlapGroup", function(self)
        if self.dimen then return self.dimen end
        local w, h = 0, 0
        for _, c in ipairs(self) do local s = c:getSize(); w = math.max(w, s.w); h = math.max(h, s.h) end
        return Geom:new{ w = w, h = h }
    end)
    loaded["ui/event"] = { new = function(_, name, ...) return { name = name, args = { ... } } end }
    loaded["ui/widget/horizontalspan"] = class("HorizontalSpan", function(self) return Geom:new{ w = self.width or 0, h = 0 } end)
    loaded["ui/widget/verticalspan"] = class("VerticalSpan", function(self) return Geom:new{ w = 0, h = self.width or 0 } end)
    loaded["ui/widget/verticalgroup"] = class("VerticalGroup", function(self)
        local w, h = 0, 0
        for _, c in ipairs(self) do local s = c:getSize(); h = h + s.h; if s.w > w then w = s.w end end
        return Geom:new{ w = w, h = h }
    end)
    loaded["ui/widget/horizontalgroup"] = class("HorizontalGroup", function(self)
        local w, h = 0, 0
        for _, c in ipairs(self) do local s = c:getSize(); w = w + s.w; if s.h > h then h = s.h end end
        return Geom:new{ w = w, h = h }
    end)
    local frameSize = function(self)
        local s = self[1] and self[1]:getSize() or Geom:new{}
        local b = self.bordersize or 0
        local pl = self.padding_left or self.padding or 0
        local pr = self.padding_right or self.padding or 0
        local pt = self.padding_top or self.padding or 0
        local pb = self.padding_bottom or self.padding or 0
        return Geom:new{ w = s.w + 2 * b + pl + pr, h = s.h + 2 * b + pt + pb }
    end
    loaded["ui/widget/container/framecontainer"] = class("FrameContainer", frameSize)
    for _, n in ipairs({ "leftcontainer", "rightcontainer", "centercontainer", "bottomcontainer" }) do
        loaded["ui/widget/container/" .. n] = class(n)
    end

    local InfoMessage = class("InfoMessage")
    loaded["ui/widget/infomessage"] = InfoMessage
    local Notification = class("Notification")
    loaded["ui/widget/notification"] = Notification

    -- UIManager: a window stack and a task list run by S.run().
    local UIManager = { stack = {}, tasks = {}, shown = {} }
    S.UIManager = UIManager
    function UIManager:show(w)
        table.insert(self.stack, w)
        table.insert(self.shown, w)
        if w.onShow then w:onShow() end
    end
    function UIManager:close(w)
        for i = #self.stack, 1, -1 do
            if self.stack[i] == w then
                table.remove(self.stack, i)
                if w.onCloseWidget then w:onCloseWidget() end
            end
        end
    end
    function UIManager:scheduleIn(secs, fn) table.insert(self.tasks, { t = secs, fn = fn }) end
    function UIManager:nextTick(fn) self:scheduleIn(0, fn) end
    function UIManager:unschedule(fn)
        for i = #self.tasks, 1, -1 do if self.tasks[i].fn == fn then table.remove(self.tasks, i) end end
    end
    function UIManager:setDirty() end
    function UIManager:forceRePaint() end
    function UIManager:broadcastEvent(ev)
        for i = #self.stack, 1, -1 do
            local w = self.stack[i]
            if w.handleEvent then w:handleEvent(ev) end
        end
    end
    function UIManager:top()
        return self.stack[#self.stack]
    end
    loaded["ui/uimanager"] = UIManager

    function S.run(max)
        for _ = 1, (max or 50) do
            if #UIManager.tasks == 0 then return end
            local task = table.remove(UIManager.tasks, 1)
            task.fn()
        end
    end

    -- Network
    S.connected = true
    loaded["ui/network/manager"] = {
        isConnected = function() return S.connected end,
        runWhenConnected = function(_, fn) if S.connected then fn() end end,
    }

    -- Dispatcher
    loaded["dispatcher"] = { registerAction = function() return true end }

    -- ReadHistory (singleton) with ensureLastFile behaviour.
    local ReadHistory = { hist = {} }
    function ReadHistory:ensureLastFile()
        G_reader_settings:saveSetting("lastfile", self.hist[1] and self.hist[1].file or nil)
    end
    function ReadHistory:addItem(file)
        for i = #self.hist, 1, -1 do if self.hist[i].file == file then table.remove(self.hist, i) end end
        table.insert(self.hist, 1, { file = file })
        self:ensureLastFile()
    end
    function ReadHistory:removeItemByPath(file)
        for i = #self.hist, 1, -1 do if self.hist[i].file == file then table.remove(self.hist, i) end end
        self:ensureLastFile()
    end
    loaded["readhistory"] = ReadHistory
    S.ReadHistory = ReadHistory

    loaded["apps/filemanager/filemanagerutil"] = { getDefaultDir = function() return "/mnt/us/documents" end }

    -- ReaderStatus-like module and ReaderUI / FileManager simulation.
    local ReaderStatus = {}
    ReaderStatus.__index = ReaderStatus
    function ReaderStatus.onEndOfBook() S.stock_popup = (S.stock_popup or 0) + 1 end

    local Event = {}
    function Event.new(name, ...) return { name = name, args = { ... } } end
    S.Event = Event

    local ReaderUI = {}
    S.ReaderUI = ReaderUI
    loaded["apps/reader/readerui"] = ReaderUI
    local FileManager = {}
    S.FileManager = FileManager
    loaded["apps/filemanager/filemanager"] = FileManager

    -- Children in registration order: status first, then plugins (as in readerui.lua).
    local function dispatch(ui, ev)
        for _, child in ipairs(ui.children) do
            local h = child["on" .. ev.name]
            if h and h(child, unpack(ev.args)) then return true end
        end
    end

    local function menuStub()
        return { registerToMainMenu = function(m, w) m.widget = w end }
    end

    function ReaderUI:showReader(file)
        if ReaderUI.instance then ReaderUI.instance:onClose() end
        if FileManager.instance then FileManager.instance:onClose() end
        local pages = S.page_counts and S.page_counts[file] or 2
        local ui = {
            document = { file = file, getPageCount = function() return pages end },
            current_page = 1,
            menu = menuStub(),
        }
        ui.status = setmetatable({}, ReaderStatus)
        ui.children = { ui.status }
        function ui:getCurrentPage() return self.current_page end
        function ui:handleEvent(ev) return dispatch(self, ev) end
        function ui:turnPage()
            if self.current_page < pages then
                self.current_page = self.current_page + 1
                self:handleEvent(Event.new("PageUpdate", self.current_page))
            else
                self:handleEvent(Event.new("EndOfBook"))
            end
        end
        function ui:onClose()
            self:handleEvent(Event.new("CloseDocument"))
            for i = #UIManager.stack, 1, -1 do if UIManager.stack[i] == self then table.remove(UIManager.stack, i) end end
            ReaderUI.instance = nil
        end
        function ui:switchDocument(f)
            self:onClose()
            ReaderUI:showReader(f)
        end
        function ui:showFileManager(path)
            FileManager:showFiles(path)
        end
        ReaderUI.instance = ui
        local plugin = S.Plugin:new{ ui = ui, document = ui.document }
        table.insert(ui.children, plugin)
        ui.plugin = plugin
        ReadHistory:addItem(file)
        ui:handleEvent(Event.new("ReaderReady"))
        table.insert(UIManager.stack, ui)
        return ui
    end

    function FileManager:showFiles(path)
        local fm = { menu = menuStub(), path = path }
        fm.children = {}
        fm.file_chooser = { changeToPath = function(_, dir, focus) fm.path = dir; fm.focus = focus end }
        function fm:handleEvent(ev) return dispatch(self, ev) end
        function fm:onClose()
            for i = #UIManager.stack, 1, -1 do if UIManager.stack[i] == self then table.remove(UIManager.stack, i) end end
            FileManager.instance = nil
        end
        local plugin = S.Plugin:new{ ui = fm }
        table.insert(fm.children, plugin)
        fm.plugin = plugin
        FileManager.instance = fm
        table.insert(UIManager.stack, 1, fm)
        return fm
    end

    return S
end

return S
