--[[--
The event queue (DESIGN 5.3, CONTRACT "POST /api/events").

Events are queued in the store and uploaded at the next sync. The server
answers with every `client_event_id` it now holds (including ones stored by
an earlier upload), and the client deletes exactly those. Events the server
did not accept (unknown story or type) stay for at most 7 days and are then
dropped.

Each queued event:

    { client_event_id = "uuid", story_id = 41 or nil, type = "story_closed",
      ts = <device epoch>, payload = {...},
      queued_at = <device epoch>, rejections = 0 }

`queued_at` and `rejections` are local bookkeeping and are not sent.
]]

local Const = require("earlyeditionkids/const")

local Queue = {}
Queue.__index = Queue

Queue.TYPES = {
    issue_downloaded = true,
    list_shown = true,
    story_opened = true,
    story_closed = true,
}

function Queue.new(store, make_id)
    return setmetatable({ store = store, make_id = make_id }, Queue)
end

function Queue:list()
    return self.store:get("queue", {})
end

function Queue:count()
    return #self:list()
end

--- Adds an event and returns it. Does not save the store.
function Queue:add(ev_type, story_id, payload, now)
    assert(Queue.TYPES[ev_type], "unknown event type " .. tostring(ev_type))
    local list = self:list()
    local ev = {
        client_event_id = self.make_id(),
        story_id = story_id,
        type = ev_type,
        ts = now,
        payload = payload or {},
        queued_at = now,
        rejections = 0,
    }
    table.insert(list, ev)
    -- Hard cap: drop the oldest if something has gone badly wrong.
    while #list > Const.QUEUE_MAX do
        table.remove(list, 1)
    end
    return ev
end

--- True when at least one event has never been offered to the server.
-- Events the server already refused once do not, on their own, trigger a
-- sync (CONTRACT rule 2); they ride along with the next sync instead.
function Queue:hasFresh()
    for _, ev in ipairs(self:list()) do
        if (ev.rejections or 0) == 0 then return true end
    end
    return false
end

--- The next batch to send, skipping ids in `exclude` (already sent this run).
function Queue:nextBatch(max, exclude)
    local batch = {}
    for _, ev in ipairs(self:list()) do
        if #batch >= max then break end
        if not (exclude and exclude[ev.client_event_id]) then
            table.insert(batch, ev)
        end
    end
    return batch
end

--- Wire form for one event. `json` supplies `null` and `object`.
function Queue.toWire(ev, json)
    local payload = {}
    for k, v in pairs(ev.payload or {}) do payload[k] = v end
    return {
        client_event_id = ev.client_event_id,
        story_id = ev.story_id == nil and json.null or ev.story_id,
        type = ev.type,
        ts = ev.ts,
        payload = json.object(payload),
    }
end

local function expired(ev, now)
    if (ev.rejections or 0) >= Const.EVENT_MAX_REJECTIONS then
        return true
    end
    local queued = ev.queued_at or ev.ts or now
    return (now - queued) > Const.EVENT_MAX_AGE
end

--- Applies a server reply for the events in `sent`.
-- Returns accepted_count, dropped_count.
function Queue:applyAccepted(sent, accepted_ids, now)
    local accepted = {}
    for _, id in ipairs(accepted_ids or {}) do accepted[id] = true end
    local was_sent = {}
    for _, ev in ipairs(sent) do was_sent[ev.client_event_id] = true end

    local kept, n_acc, n_drop = {}, 0, 0
    for _, ev in ipairs(self:list()) do
        local id = ev.client_event_id
        if accepted[id] then
            n_acc = n_acc + 1
        elseif was_sent[id] then
            ev.rejections = (ev.rejections or 0) + 1
            ev.last_rejected_at = now
            if expired(ev, now) then
                n_drop = n_drop + 1
            else
                table.insert(kept, ev)
            end
        else
            table.insert(kept, ev)
        end
    end
    self.store:set("queue", kept)
    return n_acc, n_drop
end

return Queue
