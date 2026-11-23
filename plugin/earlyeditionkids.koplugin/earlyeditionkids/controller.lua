--[[--
Early Edition Kids controller: the KOReader-side behaviour (DESIGN 5.1).

This is a module-level singleton. KOReader creates a fresh plugin instance
for the file manager and for every opened document, and throws it away when
that closes, but Lua modules stay loaded for the whole KOReader process, so
everything long-lived (sync state, the open headline screen, callbacks
scheduled on UIManager) belongs here rather than in a plugin instance.
Persistent state is in the settings file through store.lua.

Screens: the front page is the entry point; from it, Today's paper (the
headline list), Back issues and My week. One of our full-screen pages is
shown at a time (self.screen); moving between them replaces it. Swipe down
or Back on any page but the front page goes to the front page.

Navigation model ("Early Edition session"):

- Before the first story opens, remember his last-opened book
  (`lastfile`) and, if he was reading it, that book (session.saved_lastfile,
  session.return_to_book).
- Stories open in the normal reader (ReaderUI:showReader or switchDocument).
  session.return_screen records where the story was opened from (front page
  or a headline list).
- Closing a story any other way than the finished panel (Home, the file
  browser) sets session.return_pending; the file manager instance that
  appears next shows that screen again.
- Closing the front page leaves Early Edition: story files are removed from
  KOReader's history, `lastfile` is restored, and his book is reopened if he
  came from it. Opening any other document while in Early Edition leaves too.
- Nothing is shown over one of his own books unless he asks (menu or
  gesture); a new issue then only shows a notification.
]]

local Clock = require("earlyeditionkids/clock")
local Const = require("earlyeditionkids/const")
local DataStorage = require("datastorage")
local Env = require("earlyeditionkids/env")
local InfoMessage = require("ui/widget/infomessage")
local Issues = require("earlyeditionkids/issues")
local JSON = require("earlyeditionkids/jsonutil")
local NetworkMgr = require("ui/network/manager")
local Notification = require("ui/widget/notification")
local Queue = require("earlyeditionkids/events")
local ReadingLog = require("earlyeditionkids/readinglog")
local Rules = require("earlyeditionkids/syncrules")
local Store = require("earlyeditionkids/store")
local StoryInfo = require("earlyeditionkids/storyinfo")
local Models = require("earlyeditionkids/models")
local SimpleUI = require("earlyeditionkids/simpleui")
local Sport = require("earlyeditionkids/sport")
local Syncer = require("earlyeditionkids/syncer")
local UIManager = require("ui/uimanager")
local UUID = require("earlyeditionkids/uuid")
local Api = require("earlyeditionkids/api")
local ServerUrl = require("earlyeditionkids/serverurl")
local ffiutil = require("ffi/util")
local lfs = require("libs/libkoreader-lfs")
local logger = require("logger")
local util = require("util")
local T = ffiutil.template

local Controller = {
    ready = false,
    started = false,       -- first plugin instance of this KOReader process seen
    syncing = false,
    waiting_for_network = nil,
    screen = nil,          -- our full-screen page currently shown (front page, headlines, ...)
    screen_kind = nil,     -- "frontpage" | "headlines" | "backissues" | "myweek" | "sport" | "sportmatch"
    sport_look = nil,      -- the Sport page being looked at, timed for sport_viewed
    panel = nil,           -- FinishedPanel currently shown
    clock = os.time,       -- wall clock, replaced by Env.now in setup
}

-- No default server: it is set on the Kindle (Early Edition settings → Server
-- address) or, for people who prefer files, in config.lua.
local DEFAULT_CONFIG = {
    server_url = "",
    earliest_fetch_hour = 5,
}

local function isFile(p)
    return p ~= nil and lfs.attributes(p, "mode") == "file"
end

local function loadConfig(plugin_path)
    local cfg = {}
    for k, v in pairs(DEFAULT_CONFIG) do cfg[k] = v end
    -- dofile, not require: a bare require("config") could pick up another
    -- plugin's config.lua from package.path.
    -- config.lua is optional: the server address is normally set from the menu.
    local file = plugin_path .. "/config.lua"
    if isFile(file) then
        local ok, user = pcall(dofile, file)
        if ok and type(user) == "table" then
            for k, v in pairs(user) do cfg[k] = v end
        else
            logger.warn("Early Edition Kids: could not read config.lua, using defaults:", user)
        end
    end
    if type(cfg.server_url) ~= "string" then cfg.server_url = "" end
    cfg.earliest_fetch_hour = tonumber(cfg.earliest_fetch_hour) or DEFAULT_CONFIG.earliest_fetch_hour
    return cfg
end

---------------------------------------------------------------------------
-- Setup
---------------------------------------------------------------------------

function Controller:setup(plugin_path)
    if self.ready then return true end
    local ok, err = pcall(function()
        -- Absolute, so the bundled font can be named from KOReader's fonts folder (widgets.lua).
        self.plugin_path = ffiutil.realpath(plugin_path) or plugin_path
        self.config = loadConfig(plugin_path)
        local root = DataStorage:getFullDataDir() .. "/" .. Const.DATA_SUBDIR
        util.makePath(root)
        -- ReadHistory stores realpath()s, so use the real path for matching.
        self.root = ffiutil.realpath(root) or root
        self.fs = Env.fs()
        self.store = Store.new(Env.settingsBackend(Const.SETTINGS_FILE))
        self.readlog = ReadingLog.new(Env.settingsBackend(Const.LOG_FILE))
        self.queue = Queue.new(self.store, UUID.v4)
        self.issues = Issues.new{
            root = self.root, fs = self.fs, json = JSON, store = self.store,
            on_delete_file = Env.cleanupDocFile,
        }
        self.api = Api.new{ base_url = self:serverUrl(), transport = Env.transport, json = JSON }
        self.device_id = self.store:deviceId(UUID.v4)
        self.simpleui = SimpleUI.new(Env.simpleUI())
        -- Wall clock (device epoch); injectable so the tests do not depend on the real date.
        self.clock = Env.now or os.time
    end)
    if not ok then
        logger.err("Early Edition Kids: setup failed:", err)
        return false
    end
    self.ready = true
    logger.info("Early Edition Kids: ready; version", Const.VERSION, "server", self:serverUrl() ~= "" and self:serverUrl() or "not set",
                "data", self.root, "json", JSON.backend)
    return true
