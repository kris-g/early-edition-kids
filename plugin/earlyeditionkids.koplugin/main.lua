--[[--
Early Edition Kids: a daily kids' news brief for KOReader.

This file is the KOReader plugin class. KOReader creates one instance for
the file manager and a new one for every opened document, so this class
only forwards events; all state and behaviour live in the module-level
controller (earlyeditionkids/controller.lua) and the settings file (earlyeditionkids/store.lua).

KOReader APIs used here (checked against koreader master, 13 November 2026):
- WidgetContainer:extend{ name, is_doc_only } plugin base (plugins/hello.koplugin)
- self.ui.menu:registerToMainMenu(self) + addToMainMenu(menu_items) with
  sorting_hint (menusorter.lua attaches orphans to the hinted menu)
- Dispatcher:registerAction(name, { category, event, title, general })
- self.path: set on the plugin module by PluginLoader:_load
- Events: ReaderReady, PageUpdate(pageno), PosUpdate(pos, pageno),
  CloseDocument, Suspend, Resume, NetworkConnected (all broadcast or sent to
  ReaderUI/FileManager children; statistics.koplugin handles the same ones)
- self.ui.status: ReaderStatus registered by ReaderUI as "status"
- self.ui.document:getPageCount(), self.ui:getCurrentPage()
]]

local Dispatcher = require("dispatcher")
local UIManager = require("ui/uimanager")
local WidgetContainer = require("ui/widget/container/widgetcontainer")
local logger = require("logger")

local Const = require("earlyeditionkids/const")
local Controller = require("earlyeditionkids/controller")
local Env = require("earlyeditionkids/env")
local Tracker = require("earlyeditionkids/tracker")

local EarlyEditionKids = WidgetContainer:extend{
    name = "earlyeditionkids",
    is_doc_only = false,
}

function EarlyEditionKids:init()
    if not Controller:setup(self.path) then return end
    self.ui.menu:registerToMainMenu(self)
    self:onDispatcherRegisterActions()

    -- Simple UI Quick Actions. We are instantiated before Simple UI (plugins
    -- load in path order), so registering here beats its start-up pruning of
    -- unknown navigation-bar tabs; the next tick catches the case where its
    -- module only appears once its own init has run. Both are no-ops when
    -- Simple UI is absent, and every call into it is guarded (simpleui.lua).
    Controller:registerSimpleUI()
    UIManager:nextTick(function() Controller:registerSimpleUI() end)

    local doc = self.ui.document
    if doc then
        self.story = Controller:identifyStory(doc.file)
        if self.story then
            self:hookEndOfBook()
            self.tracker = Tracker.new{ clock = Env.monotonic }
            Controller:onStoryOpened(self.story)
        else
            Controller:onOtherDocumentOpened()
        end
    end

    -- "On start": the first instance in this KOReader process.
    local first = not Controller.started
    Controller.started = true
    if not doc then
        Controller:onFileManagerReady(first)
    end
    if first then
        if os.getenv("EEK_SCREENSHOT_TOUR") == "1" then
            -- Development only: photograph each screen and quit (tour.lua).
            -- No sync runs in this mode.
            require("earlyeditionkids/tour").start(Controller)
        else
            Controller:scheduleAutoSync(5)
        end
    end
end

--[[--
Replacing KOReader's end-of-book pop-up for Early Edition Kids stories (DESIGN 5.1 step 6).

ReaderRolling:onGotoViewRel sends EndOfBook with self.ui:handleEvent() only
when a forward page turn leaves the page unchanged. ReaderUI is a
WidgetContainer, so handleEvent -> propagateEvent walks its children in
registration order and stops at the first handler that returns true
(widgetcontainer.lua). ReaderStatus is registered as "status" well before
any plugin (readerui.lua), and ReaderStatus:onEndOfBook returns nothing: it
shows its pop-up and the event then carries on to the plugins. So:

1. handling EndOfBook in this plugin and returning true is too late, the
   pop-up is already up;
2. changing the global `end_document_action` setting for the duration would
   also change his own books if we crashed in between, and is persisted;
3. EventListener:handleEvent calls self[event.handler], so a field set on the
   ReaderStatus *instance* shadows the class method. That instance belongs
   to this one ReaderUI, i.e. this one story, and is thrown away with it, so
   his books are never affected.

We use 3. Returning true also stops the event there, so nothing after
ReaderStatus sees it for an Early Edition Kids story.
]]
function EarlyEditionKids:hookEndOfBook()
    local status = self.ui.status
    if not status then
        logger.warn("Early Edition Kids: ReaderStatus not found; KOReader's end-of-book pop-up will show")
        return
    end
    local plugin = self
    status.onEndOfBook = function()
        local ok, err = pcall(plugin.storyEnded, plugin)
        if not ok then logger.err("Early Edition Kids: end of story failed:", err) end
        return true
    end
