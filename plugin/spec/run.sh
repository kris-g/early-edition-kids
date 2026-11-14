#!/bin/sh
# Runs the plugin's Lua tests under LuaJIT, the interpreter KOReader uses.
# Install it once with: brew install luajit
cd "$(dirname "$0")/.." || exit 1
if ! command -v luajit >/dev/null 2>&1; then
    echo "luajit not found; install it with: brew install luajit" >&2
    exit 1
fi
exec luajit spec/run.lua "$@"