end

--- The server address: the one set on the Kindle, else config.lua's, else "".
function Controller:serverUrl()
    local s = self.store and self.store:setting("server_url")
    if type(s) == "string" and s ~= "" then return s end
    return self.config and self.config.server_url or ""
end

--- Saves the address typed on the Kindle ("" clears it, falling back to config.lua).
function Controller:setServerUrl(url)
    self.store:setSetting("server_url", (url and url ~= "") and url or nil)
    self.store:save()
    self.api = Api.new{ base_url = self:serverUrl(), transport = Env.transport, json = JSON }
    logger.info("Early Edition Kids: server address set to", self:serverUrl())
end

--- Early Edition settings → Server address: type it, save, and check for news at once.
function Controller:editServerUrl()
    if not self.ready then return end
    local InputDialog = require("ui/widget/inputdialog")
    local dialog
    dialog = InputDialog:new{
        title = "Early Edition server address",
        input = self:serverUrl() ~= "" and self:serverUrl() or "http://",
        input_hint = ServerUrl.HINT,
        description = "The address of the computer running the Early Edition server, with port 8080, for example "
            .. ServerUrl.HINT .. ". The Kindle must be on the same network. A second child's Kindle adds /p/ and "
            .. "that child's profile, for example " .. ServerUrl.HINT .. "/p/younger.",
        buttons = { {
            { text = "Cancel", id = "close", callback = function() UIManager:close(dialog) end },
            {
                text = "Save and check",
                is_enter_default = true,
                callback = function()
                    local url, err = ServerUrl.normalize(dialog:getInputText())
                    if not url then
                        UIManager:show(InfoMessage:new{ text = err, timeout = 5 })
                        return
                    end
                    UIManager:close(dialog)
                    self:setServerUrl(url)
                    if url ~= "" then UIManager:nextTick(function() self:checkNow() end) end
                end,
            },
        } },
    }
    UIManager:show(dialog)
    dialog:onShowKeyboard()
end

function Controller:today()
    return Clock.today(self.clock(), self.store:get("clock_skew"))
end

function Controller:isEarlyEditionKidsFile(path)
    if not path then return false end
    if self.issues:isEarlyEditionKidsPath(path) then return true end
    local real = ffiutil.realpath(path)
    return real ~= nil and self.issues:isEarlyEditionKidsPath(real)
end

--- The story currently open in the reader, if it is an Early Edition Kids story.
function Controller:openStoryPath()
    local ReaderUI = require("apps/reader/readerui")
    local rui = ReaderUI.instance
    local file = rui and rui.document and rui.document.file
    if file and self:isEarlyEditionKidsFile(file) then return file end
end

--- Identify an Early Edition Kids story from a document path. Returns a story context or nil.
function Controller:identifyStory(path)
    if not self:isEarlyEditionKidsFile(path) then return nil end
    local date, key = self.issues:parseStoryPath(path)
    if not date then
        date, key = self.issues:parseStoryPath(ffiutil.realpath(path) or "")
    end
    if not date then return nil end
    local story, idx = self.issues:findStory(date, key)
    return {
        date = date,
        key = key,
        id = story and story.id or tonumber(key),
        topic = story and story.topic,
        title = story and story.title,
        version = idx and idx.version,
        path = path,
    }
end

---------------------------------------------------------------------------
-- Sync
---------------------------------------------------------------------------

function Controller:scheduleAutoSync(delay)
    if not self.ready then return end
    if self._auto_task then UIManager:unschedule(self._auto_task) end
    self._auto_task = function()
        self._auto_task = nil
        self:autoSync()
    end
    UIManager:scheduleIn(delay or 3, self._auto_task)
end

function Controller:decide(manual)
    return Rules.decide{
        now = self.clock(),
        skew = self.store:get("clock_skew"),
        earliest_hour = self.config.earliest_fetch_hour,
        sync = self.store:syncState(),
        current_date = self.store:get("current_date"),
        has_fresh_events = self.queue:hasFresh(),
        manual = manual,
    }
end

function Controller:autoSync()
    if not self.ready or self.syncing then return end
    if self:serverUrl() == "" then return end -- nothing to sync with until the address is set
    local should, reason, info = self:decide(false)
    logger.dbg("Early Edition Kids: auto sync?", should, reason, info.today, info.hour)
    if should then
        self:startSync{ manual = false, expect_new = info.expect_new, reason = reason }
    end
end

--- "Check for news": syncs at once, ignores the back-off, reports the result.
function Controller:checkNow()
    if not self.ready then return end
    if self.syncing then return end
    if self:serverUrl() == "" then
        UIManager:show(InfoMessage:new{
            text = "Set the server address first: Early Edition settings → Server address.", timeout = 5 })
        return
    end
    local _, _, info = self:decide(true)
    self:startSync{ manual = true, expect_new = info.expect_new, reason = "manual" }
