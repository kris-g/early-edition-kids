-- Optional. The server address is normally set on the Kindle, in
-- Tools → Early Edition settings → Server address, which takes precedence over
-- this file. To use a file instead, copy this to config.lua (in the same
-- folder), edit it and restart KOReader. Release zips never contain config.lua,
-- so updating the plugin never overwrites it, and git ignores it.
return {
    -- Where the Early Edition Kids server is on the home network. Plain HTTP is fine on
    -- the LAN. No trailing slash needed.
    server_url = "http://192.168.1.50:8080",

    -- Do not look for today's issue before this hour (Europe/London time).
    -- The server builds the issue at 05:30, so 5 or 6 is sensible.
    earliest_fetch_hour = 5,
}
