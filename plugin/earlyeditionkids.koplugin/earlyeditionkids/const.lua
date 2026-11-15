--[[--
Names and fixed numbers shared by the Early Edition Kids modules.

NAME is the plugin name shown in menus; _meta.lua has the same name for
KOReader's plugin list.
]]

local Const = {
    NAME = "Early Edition Kids",
    -- Stamped by plugin/package.sh when a release is built; "dev" in a git checkout.
    VERSION = "dev",
    -- Fallback screen title until an issue arrives (the server sends its own `title`).
    DEFAULT_TITLE = "Early Edition",

    SETTINGS_FILE = "earlyeditionkids.lua", -- state: device id, sync state, queue, issue state, session
    LOG_FILE = "earlyeditionkids_log.lua",  -- reading log (kept for a year, never tidied)
    DATA_SUBDIR = "earlyeditionkids",       -- <data dir>/earlyeditionkids/<date>/

    KEEP_ISSUE_DAYS = 7,                    -- DESIGN 5.1 step 10
    LOG_KEEP_DAYS = 366,                    -- DESIGN 5.1 step 8: "keep a year of it"

    UPLOAD_DELAY = 60,                      -- send reading this long after a story closes
    BACKOFF_NOT_READY = 30 * 60,            -- after a 404 (DESIGN 5.1 step 2)
    BACKOFF_NETWORK = 2 * 60,               -- after a network failure
    RECHECK_INTERVAL = 30 * 60,             -- CONTRACT sync rule 3

    EVENT_MAX_AGE = 7 * 24 * 3600,          -- CONTRACT: rejected events kept at most 7 days
    EVENT_MAX_REJECTIONS = 100,             -- safety net if the device clock runs backwards
    EVENT_BATCH = 500,                      -- CONTRACT: max 500 events per request
    QUEUE_MAX = 5000,                       -- hard cap so a broken server cannot fill the disk

    MAX_PAGE_SECONDS = 300,                 -- idle cap per page for active_seconds

    HTTP_BLOCK_TIMEOUT = 10,
    HTTP_TOTAL_TIMEOUT = 30,
}

return Const