end

function Controller:startSync(opts)
    local go = function() self:runSync(opts) end
    if NetworkMgr:isConnected() then
        go()
    elseif opts.manual or G_reader_settings:readSetting("wifi_enable_action") == "turn_on" then
        -- Brings Wi-Fi up (KOReader shows "Connecting to Wi-Fi…") and runs
        -- the sync once connected. A manual check may also get KOReader's
        -- "Turn on Wi-Fi?" prompt, which is fine for a tap.
        NetworkMgr:runWhenConnected(go)
    else
        -- Never pop a Wi-Fi prompt on an automatic sync. The Kindle usually
        -- reconnects by itself after wake; onNetworkConnected picks this up.
        self.waiting_for_network = opts
        logger.info("Early Edition Kids: Wi-Fi is off; sync will run when it connects")
    end
end

function Controller:onResume()
    if self.screen_kind == "sport" or self.screen_kind == "sportmatch" then self:beginSportLook() end
    self:scheduleAutoSync(3)
end

--[[--
Sends what he read soon after a story closes, so the parent dashboard doesn't
wait for the next wake. One upload a minute after the last story closed (so
three stories in a row make one upload); only when Wi-Fi is already on, with
no notice; and never while a story is open, since the upload briefly holds the
screen. Anything not sent goes at the next normal sync.
]]
function Controller:scheduleUpload(delay)
    if not self.ready then return end
    if self._upload_task then UIManager:unschedule(self._upload_task) end
    self._upload_task = function()
        self._upload_task = nil
        self:uploadNow()
    end
    UIManager:scheduleIn(delay or Const.UPLOAD_DELAY, self._upload_task)
end

function Controller:uploadNow()
    if not self.ready or self.syncing or self:serverUrl() == "" or not self.queue:hasFresh() then return end
    if self:openStoryPath() then
        self:scheduleUpload() -- reading the next story: try again after it
        return
    end
    if not NetworkMgr:isConnected() then return end -- never turn Wi-Fi on for this
    self.syncing = true
    local ok, result = pcall(Syncer.upload, self:syncContext())
    self.syncing = false
    if not ok then
        logger.err("Early Edition Kids: upload crashed:", result)
        return
    end
    logger.info("Early Edition Kids: upload after reading ->", result.kind, result.message or "",
                "events sent", result.events_sent, "accepted", result.events_accepted)
end

function Controller:onSuspend()
    self:endSportLook()
    if self._upload_task then
        UIManager:unschedule(self._upload_task)
        self._upload_task = nil
    end
    if self._auto_task then
        UIManager:unschedule(self._auto_task)
        self._auto_task = nil
    end
end

function Controller:onNetworkConnected()
    if self.waiting_for_network and not self.syncing then
        local opts = self.waiting_for_network
        self.waiting_for_network = nil
        UIManager:scheduleIn(1, function() self:runSync(opts) end)
    end
end

function Controller:notify(text)
    UIManager:show(Notification:new{ text = text, timeout = 3 })
end

function Controller:syncContext()
    return {
        api = self.api, store = self.store, queue = self.queue, issues = self.issues,
        readlog = self.readlog, json = JSON, device_id = self.device_id,
        now = self.clock,
        protected_path = self:openStoryPath(),
        log = function(level, ...) (logger[level] or logger.info)("Early Edition Kids:", ...) end,
    }
end

function Controller:runSync(opts)
    if self.syncing then return end
    self.waiting_for_network = nil
    self.syncing = true
    if opts.expect_new or opts.manual then
        self:notify("Getting today's news…")
        UIManager:forceRePaint() -- the sync below blocks the UI for a moment
    end
    local ok, result = pcall(Syncer.run, self:syncContext())
    self.syncing = false
    if not ok then
        logger.err("Early Edition Kids: sync crashed:", result)
        result = { kind = "server", message = tostring(result) }
    end
    local st = Rules.record(self.store:syncState(), result.kind, self.clock())
    local trimmed = self.readlog:prune(self:today()) + self.readlog:dropBefore(self.store:get("reading_since"))
    if trimmed > 0 then
        self.readlog:save()
        logger.info("Early Edition Kids: reading log trimmed by", trimmed, "entries; reading counts from",
                    self.store:get("reading_since") or "-")
        if self.screen_kind == "myweek" then self:refreshScreen() end
    end
    self.store:save()
    -- If he keeps reading past the back-off, try again then rather than
    -- waiting for the next wake (UIManager tasks pause while asleep, and
    -- onResume reschedules anyway).
    if st.next_auto_at then
        local wait = st.next_auto_at - self.clock()
        if wait > 0 then self:scheduleAutoSync(wait + 5) end
    end
    logger.info("Early Edition Kids: sync", opts.reason or "", "->", result.kind, result.outcome or "",
                result.message or "", "events sent", result.events_sent or 0,
                "accepted", result.events_accepted or 0)
    self:afterSync(result, opts)
end

