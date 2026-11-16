-- Runs main.lua + controller.lua + the ui/ modules against stubbed KOReader
-- modules (koreader_stubs.lua): sync on start, headline screen, opening a
-- story, end of story panel, next story, Home, leaving Early Edition Kids.
--
-- This checks the glue code executes and follows DESIGN 5.1; it is not a
-- substitute for the emulator or the Kindle.

local H = require("helpers")
local JSON = require("earlyeditionkids/jsonutil")
local describe, it, eq, truthy, falsy = H.describe, H.it, H.eq, H.truthy, H.falsy

local PLUGIN_DIR = package.path:match("([^;]*earlyeditionkids%.koplugin)/%?%.lua")
local ROOT = "/data/earlyeditionkids"
local BOOK = "/mnt/us/documents/Harry Kane.epub"

local function issueBody(date, version, ids, extra)
    local stories = {}
    for i, id in ipairs(ids) do
        stories[i] = { id = id, position = i, topic = i == 1 and "Football" or "Space",
                       title = "Story " .. id, teaser = "Teaser " .. id, minutes = 2,
                       path = string.format("/issues/%s/v%d/%d.html", date, version, i) }
    end
    local body = { date = date, version = version, fallback = false, title = "Early Edition",
                   stories = JSON.array(stories), hidden = JSON.array({}) }
    for k, v in pairs(extra or {}) do body[k] = v end
    return JSON.encode(body)
end