end

function EarlyEditionKids:storyEnded()
    local total = self.ui.document:getPageCount()
    self.tracker:markEnd(total)
    Controller:markRead(self.story)
    Controller:showFinishedPanel(self.story, self.ui)
end

function EarlyEditionKids:trackPage(pageno)
    if not self.story or type(pageno) ~= "number" or not self.ui.document then return end
    if self.tracker:page(pageno, self.ui.document:getPageCount()) then
        -- The tick appears as soon as he reaches the last page (DESIGN 5.2).
        Controller:markRead(self.story)
    end
end

-- Event handlers never return true, so other modules still see the events.

function EarlyEditionKids:onReaderReady()
    if not self.story then return end
    self:trackPage(self.ui:getCurrentPage())
end

function EarlyEditionKids:onPageUpdate(pageno)
    self:trackPage(pageno)
end

function EarlyEditionKids:onPosUpdate(_, pageno)
    self:trackPage(pageno)
end

function EarlyEditionKids:onCloseDocument()
    if not self.story or self.closed then return end
    self.closed = true
    local total = self.ui.document and self.ui.document:getPageCount()
    Controller:onStoryClosed(self.story, self.tracker:result(total))
end

function EarlyEditionKids:onSuspend()
    if self.tracker then self.tracker:pause() end
    Controller:onSuspend()
end

function EarlyEditionKids:onResume()
    if self.tracker then self.tracker:resume() end
    Controller:onResume()
end

function EarlyEditionKids:onNetworkConnected()
    Controller:onNetworkConnected()
end

function EarlyEditionKids:onDispatcherRegisterActions()
    Dispatcher:registerAction("earlyeditionkids_frontpage", {
        category = "none", event = "EarlyEditionKidsShowFrontPage",
        title = "Early Edition: front page", general = true,
    })
    Dispatcher:registerAction("earlyeditionkids_headlines", {
        category = "none", event = "EarlyEditionKidsShowHeadlines",
        title = "Early Edition: today's paper", general = true,
    })
    Dispatcher:registerAction("earlyeditionkids_check", {
        category = "none", event = "EarlyEditionKidsCheckNews",
        title = "Early Edition: check for news", general = true,
    })
end

function EarlyEditionKids:onEarlyEditionKidsShowFrontPage()
    Controller:showFrontPage()
    return true
end

function EarlyEditionKids:onEarlyEditionKidsShowHeadlines()
    Controller:showHeadlines()
    return true
end

function EarlyEditionKids:onEarlyEditionKidsCheckNews()
    Controller:checkNow()
    return true
end

function EarlyEditionKids:addToMainMenu(menu_items)
    -- Menu callbacks run before the menu closes (touchmenu.lua), so defer
    -- anything that shows a screen or blocks on the network.
    local function later(fn)
        return function() UIManager:nextTick(fn) end
    end
    -- One entry that opens the front page; everything else is on it.
    menu_items.earlyeditionkids = {
        text = "Early Edition",
        sorting_hint = "tools",
        callback = later(function() Controller:showFrontPage() end),
    }
    menu_items.earlyeditionkids_settings = {
        text = "Early Edition settings",
        sorting_hint = "tools",
        sub_item_table = {
            {
                text_func = function()
                    local url = Controller.ready and Controller:serverUrl() or ""
                    return "Server address: " .. (url ~= "" and url or "not set")
                end,
                callback = later(function() Controller:editServerUrl() end),
            },
            { text = "Check for news", callback = later(function() Controller:checkNow() end) },
            {
                -- Covers KOReader start and a new issue arriving with no
                -- book open. Off by default when Simple UI is the home screen.
                text = "Open Early Edition by itself",
                help_text = "Show the front page by itself when KOReader starts with today's paper on the Kindle, "
                    .. "and when a new paper arrives with no book open. When off, a new paper only shows a short notice.",
                checked_func = function() return Controller:autoOpen() end,
                callback = function()
                    Controller.store:setAutoOpen(not Controller:autoOpen())
                    Controller.store:save()
                end,
                separator = true,
            },
            { text = "Status", keep_menu_open = true, callback = function() Controller:showStatus() end },
        },
    }
end

--- Called by PluginLoader when the plugin is stopped (Plugin manager):
-- take our Quick Actions out of Simple UI.
function EarlyEditionKids:stopPlugin()
    Controller:unregisterSimpleUI()
end

function EarlyEditionKids:onExit()
    Controller:unregisterSimpleUI()
end

return EarlyEditionKids