function Controller:afterSync(result, opts)
    local ReaderUI = require("apps/reader/readerui")
    if result.kind ~= "ok" and self.screen and (result.profile_changed or (result.backfilled and #result.backfilled > 0
       and (self.screen_kind == "backissues" or self.screen_kind == "frontpage"))) then
        self:refreshScreen() -- back issues caught up after a 404 for today, or another child's paper
    end
    if result.kind == "ok" then
        local fresh = result.outcome == "new_issue" or result.outcome == "replaced"
        if fresh or result.list_changed then
            if self.screen then
                -- One of our screens is up: redraw it with the new issue.
                if fresh and self.screen_kind ~= "frontpage" and not opts.manual then
                    self:showFrontPage()
                else
                    self:refreshScreen()
                end
            elseif fresh and not ReaderUI.instance and self:autoOpen() then
                -- No book open and "Open Early Edition by itself" on: show
                -- the front page (DESIGN 5.1 step 4).
                self:showFrontPage()
            elseif fresh then
                local idx = self.issues:loadIndex(result.date)
                local where = self.simpleui:present() and "Tap Early Edition on your home screen, or use the menu."
                              or "Open it from the menu: Early Edition."
                self:notify(T("%1 is here! %2", idx and idx.title or Const.DEFAULT_TITLE, where))
            elseif (result.added or 0) > 0 then
                self:notify(result.added == 1 and "A new story has been added to today's paper."
                            or T("%1 new stories have been added to today's paper.", result.added))
            end
        elseif result.sport_changed and self.screen
               and (self.screen_kind == "frontpage" or self.screen_kind == "sport" or self.screen_kind == "sportmatch") then
            -- The Sport page or its lock changed (a new page, or a parent changed the rule).
            self:refreshScreen()
        elseif result.backfilled and #result.backfilled > 0 and self.screen
               and (self.screen_kind == "backissues" or self.screen_kind == "frontpage") then
            -- Back issues caught up: no notice, no new screen; just redraw the
            -- list (or the front page's edition number) if it is showing.
            self:refreshScreen()
        end
        if opts.manual and not fresh and not result.list_changed then
            UIManager:show(InfoMessage:new{ text = "You already have the latest news.", timeout = 3 })
        end
    elseif opts.manual then
        local text
        if result.kind == "not_found" then
            text = "Today's news isn't ready yet. Try again a bit later."
        else
            text = "Couldn't reach the news server. Check the Wi-Fi and try again."
        end
        UIManager:show(InfoMessage:new{ text = text, timeout = 5 })
    end
end

---------------------------------------------------------------------------
-- Models (the logic is in models.lua; this gathers the inputs)
---------------------------------------------------------------------------

--- Word and source parsed from a stored story page, cached per file.
function Controller:pageInfo(date, story)
    local path = self.issues:storyFile(date, story.id)
    self.page_info = self.page_info or {}
    local info = self.page_info[path]
    if info == nil then
        local html = self.fs.readFile(path)
        info = { word = StoryInfo.wordToKnow(html), source = StoryInfo.source(html) }
        self.page_info[path] = info
    end
    return info
end

function Controller:wordFor(date, story)
    return StoryInfo.apiWord(story.word_to_know) or self:pageInfo(date, story).word
end

function Controller:latestDate()
    return self.store:get("current_date") or self.issues:listDates()[1]
end

---------------------------------------------------------------------------
-- The Sport page (docs/sports-page.md; logic in sport.lua)
---------------------------------------------------------------------------

function Controller:sportView()
    return Sport.load(self.issues, JSON)
end

--- Whether Sport is open today; once it opens it stays open for the day.
function Controller:sportLock()
    local today = self:today()
    local lock = Sport.lock{
        today = today,
        sport_issue = self.store:get("sport_issue"),
        view = self:sportView(),
        sport_day = self.store:get("sport_day"),
        sport_open = self.store:get("sport_open"),
        entries = self.readlog:entries(),
    }
    if lock.stick and self.store:get("sport_open") ~= today then
        self.store:set("sport_open", today)
        self.store:save()
    end
    return lock
end

function Controller:sportModel(tab, half)
    local view = self:sportView()
    local lock = self:sportLock()
    local m = { tab = tab or "matches" }
    if not lock.open then
        m.closed = { needed = lock.needed, counted = lock.counted, togo = lock.needed - lock.counted }
        -- The next story that would count, shown as a headline to tap.
        local _, story, again = self:nextStoryToRead()
        if story then m.closed.story = { id = story.id, title = story.title, topic = story.topic, again = again } end
        return m
    end
    if not view then return m end
    m.matchday = Sport.matchday(view, view.matchday)
    m.next = Sport.matchday(view, view.next)
    m.table = view.matchday and Sport.tableHalf(view, half) or nil
    m.results_text = view.results_to and ("Results to " .. Sport.shortDay(view.results_to)) or ""
    if m.tab == "matches" and not m.matchday then m.tab = m.next and "next" or "table" end
    return m
end

--[[--
The next story toward opening Sport, for the closed screen: the first in today's
paper that doesn't count yet (not read, or read too quickly), so it never points
at one already counted. Returns date, story (or nil), again (it was read, but too
quickly to count).
]]
function Controller:nextStoryToRead()
    local date = self:latestDate()
    if not date then return nil end
    local stories = self.issues:visibleStories(date)
    local read = self.store:issueState(date).read or {}
    local si = self.store:get("sport_issue")
    local rule = si and si.date == date and si.sports and si.sports.unlock or nil
    if type(rule) ~= "table" then return date, Models.firstUnread(stories, read), false end
    local counted = Sport.counted(date, rule, self.readlog:entries())
    local again
    for _, s in ipairs(stories) do
        if not counted[tostring(s.id)] and rule.min_seconds and rule.min_seconds[tostring(s.id)] then
            -- An unread story first; one read too quickly only when none is left unread.
            if not read[Store.idKey(s.id)] then return date, s, false end
            again = again or s
        end
    end
    return date, again, again ~= nil
end

function Controller:openNextStory()
    local date, story = self:nextStoryToRead()
    if story then self:openStory(date, story, { kind = "frontpage" })
    elseif date then self:showHeadlines(date)
    else self:showFrontPage() end
end

function Controller:showSport(tab, half)
    if not self.ready then return end
    self:configureWidgets()
    local SportScreen = require("earlyeditionkids/ui/sport")
    local m = self:sportModel(tab, half)
    self:present("sport", SportScreen:new{
        model = m,
        on_tab = function(t, h) self:showSport(t, h) end,
        on_match = function(id) self:showSportMatch(id, 1) end,
        on_front_page = function() self:showFrontPage() end,
        on_paper = function() self:openNextStory() end,
        on_close = function() self:showFrontPage() end,
    }, { tab = m.tab, half = m.table and m.table.half or nil, closed = m.closed ~= nil,
         matchday = (m.tab == "next" and m.next or m.matchday or {}).number })
end

function Controller:showSportMatch(id, page)
    if not self.ready then return end
    local view = self:sportView()
    local model = view and self:sportLock().open and Sport.match(view, id)
    if not model then return self:showSport("matches") end
    self:configureWidgets()
    local MatchScreen = require("earlyeditionkids/ui/sportmatch")
    self:present("sportmatch", MatchScreen:new{
        model = model,
        page = page or 1,
        on_page = function(p) self:showSportMatch(id, p) end,
        on_back = function() self:showSport("matches") end,
        on_close = function() self:showSport("matches") end,
    }, { id = id, page = page or 1, matchday = view.matchday and view.matchday.number })
end

--- Start timing the Sport page now showing (not the closed screen, nor the second page of the same match).
function Controller:beginSportLook()
    local kind, args = self.screen_kind, self.screen_args or {}
    if kind == "sport" and not args.closed and self:sportView() then
        self.sport_look = { page = args.tab, match_id = nil, matchday = args.matchday, started = self.clock() }
    elseif kind == "sportmatch" then
        self.sport_look = { page = "match", match_id = args.id, matchday = args.matchday, started = self.clock() }
    end
end

--- Record the Sport page being left: sport_viewed, if it was looked at for long enough (docs/sports-page.md 5.4).
function Controller:endSportLook()
    local look = self.sport_look
    if not look then return end
    self.sport_look = nil
    local seconds = math.min(Const.SPORT_MAX_LOOK, math.max(0, self.clock() - look.started))
    if seconds < Const.SPORT_MIN_LOOK then return end
    self.queue:add("sport_viewed", nil, { page = look.page, match_id = look.match_id, matchday = look.matchday,
                                          active_seconds = math.floor(seconds) }, self.clock())
    self.store:save()
    self:scheduleUpload()
end

function Controller:frontModel()
    local date = self:latestDate()
    local idx = date and self.issues:loadIndex(date)
    local m = Models.frontPage{
        date = idx and date or nil,
        today = self:today(),
        idx = idx,
        stories = idx and self.issues:visibleStories(date) or {},
        state = date and self.store:issueState(date) or nil,
        stored_dates = self.issues:listDates(),
        wordFor = function(s) return self:wordFor(date, s) end,
        sourceFor = function(s) return s.source_name or self:pageInfo(date, s).source end,
        photoFor = function(s)
            local p = self.issues:photoFile(date, s.id)
            return isFile(p) and p or nil
        end,
        skew = self.store:get("clock_skew"),
    }
    m.sport = Sport.strip(self.store:get("sport_issue"), self:today(), self:sportLock(), m.all_read)
    return m
end

function Controller:headlineModel(date)
    local idx = date and self.issues:loadIndex(date)
    if not idx then
        return { subtitle = Clock.longDate(self:today()), stories = {}, total = 0, read = 0,
                 read_text = "", empty_text = "No news yet. It usually arrives early in the morning." }
    end
    local sum = self.issues:summary(date)
    local st = self.store:issueState(date)
    local items = {}
    for _, s in ipairs(sum.stories) do
        table.insert(items, {
            topic = s.topic, title = s.title or "", teaser = s.teaser,
            minutes_text = T("%1 min", tonumber(s.minutes) or 1),
            done = st.read[Store.idKey(s.id)] and true or false,
            story = s,
        })
    end
    return {
        date = date,
        version = idx.version,
        subtitle = (idx.fallback and "Stories you missed · " or "") .. Clock.longDate(date) .. " · "
                   .. Models.storiesLine(sum.total, sum.minutes),
        read = sum.read,
        total = sum.total,
        read_text = T("%1 of %2 read", sum.read, sum.total),
        stories = items,
        empty_text = "All of today's stories have been taken off. Check again later.",
    }
end

function Controller:backIssueRows()
    local current = self:latestDate()
    return Models.backIssues{
        dates = self.issues:listDates(),
        current = current,
        current_is_today = current == self:today(),
        summaryFor = function(date)
            local sum = self.issues:summary(date)
            local lead = sum.stories[1] and sum.stories[1].title or ""
            return { total = sum.total, read = sum.read, lead = lead }
        end,
    }
end

function Controller:myWeekModel()
    return Models.myWeek(self.readlog:entries(), self:today())
end

---------------------------------------------------------------------------
-- Screens: one of ours is shown at a time (self.screen)
---------------------------------------------------------------------------

function Controller:configureWidgets()
    if self.widgets_ready then return end
    local W = require("earlyeditionkids/ui/widgets")
    local cache = DataStorage:getDataDir() .. "/cache/earlyeditionkids-icons"
    util.makePath(cache)
    local ok, FontList = pcall(require, "fontlist")
    local font_dir = ok and FontList.fontdir and ffiutil.realpath(FontList.fontdir) or nil
    W.configure{
        plugin_path = self.plugin_path,
        cache_dir = cache,
        readFile = self.fs.readFile,
        writeFile = self.fs.writeFile,
        font_dir = font_dir,
    }
    self.widgets_ready = true
end

--- Shows a screen widget, replacing the one we had (no callbacks fired).
function Controller:present(kind, widget, args)
    local same_match = kind == "sportmatch" and self.screen_kind == "sportmatch"
                       and (self.screen_args or {}).id == (args or {}).id
    -- Moving on from a Sport page records it; the second page of a match is the same look.
    if not same_match then self:endSportLook() end
    local old = self.screen
    self.screen, self.screen_kind, self.screen_args = widget, kind, args
    -- A full refresh only when one of our pages replaces the reader or file
    -- browser, to clear e-ink ghosting; between our own pages "partial".
    UIManager:show(widget, old and "partial" or "full")
    if old then UIManager:close(old) end
    if not same_match then self:beginSportLook() end
end

function Controller:dismissScreen()
    self:endSportLook()
    if self.screen then
        local w = self.screen
        self.screen, self.screen_kind, self.screen_args = nil, nil, nil
        UIManager:close(w)
    end
end

function Controller:refreshScreen()
    local kind, args = self.screen_kind, self.screen_args or {}
    if kind == "frontpage" then self:showFrontPage()
    elseif kind == "headlines" then self:showHeadlines(args.date, args.page)
    elseif kind == "backissues" then self:showBackIssues()
    elseif kind == "myweek" then self:showMyWeek()
    elseif kind == "sport" then self:showSport(args.tab, args.half)
    elseif kind == "sportmatch" then self:showSportMatch(args.id, args.page) end
end

function Controller:showFrontPage()
    if not self.ready then return end
    self:configureWidgets()
    local FrontPage = require("earlyeditionkids/ui/frontpage")
    local m = self:frontModel()
    local widget
    widget = FrontPage:new{
        model = m,
        on_start = function(story)
            local date = self:latestDate()
            if story then
                self:openStory(date, story, { kind = "frontpage" })
            else
                self:showHeadlines(date)
            end
        end,
        on_headlines = function() self:showHeadlines(self:latestDate()) end,
        on_back_issues = function() self:showBackIssues() end,
        on_my_week = function() self:showMyWeek() end,
        on_check = function() UIManager:nextTick(function() self:checkNow() end) end,
        -- Open or closed, the tile shows Sport: closed, its padlock and the next story to tap.
        on_sport = function() self:showSport() end,
        on_close = function()
            -- Leaving Early Edition: back to his book, else Simple UI's home
            -- screen when it is installed, else the file browser.
            self:dismissScreen()
            if self.store:session().active then
                self:leaveEarlyEditionKids(true)
            elseif not require("apps/reader/readerui").instance then
                self:goHomeScreen()
            end
        end,
    }
    self:present("frontpage", widget, {})
    if m.has_issue then
        local date = self:latestDate()
        local idx = self.issues:loadIndex(date)
        if idx then self:recordListShown(date, idx.version) end
    end
end

function Controller:showHeadlines(date, page)
    if not self.ready then return end
    self:configureWidgets()
    date = date or self:latestDate()
    local HeadlinesScreen = require("earlyeditionkids/ui/headlines")
    local model = self:headlineModel(date)
    local widget = HeadlinesScreen:new{
        model = model,
        page = page or 1,
        on_story = function(story) self:openStory(date, story, { kind = "headlines", date = date }) end,
        on_front_page = function() self:showFrontPage() end,
        on_back_issues = function() self:showBackIssues() end,
        on_close = function() self:showFrontPage() end,
    }
    self:present("headlines", widget, { date = date })
    if model.version then self:recordListShown(date, model.version) end
end

function Controller:showBackIssues()
    if not self.ready then return end
    self:configureWidgets()
    local BackIssuesScreen = require("earlyeditionkids/ui/backissues")
    self:present("backissues", BackIssuesScreen:new{
        rows = self:backIssueRows(),
        on_pick = function(date) self:showHeadlines(date) end,
        on_front_page = function() self:showFrontPage() end,
        on_close = function() self:showFrontPage() end,
    }, {})
end

function Controller:showMyWeek()
    if not self.ready then return end
    self:configureWidgets()
    local MyWeekScreen = require("earlyeditionkids/ui/myweek")
    self:present("myweek", MyWeekScreen:new{
        model = self:myWeekModel(),
        on_front_page = function() self:showFrontPage() end,
        on_close = function() self:showFrontPage() end,
    }, {})
end

--- Show a screen by its saved description { kind, date }.
function Controller:showSaved(where)
    where = where or { kind = "frontpage" }
    if where.kind == "headlines" then
        self:showHeadlines(where.date)
    else
        self:showFrontPage()
    end
end

function Controller:recordListShown(date, version)
    local st = self.store:issueState(date)
    if st.list_shown_version ~= version then
        st.list_shown_version = version
        self.queue:add("list_shown", nil, { date = date, version = version }, self.clock())
        self.store:save()
    end
end

function Controller:showStatus()
    local st = self.store:syncState()
    local function when(ts)
        if not ts then return "never" end
        return os.date("%Y-%m-%d %H:%M", ts)
    end
    UIManager:show(InfoMessage:new{
        text = T("%1\n\nServer: %2\nToday's issue: %3\nLast check: %4 (%5)\nLast success: %6\nQueued events: %7\nDevice id: %8\nClock skew: %9 s",
            Const.NAME .. " " .. Const.VERSION,
            self:serverUrl() ~= "" and self:serverUrl() or "not set (Early Edition settings → Server address)",
            self.store:get("current_date") or "none",
            when(st.last_attempt_at), st.last_result or "-", when(st.last_success_at),
            self.queue:count(), self.device_id, self.store:get("clock_skew") or 0),
    })
end

--- "Open Early Edition by itself" (Store:autoOpen; default off with Simple UI).
function Controller:autoOpen()
    return self.store:autoOpen(self.simpleui:present())
end

--- Unread stories in today's paper (0 when it is not today's or all read).
function Controller:unreadToday()
    local date = self.store:get("current_date")
    if not date or date ~= self:today() then return 0 end
    local sum = self.issues:summary(date)
    return math.max(0, sum.total - sum.read)
