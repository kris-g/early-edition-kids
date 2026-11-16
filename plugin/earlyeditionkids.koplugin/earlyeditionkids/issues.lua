--[[--
Issue storage on the device (DESIGN 5.1 steps 1, 9, 10; CONTRACT hidden rule).

Layout under `root` (= <KOReader data dir>/earlyeditionkids):

    <date>/index.json      the server's issue JSON, exactly as received
    <date>/<story id>.html one file per story (named by id, not position, so a
                           regenerated issue never reuses a path and never
                           inherits a stale KOReader sidecar)
    <date>/<story id>.jpg  its photo, when it has one (CONTRACT "Story photos");
                           the page names it, so they sit side by side
    .tmp-<date>-v<n>/      download in progress; swapped in when complete

Per-story local state (opened, read, hidden) lives in the store, not here.

`fs` is injected so the tests can run on an in-memory file system:

    fs.isDir(p) fs.isFile(p) fs.list(p) -> {names} fs.mkdirp(p)
    fs.removeTree(p) fs.removeFile(p) fs.rename(a, b)
    fs.writeFile(p, data) -> ok, err   fs.readFile(p) -> data or nil

`on_delete_file(path)` is called for every story file before it is deleted,
so the KOReader side can remove the reading-position sidecars (`.sdr`) that
KOReader keeps for it and drop it from the history.
]]

local Clock = require("earlyeditionkids/clock")
local Const = require("earlyeditionkids/const")
local Store = require("earlyeditionkids/store")

local Issues = {}
Issues.__index = Issues

function Issues.new(opts)
    local self = setmetatable({}, Issues)
    self.root = opts.root
    self.fs = opts.fs
    self.json = opts.json
    self.store = opts.store
    self.on_delete_file = opts.on_delete_file or function() end
    self._index_cache = {}
    return self
end

function Issues:dir(date)
    return self.root .. "/" .. date
end

function Issues:storyFile(date, id)
    return self:dir(date) .. "/" .. Store.idKey(id) .. ".html"
end

function Issues:photoFile(date, id)
    return self:dir(date) .. "/" .. Store.idKey(id) .. ".jpg"
end

function Issues:tmpDir(date, version)
    return string.format("%s/.tmp-%s-v%s", self.root, date, tostring(version))
end

