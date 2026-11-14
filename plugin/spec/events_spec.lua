local H = require("helpers")
local Store = require("earlyeditionkids/store")
local Queue = require("earlyeditionkids/events")
local JSON = require("earlyeditionkids/jsonutil")
local UUID = require("earlyeditionkids/uuid")
local describe, it, eq, truthy, falsy = H.describe, H.it, H.eq, H.truthy, H.falsy

local DAY = 86400

local function newQueue()
    local store = Store.new(H.memBackend())
    return Queue.new(store, H.counterIds()), store
end

describe("event queue", function()
    it("queues events with ids, device ts and payload", function()
        local q = newQueue()
        local ev = q:add("story_closed", 41, { active_seconds = 95, pages_total = 2, max_page = 2, finished = true }, 1000)
        eq(q:count(), 1)
        eq(ev.ts, 1000)
        eq(ev.story_id, 41)
        truthy(ev.client_event_id)
        truthy(q:hasFresh())
    end)

    it("removes exactly the accepted ids", function()
        local q = newQueue()
        local a = q:add("story_opened", 41, {}, 1000)
        local b = q:add("story_opened", 42, {}, 1000)
        local c = q:add("story_opened", 43, {}, 1000)
        local sent = q:nextBatch(500)
        local acc, dropped = q:applyAccepted(sent, { a.client_event_id, c.client_event_id }, 1100)
        eq(acc, 2); eq(dropped, 0)
        eq(q:count(), 1)
        eq(q:list()[1].client_event_id, b.client_event_id)
        eq(q:list()[1].rejections, 1)
        -- A refused event alone no longer triggers a sync.
        falsy(q:hasFresh())
    end)

    it("accepting an already-stored id twice is harmless (re-upload)", function()
        local q = newQueue()
        local a = q:add("list_shown", nil, { date = "2026-11-13", version = 1 }, 1000)
        q:applyAccepted({ a }, { a.client_event_id, a.client_event_id }, 1001)
        eq(q:count(), 0)
    end)

    it("keeps events added during an upload", function()
        local q = newQueue()
        local a = q:add("story_opened", 41, {}, 1000)
        local sent = q:nextBatch(500)
        q:add("story_opened", 42, {}, 1001)
        q:applyAccepted(sent, { a.client_event_id }, 1002)
        eq(q:count(), 1)
        eq(q:list()[1].rejections, 0)
    end)

    it("drops refused events after 7 days", function()
        local q = newQueue()
        local a = q:add("story_closed", 999, {}, 1000)
        q:applyAccepted({ a }, {}, 1000 + 6 * DAY)
        eq(q:count(), 1)
        q:applyAccepted({ a }, {}, 1000 + 7 * DAY + 1)
        eq(q:count(), 0)
    end)

    it("drops refused events after many refusals even if the clock went backwards", function()
        local q = newQueue()
        local a = q:add("story_closed", 999, {}, 100000)
        for _ = 1, 99 do q:applyAccepted({ a }, {}, 50) end
        eq(q:count(), 1)
        q:applyAccepted({ a }, {}, 50)
        eq(q:count(), 0)
    end)

    it("batches at most 500 per request", function()
        local q = newQueue()
        for i = 1, 1201 do q:add("story_opened", i, {}, 1000) end
        local sent = {}
        local b1 = q:nextBatch(500, sent)
        eq(#b1, 500)
        for _, e in ipairs(b1) do sent[e.client_event_id] = true end
        local b2 = q:nextBatch(500, sent)
        eq(#b2, 500)
        eq(b2[1].story_id, 501)
    end)

    it("wire form: null story_id and {} payload", function()
        local q = newQueue()
        local ev = q:add("story_opened", nil, {}, 1000)
        local wire = Queue.toWire(ev, JSON)
        local s = JSON.encode({ device_id = "d", events = JSON.array({ wire }) })
        truthy(s:find('"story_id":null', 1, true), s)
        truthy(s:find('"payload":{}', 1, true), s)
        falsy(s:find("queued_at", 1, true), "local bookkeeping must not be sent")
        falsy(s:find("rejections", 1, true), "local bookkeeping must not be sent")
    end)

    it("real UUIDs are v4 and distinct", function()
        local seen = {}
        for _ = 1, 200 do
            local id = UUID.v4()
            truthy(UUID.isValid(id), id)
            falsy(seen[id]); seen[id] = true
        end
        -- Fallback path without /dev/urandom.
        truthy(UUID.isValid(UUID.v4(function() return nil end)))
    end)
end)