end

--- Simple UI Quick Action descriptors (features/sui_quickactions.lua API).
function Controller:quickActions()
    local icons = self.plugin_path .. "/icons/simpleui"
    local function label(base)
        return function()
            local ok, n = pcall(self.unreadToday, self)
            return SimpleUI.labelWithCount(base, ok and n or 0)
        end
    end
    return {
        {
            id = "earlyeditionkids_frontpage",
            label = "Early Edition",
            icon = icons .. "/early-edition.svg",
            get_label = label("Early Edition"),
            -- Our page floats over Simple UI's home screen, like its own dialogs.
            is_in_place = true,
            is_async_in_place = true,
            execute = function() UIManager:nextTick(function() self:showFrontPage() end) end,
        },
        {
            id = "earlyeditionkids_headlines",
            label = "Today's paper",
            icon = icons .. "/todays-paper.svg",
            is_in_place = true,
            is_async_in_place = true,
            execute = function() UIManager:nextTick(function() self:showHeadlines() end) end,
        },
    }
end

--- Registers our Quick Actions with Simple UI if it is there (safe to call often).
function Controller:registerSimpleUI()
    if not self.ready then return false end
    local ok, res = pcall(self.simpleui.register, self.simpleui, self:quickActions())
    return ok and res
end

function Controller:unregisterSimpleUI()
    if self.simpleui then pcall(self.simpleui.unregister, self.simpleui) end
