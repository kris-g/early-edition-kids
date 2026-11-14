-- Early Edition Kids plugin test runner. Run with LuaJIT (KOReader's own interpreter):
--   luajit spec/run.lua        (from plugin/), or ./spec/run.sh
--
-- 1. Compiles every .lua file in the plugin and spec folders (syntax check,
--    no execution), so UI modules that need KOReader at runtime are checked.
-- 2. Runs every spec/*_spec.lua against the pure modules and stubbed KOReader.

local function dirOf(path) return path:match("^(.*)/[^/]*$") or "." end
local SPEC = dirOf(arg and arg[0] or "spec/run.lua")
local PLUGIN = SPEC .. "/../earlyeditionkids.koplugin"

package.path = PLUGIN .. "/?.lua;" .. SPEC .. "/?.lua;" .. package.path

local function listLua(dir, pattern)
    local out = {}
    local p = io.popen('find "' .. dir .. '" -name "' .. pattern .. '" -type f | sort')
    for line in p:lines() do out[#out + 1] = line end
    p:close()
    return out
end

print("Interpreter: " .. (jit and jit.version or _VERSION))

local errors = {}
local files = listLua(PLUGIN, "*.lua")
for _, f in ipairs(listLua(SPEC, "*.lua")) do files[#files + 1] = f end
for _, f in ipairs(files) do
    local fn, err = loadfile(f)
    if not fn then errors[#errors + 1] = err end
end
print(string.format("Syntax check: %d/%d files compile", #files - #errors, #files))
for _, e in ipairs(errors) do print("  SYNTAX ERROR: " .. e) end

local specs = listLua(SPEC, "*_spec.lua")
for _, spec in ipairs(specs) do
    local ok, err = pcall(dofile, spec)
    if not ok then
        errors[#errors + 1] = err
        print("  ERROR loading " .. spec .. ": " .. tostring(err))
    end
end

local results = require("helpers").results
for _, f in ipairs(results.failures) do print("FAIL: " .. f) end
print(string.format("Specs: %d passed, %d failed (%d files)", results.passed, results.failed, #specs))
os.exit((results.failed == 0 and #errors == 0) and 0 or 1)