--- If `path` is an Early Edition Kids story file, returns date, id_key.
function Issues:parseStoryPath(path)
    if type(path) ~= "string" then return nil end
    local prefix = self.root .. "/"
    if path:sub(1, #prefix) ~= prefix then return nil end
    local date, id = path:sub(#prefix + 1):match("^(%d%d%d%d%-%d%d%-%d%d)/([^/]+)%.html$")
    if not date then return nil end
    return date, id
end

function Issues:isEarlyEditionKidsPath(path)
    if type(path) ~= "string" then return false end
    local prefix = self.root .. "/"
    return path:sub(1, #prefix) == prefix
end

--- Dates with a complete issue on the device, newest first.
function Issues:listDates()
    local dates = {}
    if not self.fs.isDir(self.root) then return dates end
    for _, name in ipairs(self.fs.list(self.root)) do
        if Clock.isDate(name) and self.fs.isFile(self:dir(name) .. "/index.json") then
            table.insert(dates, name)
        end
    end
    table.sort(dates, function(a, b) return a > b end)
    return dates
end

function Issues:loadIndex(date)
    if not date then return nil end
    local cached = self._index_cache[date]
    if cached then return cached end
    local raw = self.fs.readFile(self:dir(date) .. "/index.json")
    if not raw then return nil end
    local idx = self.json.decode(raw)
    if type(idx) ~= "table" or type(idx.stories) ~= "table" then return nil end
    table.sort(idx.stories, function(a, b) return (a.position or 0) < (b.position or 0) end)
    self._index_cache[date] = idx
    return idx
end

function Issues:forget(date)
    self._index_cache[date] = nil
end

--- Stories the child may see: in the index, not hidden, file on disk.
function Issues:visibleStories(date)
    local idx = self:loadIndex(date)
    if not idx then return {} end
    local st = self.store:issueState(date)
    local out = {}
    for _, s in ipairs(idx.stories) do
        local key = Store.idKey(s.id)
        if not st.hidden[key] and self.fs.isFile(self:storyFile(date, s.id)) then
            table.insert(out, s)
        end
    end
    return out
end

function Issues:findStory(date, id_key)
    local idx = self:loadIndex(date)
    if not idx then return nil end
    for _, s in ipairs(idx.stories) do
        if Store.idKey(s.id) == id_key then return s, idx end
    end
end

--- Summary for the headline header and the finished panel.
function Issues:summary(date)
    local stories = self:visibleStories(date)
    local st = self.store:issueState(date)
    local read, minutes = 0, 0
    for _, s in ipairs(stories) do
        if st.read[Store.idKey(s.id)] then read = read + 1 end
        minutes = minutes + (tonumber(s.minutes) or 1)
    end
    return { total = #stories, read = read, minutes = minutes, stories = stories }
end

--- Next unread visible story after `id_key` (wrapping), or nil.
function Issues:nextUnread(date, id_key)
    local stories = self:visibleStories(date)
    local st = self.store:issueState(date)
    local start = 0
    for i, s in ipairs(stories) do
        if Store.idKey(s.id) == id_key then start = i end
    end
    local n = #stories
    for k = 1, n do
        local s = stories[((start + k - 1) % n) + 1]
        local key = Store.idKey(s.id)
        if key ~= id_key and not st.read[key] then return s end
    end
    return nil
end

local function deleteStoryFiles(self, dir, protect_path)
    if not self.fs.isDir(dir) then return end
    for _, name in ipairs(self.fs.list(dir)) do
        if name:match("%.html$") then
            local path = dir .. "/" .. name
            if path ~= protect_path then
                self.on_delete_file(path)
            end
        end
    end
end

--- Deletes one issue folder (and the sidecars of its story files).
function Issues:removeIssue(date)
    local dir = self:dir(date)
    deleteStoryFiles(self, dir)
    self.fs.removeTree(dir)
    self._index_cache[date] = nil
end

--- Deletes every issue folder (and their sidecars) and every stale download
-- folder: the server now serves a different paper (CONTRACT "Profiles").
function Issues:removeAll()
    if not self.fs.isDir(self.root) then return end
    for _, name in ipairs(self.fs.list(self.root)) do
        if Clock.isDate(name) then
            self:removeIssue(name)
        elseif name:match("^%.tmp%-") then
            self.fs.removeTree(self.root .. "/" .. name)
        end
    end
    self._index_cache = {}
end

--- Deletes one story file (a hidden story). Returns true if deleted.
function Issues:removeStoryFile(date, id, protect_path)
    local path = self:storyFile(date, id)
    if path == protect_path then return false end
    local photo = self:photoFile(date, id)
    if self.fs.isFile(photo) then self.fs.removeFile(photo) end
    if self.fs.isFile(path) then
        self.on_delete_file(path)
        self.fs.removeFile(path)
        return true
    end
    return false
end

--[[--
Keeps `keep_days` days of issues counted back from `today` (inclusive) and
removes older folders, their sidecars and their state. Never removes the
dates in `protect` (a set: the newest issue and any issue with an open story),
so a device clock that is far ahead cannot wipe what he is reading.
Also removes stale download folders. Returns the list of removed dates.
]]
function Issues:tidy(today, keep_days, protect)
    keep_days = keep_days or Const.KEEP_ISSUE_DAYS
    protect = protect or {}
    local removed = {}
    if not self.fs.isDir(self.root) then return removed end
    local cutoff = Clock.addDays(today, -(keep_days - 1))
    if not cutoff then return removed end
    for _, name in ipairs(self.fs.list(self.root)) do
        if Clock.isDate(name) then
            if name < cutoff and not protect[name] then
                self:removeIssue(name)
                self.store:dropIssueState(name)
                table.insert(removed, name)
            end
        elseif name:match("^%.tmp%-") then
            self.fs.removeTree(self.root .. "/" .. name)
        end
    end
    -- Drop state for dates whose folder is gone.
    local issues = self.store:get("issues", {})
    for date in pairs(issues) do
        if not self.fs.isDir(self:dir(date)) and not protect[date] then
            issues[date] = nil
        end
    end
    table.sort(removed)
    return removed
end

return Issues