end

--- At KOReader start: open the front page if no book is open, today's
-- issue is on the device and "Open Early Edition by itself" is on.
function Controller:maybeOpenOnStart()
    if not self:autoOpen() then return end
    local ReaderUI = require("apps/reader/readerui")
    if ReaderUI.instance or self.screen then return end
    if self.store:get("current_date") ~= self:today() then return end
    self:showFrontPage()
end

---------------------------------------------------------------------------
-- Stories and the Early Edition session
---------------------------------------------------------------------------

--- Opens a story in the reader. `from` = { kind = "frontpage" } or
-- { kind = "headlines", date = ... }: where closing the story returns to.
function Controller:openStory(date, story, from)
    local path = self.issues:storyFile(date, story.id)
    if not isFile(path) then
        UIManager:show(InfoMessage:new{ text = "This story isn't on the Kindle any more." })
        return
    end
    local ReaderUI = require("apps/reader/readerui")
    local sess = self.store:session()
    if not sess.active then
        sess.active = true
        local lastfile = G_reader_settings:readSetting("lastfile")
        if lastfile and not self:isEarlyEditionKidsFile(lastfile) then
            sess.saved_lastfile = lastfile
        end
        local rui = ReaderUI.instance
        local open = rui and rui.document and rui.document.file
        if open and not self:isEarlyEditionKidsFile(open) then
            sess.return_to_book = open
        end
    end
    if from then sess.return_screen = from end
    -- Tell the closing document (if any) that this is a switch, not a close.
    sess.switching = true
    self.store:save()
    if self.panel then
        UIManager:close(self.panel)
        self.panel = nil
    end
    UIManager:nextTick(function()
        local rui = ReaderUI.instance
        if rui and rui.document then
            rui:switchDocument(path)
        else
            ReaderUI:showReader(path)
        end
        -- Close our screen only now: showReader has already painted its
        -- "Opening file" message over it, so the file browser underneath
        -- never flashes up in between.
        self:dismissScreen()
    end)