-- Collect error/warning log lines from every scenario.
local all_bad = {}
local function collectLogs(S)
    for _, l in ipairs(S.logs or {}) do
        if l:match("^err") or l:match("^warn") then all_bad[#all_bad + 1] = l end
    end
end

local function fresh(opts)
    opts = opts or {}
    -- Forget any earlier scenario's modules.
    for name in pairs(package.loaded) do
        if name:match("^earlyeditionkids/controller") or name:match("^earlyeditionkids/ui/") or name == "earlyeditionkids/env" then
            package.loaded[name] = nil
        end
    end
    local fs = H.memfs()
    fs.mkdirp("/data/settings")
    fs.mkdirp("/mnt/us/documents")
    fs.writeFile(BOOK, "epub")
    local S = require("koreader_stubs")
    -- Fixed wall clock: Friday 13 November 2026, 07:00 UTC.
    S.now = opts.now or (require("earlyeditionkids/clock").daysFromCivil(2026, 11, 13) * 86400 + 7 * 3600)
    collectLogs(S)
    S.stock_popup = 0
    S.uploaded = nil -- the stubs module is shared between scenarios
    S.connected = true
    S.install{ fs = fs, reader_settings = { lastfile = BOOK, wifi_enable_action = "turn_on" } }
    S.ReadHistory.hist = { { file = BOOK } }

    local routes = {}
    local http = H.transport(routes)
    routes["POST /api/events"] = function(req)
        local body = JSON.decode(req.body)
        local acc = {}
        for _, ev in ipairs(body.events) do acc[#acc + 1] = ev.client_event_id end
        S.uploaded = S.uploaded or {}
        for _, ev in ipairs(body.events) do table.insert(S.uploaded, ev) end
        return { status = 200, body = JSON.encode({ accepted = JSON.array(acc) }) }
    end
    S.http_date = opts.http_date or "Fri, 13 Nov 2026 07:00:00 GMT"
    local function serve(date, version, ids, key)
        routes[key or "GET /api/issue/today"] = { status = 200, body = issueBody(date, version, ids),
                                                  headers = { date = S.http_date } }
        for i, id in ipairs(ids) do
            routes[string.format("GET /issues/%s/v%d/%d.html", date, version, i)] = { status = 200, body = "<html>" .. id .. "</html>" }
        end
    end
    S.serve = serve
    -- A back issue at GET /api/issue/{date}.
    S.serveDate = function(date, version, ids) serve(date, version, ids, "GET /api/issue/" .. date) end
    S.http = http

    local mono = { t = 0 }
    S.mono = mono
    local backends = {}
    -- The server address as set from the menu; opts.server_url = false leaves it unset.
    if opts.reading_log then
        backends["earlyeditionkids_log.lua"] = H.memBackend({ entries = opts.reading_log })
    end
    if opts.server_url ~= false then
        backends["earlyeditionkids.lua"] = H.memBackend({ settings = { server_url = opts.server_url or "http://eek.test:8080" } })
    end
    package.loaded["earlyeditionkids/env"] = {
        fs = function() return fs end,
        transport = http.fn,
        settingsBackend = function(name)
            backends[name] = backends[name] or H.memBackend()
            return backends[name]
        end,
        cleanupDocFile = function(p) S.cleaned = (S.cleaned or 0) + 1; S.ReadHistory:removeItemByPath(p) end,
        monotonic = function() return mono.t end,
        now = function() return S.now end,
        simpleUI = function()
            return {
                pluginEnabled = function() return S.sui.enabled end,
                settingEnabled = function() return S.sui.switched_on end,
                loadedQA = function() return S.sui.loaded and S.sui.QA or nil end,
                requireQA = function()
                    if S.sui.requirable then S.sui.loaded = true return S.sui.QA end
                    error("module 'features/sui_quickactions' not found")
                end,
                goHome = function() S.sui.home_calls = S.sui.home_calls + 1 end,
                log = function() end,
            }
        end,
    }
    S.backends = backends
    S.fs = fs

    -- A fake Simple UI: its QA module records registrations.
    local sui = opts.simpleui
    S.sui = {
        enabled = sui ~= nil,
        switched_on = not (sui and sui.switched_off),
        loaded = sui ~= nil and not sui.late,
        requirable = sui ~= nil and not sui.late,
        home_calls = 0,
    }
    local QA = { registry = {}, register_calls = 0, unregister_calls = 0 }
    function QA.register(d)
        assert(d.id and d.execute, "descriptor needs id and execute")
        QA.register_calls = QA.register_calls + 1
        QA.registry[d.id] = d
    end
    function QA.unregister(id)
        QA.unregister_calls = QA.unregister_calls + 1
        QA.registry[id] = nil
    end
    S.sui.QA = QA

    local Plugin = dofile(PLUGIN_DIR .. "/main.lua")
    Plugin.path = PLUGIN_DIR
    S.Plugin = Plugin
    S.Controller = require("earlyeditionkids/controller")
    return S
end

local function topName(S)
    local top = S.UIManager:top()
    return top and top.name
end

describe("plugin flow (stubbed KOReader)", function()
    it("start: syncs and shows the front page (no book open), records list_shown", function()
        local S = fresh()
        S.serve("2026-11-13", 1, { 41, 42, 43 })
        S.FileManager:showFiles("/mnt/us/documents")
        S.run()
        eq(topName(S), "eek_frontpage")
        local m = S.UIManager:top().model
        eq(m.read_text, "0 of 3 read")
        eq(m.summary, "3 stories · about 6 minutes")
        eq(m.first_up.id, 41)
        eq(m.number_text, "NO. 1")
        eq(m.date_line, "FRIDAY 13 NOVEMBER 2026")
        eq(#m.topics, 3)
        local types = {}
        for _, ev in ipairs(S.Controller.queue:list()) do types[#types + 1] = ev.type end
        eq(table.concat(types, ","), "issue_downloaded,list_shown")
    end)

    it("the front page shows first up's photo when it is on the Kindle", function()
        local S = fresh()
        S.serve("2026-11-13", 1, { 41, 42 })
        S.FileManager:showFiles("/mnt/us/documents")
        S.run()
        eq(S.UIManager:top().model.first_up_photo, nil, "no photo downloaded")
        local photo = ROOT .. "/2026-11-13/41.jpg"
        S.Controller.issues.fs.writeFile(photo, "\255\216\255")
        S.UIManager:top():onClose()
        S.Controller:showFrontPage()
        S.run()
        eq(topName(S), "eek_frontpage")
        eq(S.UIManager:top().model.first_up_photo, photo)
    end)

    it("a book open: notification instead of taking over", function()
        local S = fresh()
        S.serve("2026-11-13", 1, { 41 })
        S.ReaderUI:showReader(BOOK)
        S.run()
        falsy(S.Controller.screen, "no page over his book")
        local notified = false
        for _, w in ipairs(S.UIManager.shown) do
            if w.text and w.text:find("is here", 1, true) then notified = true end
        end
        truthy(notified, "notification shown")
    end)

    it("turning back from a story's first page goes back to where he opened it", function()
        local S = fresh()
        S.serve("2026-11-13", 1, { 41, 42, 43 })
        S.FileManager:showFiles("/mnt/us/documents")
        S.run()
        -- From the headlines: back on page 2 is a normal page turn, back on page 1 leaves.
        S.page_counts = { [ROOT .. "/2026-11-13/42.html"] = 3 }
        S.Controller:showHeadlines("2026-11-13")
        S.run()
        local list = S.UIManager:top()
        list.on_story(list.model.stories[2].story)
        S.run()
        local rui = S.ReaderUI.instance
        eq(rui.document.file, ROOT .. "/2026-11-13/42.html")
        S.mono.t = 20; rui:turnPage()
        rui:turnBack()
        S.run()
        eq(S.ReaderUI.instance, rui, "still reading")
        eq(rui.current_page, 1)
        S.mono.t = 40; rui:turnBack()
        S.run()
        falsy(S.ReaderUI.instance, "story closed")
        eq(topName(S), "eek_headlines")
        -- Its reading is recorded (the event may already have gone up), and it is not read.
        local entry
        for _, e in ipairs(S.Controller.readlog:entries()) do
            if e.story_id == 42 then entry = e end
        end
        truthy(entry, "reading recorded")
        eq(entry.finished, false)
        falsy(S.Controller.store:issueState("2026-11-13").read["42"], "not marked read")

        -- From the front page: back there.
        S.Controller:showFrontPage()
        S.run()
        local front = S.UIManager:top()
        front.on_start(front.model.first_up)
        S.run()
        S.ReaderUI.instance:turnBack()
        S.run()
        falsy(S.ReaderUI.instance)
        eq(topName(S), "eek_frontpage")
    end)

    it("Start reading: panel replaces the stock pop-up, next story, Home goes back to the front page, leave", function()
        local S = fresh()
        S.serve("2026-11-13", 1, { 41, 42, 43 })
        S.FileManager:showFiles("/mnt/us/documents")
        S.run()
        local front = S.UIManager:top()
        front.on_start(front.model.first_up)
        S.run()
        local rui = S.ReaderUI.instance
        truthy(rui, "story opened in the reader")
        eq(rui.document.file, ROOT .. "/2026-11-13/41.html")
        falsy(S.Controller.screen, "front page closed under the reader")
        eq(S.Controller.store:session().saved_lastfile, BOOK)
        eq(S.Controller.store:session().return_screen.kind, "frontpage")

        S.mono.t = 30; rui:turnPage()
        S.mono.t = 70; rui:turnPage() -- EndOfBook
        eq(S.stock_popup, 0, "KOReader's own pop-up suppressed")
        eq(topName(S), "eek_finished")
        local panel = S.UIManager:top()
        eq(panel.read, 1); eq(panel.total, 3)
        eq(panel.next_story.id, 42)
        eq(panel.stamp_date, "13 NOV")

        panel:choose(panel.on_next)
        S.run()
        eq(S.ReaderUI.instance.document.file, ROOT .. "/2026-11-13/42.html")

        local closed
        for _, ev in ipairs(S.Controller.queue:list()) do
            if ev.type == "story_closed" and ev.story_id == 41 then closed = ev end
        end
        truthy(closed)
        eq(closed.payload.active_seconds, 70)
        eq(closed.payload.pages_total, 2)
        eq(closed.payload.max_page, 2)
        eq(closed.payload.finished, true)

        -- Home from story 42 without finishing: back where he came from (the front page).
        S.ReaderUI.instance:onClose()
        S.FileManager:showFiles(ROOT .. "/2026-11-13")
        S.run()
        eq(topName(S), "eek_frontpage")
        eq(S.UIManager:top().model.read_text, "1 of 3 read")
        eq(S.UIManager:top().model.first_up.id, 42)

        local entries = S.Controller.readlog:entries()
        eq(#entries, 2)
        eq(entries[1].day, "2026-11-13")

        -- Close the front page: leave Early Edition.
        S.UIManager:top():onClose()
        S.run()
        eq(G_reader_settings:readSetting("lastfile"), BOOK)
        for _, item in ipairs(S.ReadHistory.hist) do
            falsy(item.file:find(ROOT, 1, true), "story left in history: " .. item.file)
        end
        eq(S.FileManager.instance.path, "/mnt/us/documents/")
        eq(S.Controller.store:session().active, nil)
        falsy(S.Controller.screen)
    end)

    it("from his book via the headlines: Front page button, then closing reopens the book", function()
        local S = fresh()
        S.serve("2026-11-13", 1, { 41, 42 })
        S.ReaderUI:showReader(BOOK)
        S.run()
        S.Controller:showFrontPage()
        S.UIManager:top().on_start(nil) -- (pretend all read: goes to the headlines)
        eq(topName(S), "eek_headlines")
        local hl = S.UIManager:top()
        hl.on_story(hl.model.stories[1].story)
        S.run()
        eq(S.Controller.store:session().return_to_book, BOOK)
        eq(S.Controller.store:session().return_screen.kind, "headlines")
        local rui = S.ReaderUI.instance
        rui:turnPage(); rui:turnPage()
        local panel = S.UIManager:top()
        eq(panel.name, "eek_finished")
        panel:choose(panel.on_front_page)
        S.run()
        eq(topName(S), "eek_frontpage")
        falsy(S.ReaderUI.instance)
        S.UIManager:top():onClose()
        S.run()
        truthy(S.ReaderUI.instance, "his book reopened")
        eq(S.ReaderUI.instance.document.file, BOOK)
        eq(G_reader_settings:readSetting("lastfile"), BOOK)
    end)

    it("front page: All headlines opens today's list without reading a story first", function()
        local S = fresh()
        S.serve("2026-11-13", 1, { 41, 42 })
        S.FileManager:showFiles("/mnt/us/documents")
        S.run()
        S.Controller:showFrontPage()
        local fp = S.UIManager:top()
        eq(fp.name, "eek_frontpage")
        truthy(fp.on_headlines, "front page has a way to the headline list")
        fp.on_headlines()
        eq(topName(S), "eek_headlines")
        eq(#S.UIManager:top().model.stories, 2)
        -- Back from the list returns to the front page.
        S.UIManager:top():onClose()
        eq(topName(S), "eek_frontpage")
    end)

    it("leaving a story with Home returns to the headline list it came from", function()
        local S = fresh()
        S.serve("2026-11-13", 1, { 41, 42 })
        S.FileManager:showFiles("/mnt/us/documents")
        S.run()
        S.Controller:showHeadlines()
        local hl = S.UIManager:top()
        hl.on_story(hl.model.stories[2].story)
        S.run()
        S.ReaderUI.instance:onClose()
        S.FileManager:showFiles(ROOT .. "/2026-11-13")
        S.run()
        eq(topName(S), "eek_headlines")
        -- And swipe down / Back on the headlines goes to the front page.
        S.UIManager:top():onClose()
        eq(topName(S), "eek_frontpage")
    end)

    it("All headlines from the panel; when all are read the panel offers the front page", function()
        local S = fresh()
        S.serve("2026-11-13", 1, { 41, 42 })
        S.FileManager:showFiles("/mnt/us/documents")
        S.run()
        S.Controller.store:issueState("2026-11-13").read["42"] = true
        local front = S.UIManager:top()
        front.on_start(front.model.first_up)
        S.run()
        local rui = S.ReaderUI.instance
        rui:turnPage(); rui:turnPage()
        local panel = S.UIManager:top()
        eq(panel.next_story, nil, "everything read: no next story")
        eq(panel.read, 2)
        panel:choose(panel.on_headlines)
        S.run()
        eq(topName(S), "eek_headlines")
        eq(S.UIManager:top().model.read_text, "2 of 2 read")
    end)

    it("opening his own book from a story leaves Early Edition", function()
        local S = fresh()
        S.serve("2026-11-13", 1, { 41 })
        S.FileManager:showFiles("/mnt/us/documents")
        S.run()
        S.UIManager:top().on_start(S.UIManager:top().model.first_up)
        S.run()
        S.ReaderUI.instance:switchDocument(BOOK)
        S.run()
        eq(S.Controller.store:session().active, nil)
        eq(S.ReaderUI.instance.document.file, BOOK)
        falsy(S.Controller.screen)
        for _, item in ipairs(S.ReadHistory.hist) do
            falsy(item.file:find(ROOT, 1, true))
        end
    end)

    it("back issues and my week open from the front page and come back", function()
        local S = fresh()
        S.serve("2026-11-13", 1, { 41, 42 })
        S.FileManager:showFiles("/mnt/us/documents")
        S.run()
        S.UIManager:top().on_back_issues()
        eq(topName(S), "eek_backissues")
        local rows = S.UIManager:top().rows
        eq(#rows, 1)
        eq(rows[1].label, "TODAY · 2 STORIES")
        eq(rows[1].dow, "FRI"); eq(rows[1].day, "13")
        S.UIManager:top().on_pick("2026-11-13")
        eq(topName(S), "eek_headlines")
        S.UIManager:top().on_front_page()
        S.UIManager:top().on_my_week()
        eq(topName(S), "eek_myweek")
        truthy(S.UIManager:top().model.empty)
        S.UIManager:top().on_front_page()
        eq(topName(S), "eek_frontpage")
        local pages = 0
        for _, w in ipairs(S.UIManager.stack) do
            if type(w.name) == "string" and w.name:match("^eek_") then pages = pages + 1 end
        end
        eq(pages, 1, "one of our pages at a time, never a pile")
    end)

    it("open_on_start: front page at start when today's issue is already on the device", function()
        local S = fresh()
        S.serve("2026-11-13", 1, { 41 })
        S.FileManager:showFiles("/mnt/us/documents")
        S.run()
        -- Simulate a restart with the server unreachable.
        S.Controller:dismissScreen()
        S.FileManager.instance:onClose()
        S.Controller.started = false
        S.http.down = true
        S.FileManager:showFiles("/mnt/us/documents")
        S.run()
        eq(topName(S), "eek_frontpage")
        -- Setting off: nothing opens.
        S.Controller:dismissScreen()
        S.FileManager.instance:onClose()
        S.Controller.store:setAutoOpen(false)
        S.Controller.started = false
        S.FileManager:showFiles("/mnt/us/documents")
        S.run()
        falsy(S.Controller.screen)
    end)

    it("Wi-Fi off and no auto-connect: waits, then syncs on NetworkConnected", function()
        local S = fresh()
        G_reader_settings:saveSetting("wifi_enable_action", "prompt")
        S.connected = false
        S.serve("2026-11-13", 1, { 41 })
        S.FileManager:showFiles("/mnt/us/documents")
        S.run()
        eq(#S.http.requests, 0)
        S.connected = true
        S.UIManager:broadcastEvent(S.Event.new("NetworkConnected"))
        S.run()
        eq(topName(S), "eek_frontpage")
    end)

    it("resume: re-syncs per the rules and uploads queued events once", function()
        local S = fresh()
        S.serve("2026-11-13", 1, { 41 })
        S.FileManager:showFiles("/mnt/us/documents")
        S.run()
        S.UIManager:top():onClose()
        S.UIManager:broadcastEvent(S.Event.new("Suspend"))
        S.UIManager:broadcastEvent(S.Event.new("Resume"))
        S.run()
        -- issue_downloaded + list_shown uploaded exactly once.
        eq(#(S.uploaded or {}), 2)
        eq(S.Controller.queue:count(), 0)
    end)

    it("a parent-added story appears after Check for news, with updated counts", function()
        local S = fresh()
        S.serve("2026-11-13", 1, { 41, 42, 43, 44, 45, 46 })
        S.FileManager:showFiles("/mnt/us/documents")
        S.run()
        S.Controller.store:issueState("2026-11-13").read["41"] = true
        S.Controller:showHeadlines()
        eq(S.UIManager:top().model.read_text, "1 of 6 read")
        S.serve("2026-11-13", 1, { 41, 42, 43, 44, 45, 46, 47 })
        S.Controller:checkNow()
        S.run()
        local hl = S.UIManager:top()
        eq(hl.name, "eek_headlines")
        eq(hl.model.read_text, "1 of 7 read")
        eq(hl.model.subtitle, "Friday 13 November · 7 stories · about 14 minutes")
        eq(hl.model.stories[7].title, "Story 47")
        -- And the front page counts too.
        S.Controller:showFrontPage()
        eq(S.UIManager:top().model.read_text, "1 of 7 read")
    end)

    it("an added story while he reads: notification, not a screen change", function()
        local S = fresh()
        S.serve("2026-11-13", 1, { 41 })
        S.FileManager:showFiles("/mnt/us/documents")
        S.run()
        S.UIManager:top():onClose()
        S.ReaderUI:showReader(BOOK)
        S.serve("2026-11-13", 1, { 41, 42 })
        S.Controller:checkNow()
        S.run()
        local found = false
        for _, w in ipairs(S.UIManager.shown) do
            if w.text and w.text:find("new story has been added", 1, true) then found = true end
        end
        truthy(found)
        falsy(S.Controller.screen)
    end)

    it("more stories than fit are paginated, never taller than the screen", function()
        local S = fresh()
        local ids = {}
        for i = 1, 12 do ids[i] = 40 + i end
        S.serve("2026-11-13", 1, ids)
        S.FileManager:showFiles("/mnt/us/documents")
        S.run()
        S.Controller:showHeadlines()
        local hl = S.UIManager:top()
        eq(#hl.model.stories, 12)
        truthy(hl.page_count > 1, "paginated")
        local seen = 0
        for page = 1, hl.page_count do
            hl.page = page
            hl:refresh()
            truthy(hl.body_height <= hl.body_room, "page " .. page .. " is " .. hl.body_height .. " of " .. hl.body_room)
            for _, r in ipairs(hl.page_rows) do
                if r.kind == "story" then seen = seen + 1 end
            end
        end
        eq(seen, 12, "every story is on some page")
        hl.page = 1; hl:refresh()
        local last = hl.page_rows[#hl.page_rows]
        eq(last.kind, "next")
        last.widget:onTapEEK()
        eq(hl.page, 2)
        eq(hl.page_rows[1].kind, "prev")
        hl.page_rows[1].widget:onTapEEK()
        eq(hl.page, 1)
        hl:onSwipe(nil, { direction = "west" })
        eq(hl.page, 2)
    end)

    it("manual check with the server down reports it", function()
        local S = fresh()
        S.serve("2026-11-13", 1, { 41 })
        S.FileManager:showFiles("/mnt/us/documents")
        S.run()
        S.http.down = true
        S.Controller:checkNow()
        S.run()
        local last = S.UIManager.shown[#S.UIManager.shown]
        truthy(last.text and last.text:find("Couldn't reach", 1, true))
    end)
end)

describe("server address (stubbed KOReader)", function()
    it("with no address: no automatic sync, and Check for news says where to set it", function()
        local S = fresh{ server_url = false }
        S.serve("2026-11-13", 1, { 41 })
        S.FileManager:showFiles("/mnt/us/documents")
        S.run()
        eq(#S.http.requests, 0)
        eq(S.Controller:serverUrl(), "")
        S.Controller:checkNow()
        S.run()
        eq(#S.http.requests, 0)
        local last = S.UIManager.shown[#S.UIManager.shown]
        truthy(last.text and last.text:find("Server address", 1, true))
    end)

    it("setting the address from the menu lets the next check fetch the paper", function()
        local S = fresh{ server_url = false }
        S.serve("2026-11-13", 1, { 41, 42 })
        S.FileManager:showFiles("/mnt/us/documents")
        S.run()
        S.Controller:setServerUrl("http://192.168.1.50:8080")
        eq(S.Controller:serverUrl(), "http://192.168.1.50:8080")
        eq(S.Controller.store:setting("server_url"), "http://192.168.1.50:8080")
        S.Controller:checkNow()
        S.run()
        truthy(#S.http.requests > 0)
        truthy(S.http.requests[#S.http.requests].url:find("^http://192%.168%.1%.50:8080/"))
        eq(S.Controller.store:get("current_date"), "2026-11-13")
    end)
end)

describe("upload after reading (stubbed KOReader)", function()
    -- Opens the first story from the front page and reads it to the end.
    local function readFirstStory(S)
        local front = S.UIManager:top()
        front.on_start(front.model.first_up)
        S.run(1)
        local rui = S.ReaderUI.instance
        S.mono.t = S.mono.t + 30; rui:turnPage()
        S.mono.t = S.mono.t + 40; rui:turnPage() -- EndOfBook: the finished panel
        return rui
    end
    local function closedUploads(S)
        local n = 0
        for _, ev in ipairs(S.uploaded or {}) do if ev.type == "story_closed" then n = n + 1 end end
        return n
    end
    local function issueFetches(S)
        local n = 0
        for _, req in ipairs(S.http.requests) do if req.url:find("/api/issue/today", 1, true) then n = n + 1 end end
        return n
    end

    it("sends what he read after the story closes, without fetching the paper again", function()
        local S = fresh()
        S.serve("2026-11-13", 1, { 41, 42 })
        S.FileManager:showFiles("/mnt/us/documents")
        S.run()
        local fetches = issueFetches(S)
        local rui = readFirstStory(S)
        rui:onClose()
        eq(closedUploads(S), 0, "not straight away")
        truthy(S.Controller._upload_task, "an upload is scheduled")
        S.run()
        eq(closedUploads(S), 1, "sent after the delay")
        eq(S.Controller.queue:count(), 0)
        eq(issueFetches(S), fetches, "upload only: no issue fetch")
    end)

    it("waits while the next story is open, and never turns Wi-Fi on", function()
        local S = fresh()
        S.serve("2026-11-13", 1, { 41, 42 })
        S.FileManager:showFiles("/mnt/us/documents")
        S.run()
        local rui = readFirstStory(S)
        rui:onClose()
        -- He opens another story before the minute is up.
        S.ReaderUI:showReader(ROOT .. "/2026-11-13/42.html")
        S.Controller:uploadNow()
        eq(closedUploads(S), 0, "not while a story is open")
        truthy(S.Controller._upload_task, "tried again later")
        S.ReaderUI.instance:onClose()
        S.connected = false
        S.Controller:uploadNow()
        eq(closedUploads(S), 0, "Wi-Fi off: left for the next sync")
        S.connected = true
        S.Controller:uploadNow()
        truthy(closedUploads(S) >= 1, "sent once Wi-Fi is on and no story is open")
    end)

    it("going to sleep cancels the pending upload; waking syncs as usual", function()
        local S = fresh()
        S.serve("2026-11-13", 1, { 41, 42 })
        S.FileManager:showFiles("/mnt/us/documents")
        S.run()
        readFirstStory(S):onClose()
        S.Controller:onSuspend()
        falsy(S.Controller._upload_task)
        eq(closedUploads(S), 0)
        S.Controller:onResume()
        S.run()
        eq(closedUploads(S), 1, "the wake-up sync sent it")
    end)
end)

describe("reading reset (stubbed KOReader)", function()
    it("a reading_since date from the server drops older reading-log entries", function()
        local S = fresh{ reading_log = {
            { date = "2026-11-12", day = "2026-11-12", story_id = 7, finished = true, title = "Test read" },
            { date = "2026-11-12", day = "2026-11-13", story_id = 8, finished = true, title = "Back issue read on Friday" },
            { date = "2026-11-13", day = "2026-11-13", story_id = 9, finished = true, title = "Friday" },
        } }
        S.serve("2026-11-13", 1, { 41 })
        S.FileManager:showFiles("/mnt/us/documents")
        S.run()
        eq(#S.Controller.readlog:entries(), 3, "no reset yet: nothing dropped")
        S.http.routes["GET /api/issue/today"].body = issueBody("2026-11-13", 1, { 41 }, { reading_since = "2026-11-13" })
        S.Controller:checkNow()
        S.run()
        eq(S.Controller.store:get("reading_since"), "2026-11-13")
        local left = {}
        for _, e in ipairs(S.Controller.readlog:entries()) do left[#left + 1] = e.story_id end
        eq(table.concat(left, ","), "8,9", "kept by the day it was read")
        eq(#S.backends["earlyeditionkids_log.lua"].data.entries, 2, "saved")
    end)
end)

describe("back-issue catch-up (stubbed KOReader)", function()
    local Clock = require("earlyeditionkids/clock")
    local function at(d, hh) return Clock.daysFromCivil(2026, 11, d) * 86400 + (hh or 7) * 3600 end
    local function texts(S, from)
        local out = {}
        for k = from or 1, #S.UIManager.shown do
            local w = S.UIManager.shown[k]
            if w.text then out[#out + 1] = w.text end
        end
        return out
    end

    it("Kindle left for four days: one sync brings today and the missed days, quietly", function()
        local S = fresh{ now = at(9), http_date = "Mon, 09 Nov 2026 07:00:00 GMT" }
        S.serve("2026-11-09", 1, { 90 })
        S.ReaderUI:showReader(BOOK) -- he is in his own book
        S.run()
        -- Four days later he wakes the Kindle, still in his book.
        S.now = at(13)
        S.http_date = "Fri, 13 Nov 2026 07:00:00 GMT"
        S.serve("2026-11-13", 1, { 130, 131 })
        S.serveDate("2026-11-12", 1, { 120 })
        S.serveDate("2026-11-11", 1, { 110 })
        S.serveDate("2026-11-10", 1, { 100 })
        local before = #S.UIManager.shown
        S.UIManager:broadcastEvent(S.Event.new("Resume"))
        S.run()
        eq(table.concat(S.Controller.issues:listDates(), ","),
           "2026-11-13,2026-11-12,2026-11-11,2026-11-10,2026-11-09")
        falsy(S.Controller.screen, "no screen opened over his book")
        local is_here = 0
        for _, t in ipairs(texts(S, before + 1)) do
            if t:find("is here", 1, true) then is_here = is_here + 1 end
            falsy(t:find("Nov", 1, true) or t:find("back issue", 1, true), "no notice about back issues: " .. t)
        end
        eq(is_here, 1, "one notice, for today's paper only")
        -- Back issues lists them all, newest first; today highlighted.
        S.Controller:showBackIssues()
        local rows = S.UIManager:top().rows
        local dates = {}
        for k, r in ipairs(rows) do dates[k] = r.date end
        eq(table.concat(dates, ","), "2026-11-13,2026-11-12,2026-11-11,2026-11-10,2026-11-09")
        truthy(rows[1].highlight)
        eq(rows[2].label, "1 STORY")
        eq(rows[2].read_text, "0 of 1")
    end)

    it("a back issue arriving later shows no notice and opens nothing", function()
        local S = fresh()
        S.serve("2026-11-13", 1, { 41 })
        S.FileManager:showFiles("/mnt/us/documents")
        S.run()
        S.UIManager:top():onClose() -- leave the front page
        -- Next morning, before today's paper: only Thursday was added on the server.
        S.now = at(14, 4)
        S.http_date = "Sat, 14 Nov 2026 04:00:00 GMT"
        S.serve("2026-11-13", 1, { 41 })
        S.serveDate("2026-11-12", 1, { 31 })
        local before = #S.UIManager.shown
        S.Controller:checkNow() -- "Check for news" also runs the catch-up
        S.run()
        truthy(S.fs.isFile(ROOT .. "/2026-11-12/31.html"))
        falsy(S.Controller.screen, "no screen")
        for _, t in ipairs(texts(S, before + 1)) do
            falsy(t:find("is here", 1, true) or t:find("added", 1, true), "unexpected notice: " .. t)
        end
    end)

    it("an open Back issues screen redraws with the caught-up issue", function()
        local S = fresh()
        S.serve("2026-11-13", 1, { 41 })
        S.FileManager:showFiles("/mnt/us/documents")
        S.run()
        S.Controller:showBackIssues()
        eq(#S.UIManager:top().rows, 1)
        S.now = at(14, 4)
        S.http_date = "Sat, 14 Nov 2026 04:00:00 GMT"
        S.serve("2026-11-13", 1, { 41 })
        S.serveDate("2026-11-12", 1, { 31 })
        S.Controller:checkNow()
        S.run()
        eq(S.Controller.screen_kind, "backissues")
        eq(#S.Controller.screen.rows, 2)
    end)
end)

describe("with Simple UI", function()
    local function frontShown(S)
        return S.Controller.screen ~= nil and S.Controller.screen_kind == "frontpage"
    end

    it("auto-open defaults on without Simple UI and off with it", function()
        local S = fresh()
        S.serve("2026-11-13", 1, { 41 })
        S.FileManager:showFiles("/mnt/us/documents")
        S.run()
        truthy(S.Controller:autoOpen())
        truthy(frontShown(S), "new issue opens the front page")

        local S2 = fresh{ simpleui = {} }
        S2.serve("2026-11-13", 1, { 41 })
        S2.FileManager:showFiles("/mnt/us/documents")
        S2.run()
        falsy(S2.Controller:autoOpen())
        falsy(S2.Controller.screen, "no take-over after a new issue")
        local notice
        for _, w in ipairs(S2.UIManager.shown) do
            if w.text and w.text:find("is here", 1, true) then notice = w.text end
        end
        truthy(notice and notice:find("home screen", 1, true), tostring(notice))
    end)

    it("Simple UI switched off in its own settings counts as absent", function()
        local S = fresh{ simpleui = { switched_off = true } }
        S.FileManager:showFiles("/mnt/us/documents")
        truthy(S.Controller:autoOpen())
        falsy(S.Controller.simpleui:present())
    end)

    it("no auto-open at start when off; the switch turns it on", function()
        local S = fresh{ simpleui = {} }
        S.serve("2026-11-13", 1, { 41 })
        S.FileManager:showFiles("/mnt/us/documents")
        S.run()
        -- Restart, server unreachable, today's paper already here.
        S.FileManager.instance:onClose()
        S.Controller.started = false
        S.http.down = true
        S.FileManager:showFiles("/mnt/us/documents")
        S.run()
        falsy(S.Controller.screen, "start does not open the front page with Simple UI")
        S.Controller.store:setAutoOpen(true)
        S.FileManager.instance:onClose()
        S.Controller.started = false
        S.FileManager:showFiles("/mnt/us/documents")
        S.run()
        truthy(frontShown(S))
    end)

    it("migrates the old open_on_start choice and keeps it", function()
        local Store = require("earlyeditionkids/store")
        local st = Store.new(H.memBackend{ settings = { open_on_start = false } })
        eq(st:autoOpen(false), false, "explicit off kept without Simple UI")
        eq(st.data.settings.open_on_start, nil, "old key removed")
        eq(st.data.settings.auto_open, false)
        local st2 = Store.new(H.memBackend{ settings = { open_on_start = true } })
        eq(st2:autoOpen(true), true, "explicit on kept with Simple UI")
        local st3 = Store.new(H.memBackend{ settings = {} })
        eq(st3:autoOpen(true), false)
        eq(st3:autoOpen(false), true)
        eq(st3.data.settings.auto_open, nil, "the default is not written down")
        st3:setAutoOpen(true)
        eq(st3:autoOpen(true), true)
    end)

    it("registers its Quick Actions once, with live labels, and execute opens the front page", function()
        local S = fresh{ simpleui = {} }
        S.serve("2026-11-13", 1, { 41, 42, 43, 44 })
        S.FileManager:showFiles("/mnt/us/documents")
        S.run()
        local QA = S.sui.QA
        eq(QA.register_calls, 2, "front page + today's paper")
        local fp, hl = QA.registry.earlyeditionkids_frontpage, QA.registry.earlyeditionkids_headlines
        truthy(fp and hl)
        eq(fp.label, "Early Edition")
        truthy(fp.icon:find("icons/simpleui/early%-edition%.svg$"), fp.icon)
        truthy(hl.icon:find("icons/simpleui/todays%-paper%.svg$"), hl.icon)
        truthy(fp.is_in_place)
        eq(fp.get_label(fp.id), "Early Edition · 4 new")
        local st = S.Controller.store:issueState("2026-11-13")
        st.read["41"] = true
        eq(fp.get_label(fp.id), "Early Edition · 3 new")
        for _, k in ipairs({ "42", "43", "44" }) do st.read[k] = true end
        eq(fp.get_label(fp.id), "Early Edition")

        -- More file manager starts do not register again.
        S.FileManager.instance:onClose()
        S.FileManager:showFiles("/mnt/us/documents")
        S.run()
        eq(QA.register_calls, 2)

        -- Execute from Simple UI's home screen opens our front page.
        fp.execute({})
        S.run()
        truthy(frontShown(S))
        hl.execute({})
        S.run()
        eq(S.Controller.screen_kind, "headlines")

        -- Plugin stopped: both actions removed.
        S.FileManager.instance.plugin:stopPlugin()
        eq(QA.unregister_calls, 2)
        eq(QA.registry.earlyeditionkids_frontpage, nil)
    end)

    it("get_label never raises, even with no issue at all", function()
        local S = fresh{ simpleui = {} }
        S.http.down = true
        S.FileManager:showFiles("/mnt/us/documents")
        S.run()
        local fp = S.sui.QA.registry.earlyeditionkids_frontpage
        eq(fp.get_label(fp.id), "Early Edition")
    end)

    it("registers late when Simple UI's module only appears after us", function()
        local S = fresh{ simpleui = { late = true } }
        S.serve("2026-11-13", 1, { 41 })
        S.FileManager:showFiles("/mnt/us/documents")
        S.run()
        eq(S.sui.QA.register_calls, 0, "nothing to register with yet, and no error")
        -- Simple UI finishes loading; the next file manager start picks it up.
        S.sui.loaded = true
        S.FileManager.instance:onClose()
        S.FileManager:showFiles("/mnt/us/documents")
        S.run()
        eq(S.sui.QA.register_calls, 2)
    end)

    it("a broken Simple UI cannot break Early Edition", function()
        local S = fresh{ simpleui = {} }
        S.sui.QA.register = function() error("Simple UI changed its API") end
        S.serve("2026-11-13", 1, { 41 })
        S.FileManager:showFiles("/mnt/us/documents")
        S.run()
        eq(S.Controller.store:get("current_date"), "2026-11-13")
        S.Controller:showFrontPage()
        truthy(frontShown(S))
    end)

    it("leaving with no book goes to Simple UI's home screen", function()
        -- Front page opened from the home screen, closed without reading.
        local S = fresh{ simpleui = {} }
        S.serve("2026-11-13", 1, { 41, 42 })
        S.FileManager:showFiles("/mnt/us/documents")
        S.run()
        S.Controller:showFrontPage()
        S.UIManager:top():onClose()
        S.run()
        eq(S.sui.home_calls, 1)

        -- After reading a story, no book to return to.
        G_reader_settings:saveSetting("lastfile", nil)
        S.ReadHistory.hist = {}
        S.Controller:showFrontPage()
        local front = S.UIManager:top()
        front.on_start(front.model.first_up)
        S.run()
        S.ReaderUI.instance:onClose()
        S.FileManager:showFiles(ROOT .. "/2026-11-13")
        S.run()
        eq(S.Controller.screen_kind, "frontpage")
        S.UIManager:top():onClose()
        S.run()
        eq(S.sui.home_calls, 2)
    end)

    it("leaving still reopens his own book when he came from it", function()
        local S = fresh{ simpleui = {} }
        S.serve("2026-11-13", 1, { 41 })
        S.ReaderUI:showReader(BOOK)
        S.run()
        S.Controller:showFrontPage()
        local front = S.UIManager:top()
        front.on_start(front.model.first_up)
        S.run()
        S.ReaderUI.instance:turnPage(); S.ReaderUI.instance:turnPage()
        local panel = S.UIManager:top()
        panel:choose(panel.on_front_page)
        S.run()
        S.UIManager:top():onClose()
        S.run()
        eq(S.ReaderUI.instance.document.file, BOOK)
        eq(S.sui.home_calls, 0)
    end)

    it("without Simple UI, leaving never calls its home screen", function()
        local S = fresh()
        S.serve("2026-11-13", 1, { 41 })
        S.FileManager:showFiles("/mnt/us/documents")
        S.run()
        S.UIManager:top():onClose()
        S.run()
        eq(S.sui.home_calls, 0)
        eq(S.sui.QA.register_calls, 0)
    end)
end)

describe("plugin flow logs", function()
    it("no errors or warnings were logged in the last scenario", function()
        collectLogs(require("koreader_stubs"))
        eq(#all_bad, 0, table.concat(all_bad, "\n"))
    end)
end)
