--[[--
Development only: a screenshot tour of the Early Edition screens.

Runs when KOReader is started with EEK_SCREENSHOT_TOUR=1 (main.lua checks
the variable; nothing here runs otherwise). It shows each screen in turn,
saves a screenshot of it into <KOReader data dir>/screenshots/, and quits:

  1-front-page.png      the front page
  2-todays-paper.png    the headline list of the newest issue
  3-story-page.png      the first page of that story (its photo, if it has one)
  3-back-from-page-one.png  after a left tap on that page: the headlines again
  3-story-finished.png  a story at its last page with the finished panel
  4-back-issues.png     back issues
  5-my-week.png         my week
  6-sport-*.png         when the paper has a Sport page: the Sport screen (or
                        the closed one), the table's two halves, the next
                        fixtures, and the first match that opens, both pages
  0-simpleui-home.png   first, when Simple UI is installed: its home screen
                        at start (our front page must not have opened)

No sync runs in this mode unless EEK_TOUR_SYNC=1 is also set (then one
"Check for news" runs first, against the configured server), but opening a story does update that data
folder's state and reading log, so run it on a copy of the data folder.

KOReader APIs: Screen:shot(path) (the call Screenshoter:onScreenshot makes,
without its follow-up dialog), UIManager:forceRePaint, UIManager:quit,
ReaderRolling:onGotoPage, Event "EndOfBook" (routed to our override).
]]

local DataStorage = require("datastorage")
local Device = require("device")
local Event = require("ui/event")
local UIManager = require("ui/uimanager")
local logger = require("logger")
local util = require("util")

local Tour = {}

function Tour.start(Controller)
    local dir = DataStorage:getFullDataDir() .. "/screenshots"
    util.makePath(dir)
    local function shot(name)
        UIManager:forceRePaint()
        local path = dir .. "/" .. name
        local ok, err = Device.screen:shot(path)
        logger.info("Early Edition tour: screenshot", path, ok and "ok" or tostring(err))
    end

    local steps = {}
    if Controller.simpleui and Controller.simpleui:present() then
        -- With Simple UI: KOReader start must not open our front page, and
        -- its home screen should show our Quick Action.
        steps = {
            function() end, -- let Simple UI's home screen settle
            function()
                logger.info("Early Edition tour: at start, Early Edition screen open:",
                            tostring(Controller.screen_kind), "auto-open:", tostring(Controller:autoOpen()))
                local store = package.loaded["infra/sui_store"]
                local tabs = store and store:get("simpleui_bar_tabs")
                logger.info("Early Edition tour: Simple UI navigation bar tabs:",
                            type(tabs) == "table" and table.concat(tabs, ",") or tostring(tabs))
                shot("0-simpleui-home.png")
            end,
            function()
                -- Tap our Quick Action the way Simple UI does.
                local QA = package.loaded["features/sui_quickactions"]
                if QA then QA.execute("earlyeditionkids_frontpage", {}) end
            end,
        }
    end
    -- Opens the first unread story of the newest paper (so the panel offers a next one), as from the headlines.
    local function openPick()
        local date = Controller:latestDate()
        local stories = date and Controller.issues:visibleStories(date) or {}
        local st = date and Controller.store:issueState(date)
        local pick = stories[1]
        for _, s in ipairs(stories) do
            if not st.read[tostring(s.id)] then pick = s break end
        end
        if pick then Controller:openStory(date, pick, { kind = "headlines", date = date }) end
    end
    local main_steps = {
        function() Controller:showFrontPage() end,
        function() shot("1-front-page.png") end,
        function() Controller:showHeadlines() end,
        function() shot("2-todays-paper.png") end,
        openPick,
        function() end, -- let the reader open
        function() shot("3-story-page.png") end,
        function()
            -- A left tap on page one: back to the headlines it was opened from.
            local rui = require("apps/reader/readerui").instance
            if rui then rui:handleEvent(Event:new("GotoViewRel", -1)) end
        end,
        function() shot("3-back-from-page-one.png") end,
        openPick,
        function() end, -- let the reader open
        function()
            local rui = require("apps/reader/readerui").instance
            if rui and rui.rolling then
                rui.rolling:onGotoPage(rui.document:getPageCount())
            end
        end,
        function()
            local rui = require("apps/reader/readerui").instance
            if rui then rui:handleEvent(Event:new("EndOfBook")) end
        end,
        function() shot("3-story-finished.png") end,
        function()
            if Controller.panel then UIManager:close(Controller.panel) end
            Controller:showBackIssues()
        end,
        function() shot("4-back-issues.png") end,
        function() Controller:showMyWeek() end,
        function() shot("5-my-week.png") end,
    }
    -- The Sport page (docs/sports-page.md). Always queued: the first sync may only bring it now.
    do
        local function firstMatch()
            local view = Controller:sportView()
            for _, d in ipairs(view and view.matchday and view.matchday.days or {}) do
                for _, m in ipairs(d.matches or {}) do
                    if m.detail then return m.id end
                end
            end
        end
        local sport_steps = {
            function() Controller:showFrontPage() end,
            function() shot("6-sport-front-page.png") end,
            function() Controller:showSport() end,
            function() shot(Controller:sportLock().open and "6-sport-matches.png" or "6-sport-closed.png") end,
            function() Controller:showSport("table", 1) end,
            function() shot("6-sport-table-1.png") end,
            function() Controller:showSport("table", 2) end,
            function() shot("6-sport-table-2.png") end,
            function() Controller:showSport("next") end,
            function() shot("6-sport-next.png") end,
            function() local id = firstMatch() if id then Controller:showSportMatch(id, 1) end end,
            function() shot("6-sport-match.png") end,
            function() local id = firstMatch() if id then Controller:showSportMatch(id, 2) end end,
            function() shot("6-sport-lineups.png") end,
        }
        for _, step in ipairs(sport_steps) do main_steps[#main_steps + 1] = step end
    end
    main_steps[#main_steps + 1] = function() UIManager:quit() end
    if os.getenv("EEK_TOUR_SYNC") == "1" then
        -- Also sync with the real server first ("Check for news"), so the
        -- copy catches up on back issues; give its messages time to go.
        local sync_steps = {
            function() Controller:checkNow() end,
            function() end, function() end, function() end,
        }
        for k = #sync_steps, 1, -1 do table.insert(steps, 1, sync_steps[k]) end
    end
    for _, step in ipairs(main_steps) do steps[#steps + 1] = step end
    local i = 0
    local function nextStep()
        i = i + 1
        local step = steps[i]
        if not step then return end
        local ok, err = pcall(step)
        if not ok then logger.err("Early Edition tour: step", i, "failed:", err) end
        UIManager:scheduleIn(2.5, nextStep)
    end
    UIManager:scheduleIn(3, nextStep)
end

return Tour