end

--- Reader plugin instance for a story has started.
function Controller:onStoryOpened(story)
    local sess = self.store:session()
    sess.switching = nil
    sess.return_pending = nil
    -- Opened from the history or file browser rather than our screens:
    -- still a session, but there is no saved book to go back to.
    sess.active = true
    local st = self.store:issueState(story.date)
    st.opened[story.key] = true
    self.queue:add("story_opened", story.id, {}, self.clock())
    self.store:save()
end

function Controller:markRead(story)
    local st = self.store:issueState(story.date)
    if not st.read[story.key] then
        st.read[story.key] = true
        self.store:save()
    end
end

--- Reader plugin instance for a story is closing (CloseDocument).
function Controller:onStoryClosed(story, figures)
    self.queue:add("story_closed", story.id, {
        active_seconds = figures.active_seconds,
        pages_total = figures.pages_total,
        max_page = figures.max_page,
        finished = figures.finished,
    }, self.clock())
    if figures.finished then
        self.store:issueState(story.date).read[story.key] = true
    end
    local word
    local s = self.issues:findStory(story.date, story.key)
    if s then
        local w = self:wordFor(story.date, s)
        word = w and w.word
    end
    self.readlog:append{
        date = story.date, story_id = story.id, topic = story.topic, title = story.title,
        active_seconds = figures.active_seconds, finished = figures.finished, ts = self.clock(),
        day = self:today(), word = word,
    }
    self.readlog:save()
    local sess = self.store:session()
    if sess.active and not sess.switching then
        -- Closed some other way (Home, file browser): go back to where he came from.
        sess.return_pending = true
    end
    self.store:save()
    self:scheduleUpload()
