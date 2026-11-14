-- Early Edition Kids settings. Copy this file to config.lua (in the same folder),
-- edit it, then restart KOReader. config.lua is yours: updates to the plugin
-- never overwrite it, and git ignores it.
return {
    -- Where the Early Edition Kids server is on the home network. Plain HTTP is fine on
    -- the LAN. No trailing slash needed.
    server_url = "http://192.168.1.50:8080",

    -- Do not look for today's issue before this hour (Europe/London time).
    -- The server builds the issue at 05:30, so 5 or 6 is sensible.
    earliest_fetch_hour = 5,
}
