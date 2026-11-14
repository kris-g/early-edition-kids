--[[--
Active reading time and page tracking for one open story (DESIGN 5.3).

`active_seconds` excludes time asleep: the reader plugin calls pause() on
Suspend and resume() on Resume. The clock is injected; in KOReader it is the
monotonic clock (which on Linux also stops during suspend, so the two agree).

Time between two interactions (open, page turn, resume, close) is capped at
MAX_PAGE_SECONDS, so a story left open on the table does not count as an
hour of reading. The server decides engagement from these raw figures.
]]

local Const = require("earlyeditionkids/const")

local Tracker = {}
Tracker.__index = Tracker

function Tracker.new(opts)
    opts = opts or {}
    local self = setmetatable({}, Tracker)
    self.clock = opts.clock or os.time
    self.max_gap = opts.max_gap or Const.MAX_PAGE_SECONDS
    self.active = 0
    self.last = self.clock()
    self.paused = false
    self.max_page = 0
    self.pages_total = nil
    self.reached_end = false
    return self
end

function Tracker:tick()
    if self.paused then return end
    local now = self.clock()
    local d = now - self.last
    if d < 0 then d = 0 end
    if d > self.max_gap then d = self.max_gap end
    self.active = self.active + d
    self.last = now
end

function Tracker:pause()
    if self.paused then return end
    self:tick()
    self.paused = true
end

function Tracker:resume()
    if not self.paused then return end
    self.paused = false
    self.last = self.clock()
end

--- A page was shown. Returns true if this is the last page.
function Tracker:page(pageno, total)
    self:tick()
    if total and total > 0 then self.pages_total = total end
    if type(pageno) == "number" and pageno > self.max_page then
        self.max_page = pageno
    end
    return self.pages_total ~= nil and self.max_page >= self.pages_total
end

--- He turned forward from the last page (KOReader's EndOfBook).
function Tracker:markEnd(total)
    self:tick()
    if total and total > 0 then self.pages_total = total end
    self.reached_end = true
end

--- Final figures for the story_closed payload.
function Tracker:result(total)
    self:tick()
    total = (total and total > 0) and total or self.pages_total or math.max(self.max_page, 1)
    local max_page = self.max_page
    if self.reached_end or max_page > total then
        -- A font change can re-paginate; reaching the end still counts.
        max_page = self.reached_end and total or math.min(max_page, total)
    end
    if max_page < 1 then max_page = 1 end
    return {
        active_seconds = math.floor(self.active + 0.5),
        pages_total = total,
        max_page = max_page,
        finished = max_page == total,
    }
end

return Tracker