end

--- A file manager instance has started (e.g. after Home from a story).
function Controller:onFileManagerReady(first_start)
    local sess = self.store:session()
    sess.switching = nil
    if sess.return_pending then
        sess.return_pending = nil
        local where = sess.return_screen
        self.store:save()
        UIManager:nextTick(function() self:showSaved(where) end)
    elseif first_start then
        UIManager:nextTick(function() self:maybeOpenOnStart() end)
    end
end

--- A document other than an Early Edition story has been opened.
function Controller:onOtherDocumentOpened()
    local sess = self.store:session()
    if sess.active then
        self:leaveEarlyEditionKids(false)
    end
end

function Controller:removeStoriesFromHistory()
    local ok, err = pcall(function()
        local ReadHistory = require("readhistory")
        local victims = {}
        for _, item in ipairs(ReadHistory.hist) do
            if self:isEarlyEditionKidsFile(item.file) then table.insert(victims, item.file) end
        end
        for _, file in ipairs(victims) do
            ReadHistory:removeItemByPath(file)
        end
    end)
    if not ok then logger.warn("Early Edition Kids: could not clean history:", err) end
end

--- Leave Early Edition: tidy history, restore lastfile, optionally go back to his book.
-- reopen = false when he has already opened another document himself.
function Controller:leaveEarlyEditionKids(reopen)
    local sess = self.store:session()
    if not sess.active then return end
    local saved, book = sess.saved_lastfile, sess.return_to_book
    self.store:clearSession()
    self.store:save()

    local function tidyHistory()
        self:removeStoriesFromHistory()
        if isFile(saved) then
            G_reader_settings:saveSetting("lastfile", saved)
        end
        G_reader_settings:flush()
    end

    if not reopen then
        tidyHistory()
        return
    end

    local ReaderUI = require("apps/reader/readerui")
    local rui = ReaderUI.instance
    local story_open = rui and rui.document and self:isEarlyEditionKidsFile(rui.document.file)
    if story_open then
        -- Our page was opened over a story: close it too.
        UIManager:nextTick(function()
            if isFile(book) then
                rui:switchDocument(book)
                tidyHistory()
            else
                rui:onClose()
                rui:showFileManager(isFile(saved) and saved or (self:homeDir() .. "/"))
                tidyHistory()
                self:goHomeScreen()
            end
        end)
    elseif isFile(book) and not rui then
        tidyHistory()
        UIManager:nextTick(function() ReaderUI:showReader(book) end)
    else
        tidyHistory()
        local FileManager = require("apps/filemanager/filemanager")
        local target = saved or book
        if FileManager.instance and isFile(target) then
            local dir = util.splitFilePathName(target)
            FileManager.instance.file_chooser:changeToPath(dir, target)
        end
        if not rui then self:goHomeScreen() end
    end
end

--- No book to go back to: with Simple UI, its home screen rather than the
-- plain file browser (its "simpleui_go_homescreen" action).
function Controller:goHomeScreen()
    if not self.simpleui:present() then return false end
    UIManager:nextTick(function() self.simpleui:goHome() end)
    return true
end

function Controller:homeDir()
    return G_reader_settings:readSetting("home_dir")
        or require("apps/filemanager/filemanagerutil").getDefaultDir()
end

--- Finished panel buttons: close the story and show one of our screens.
function Controller:leaveStoryTo(ui, where)
    local sess = self.store:session()
    sess.switching = true -- we show the screen ourselves, below
    self.store:save()
    UIManager:nextTick(function()
        local target = sess.saved_lastfile
        if not isFile(target) then target = self:homeDir() .. "/" end
        -- Same sequence as ReaderStatus:openFileBrowser.
        ui:onClose()
        ui:showFileManager(target)
        self.store:session().switching = nil
        self.store:save()
        self:showSaved(where)
    end)
end

--- Turning back from a story's first page: close it and show the screen he
-- opened it from (the headlines of its paper when he came another way).
function Controller:leaveStory(story, ui)
    if self.panel then
        UIManager:close(self.panel)
        self.panel = nil
    end
    local where = self.store:session().return_screen or { kind = "headlines", date = story and story.date }
    self:leaveStoryTo(ui, where)
end

function Controller:stampDate()
    local y, m, d = Clock.parseDate(self:today())
    if not y then return "" end
    return string.format("%d %s", d, string.upper(Clock.MONTHS[m]:sub(1, 3)))
end

function Controller:showFinishedPanel(story, ui)
    if self.panel then return end
    self:configureWidgets()
    local FinishedPanel = require("earlyeditionkids/ui/finishedpanel")
    local sum = self.issues:summary(story.date)
    local nxt = self.issues:nextUnread(story.date, story.key)
    self.panel = FinishedPanel:new{
        read = sum.read,
        total = sum.total,
        stamp_date = self:stampDate(),
        next_story = nxt,
        on_headlines = function() self:leaveStoryTo(ui, { kind = "headlines", date = story.date }) end,
        on_front_page = function() self:leaveStoryTo(ui, { kind = "frontpage" }) end,
        on_next = function() if nxt then self:openStory(story.date, nxt) end end,
        on_dismiss = function() self.panel = nil end,
    }
    UIManager:show(self.panel)
end

return Controller
