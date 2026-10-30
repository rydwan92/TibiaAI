-- Local administrator controls through runtime/control/<name>.request files, written by
-- scripts/*.ps1 on the same machine. The optional file content is a small argument string.
--   shutdown.request      graceful shutdown with world save        (scripts/stop.ps1)
--   alarm-start.request   [zoneId] training alarm start              (scripts/alarm.ps1 start)
--   alarm-clear.request   [zoneId] training alarm clear              (scripts/alarm.ps1 clear)
--   selftest.request      in-engine Lua self test                    (scripts/selftest.ps1)
--   scan.request          "x,y,z,radius" walkability scan to journal (scripts/scan.ps1)
local T = TibiaAI

local function takeRequest(name)
	local path = T.paths.control .. name
	local f = io.open(path, "rb")
	if not f then
		return nil
	end
	local content = (f:read(256) or ""):gsub("^%s+", ""):gsub("%s+$", "")
	f:close()
	os.remove(path)
	return content
end

local function defaultZone(arg)
	if arg and arg:match("^[%w_]+$") then
		return arg
	end
	return (T.defs.alarmZones or {})[1] or "default"
end

-- Other modules add their own requests with T.registerControl (e.g. arena.lua).
T.controlHandlers = T.controlHandlers or {}
function T.registerControl(name, fn)
	T.controlHandlers[name] = fn
end

local handlers = {
	["alarm-start.request"] = function(arg)
		local zone = defaultZone(arg)
		local reacted, reason = T.alarmStart(zone, "admin-console")
		T.journal("admin_alarm_request", { action = "start", zoneId = zone, agents = reacted, reason = reason })
	end,
	["alarm-clear.request"] = function(arg)
		local zone = defaultZone(arg)
		local reacted, reason = T.alarmClear(zone, "admin-console")
		T.journal("admin_alarm_request", { action = "clear", zoneId = zone, agents = reacted, reason = reason })
	end,
	["selftest.request"] = function()
		T.runSelftest()
	end,
	["scan.request"] = function(arg)
		local x, y, z, r = (arg or ""):match("^(%d+),(%d+),(%d+),?(%d*)$")
		if not x then
			return T.journal("area_scan", { error = "expected x,y,z[,radius]", arg = arg })
		end
		local center = { x = tonumber(x), y = tonumber(y), z = tonumber(z) }
		local radius = math.min(tonumber(r) or 12, 20)
		T.journal("area_scan", { center = center, radius = radius, legend = ". walk # solid ^ floorchange @ centre", rows = T.scanArea(center, radius) })
	end,
}
for name, fn in pairs(handlers) do
	T.registerControl(name, fn)
end

local function controlTick()
	if takeRequest("shutdown.request") then
		T.flushPerf(0)
		T.journal("shutdown_requested", { source = "control_file" })
		Game.setGameState(GAME_STATE_SHUTDOWN)
		return
	end
	for _, name in ipairs(T.sortedKeys(T.controlHandlers)) do
		local arg = takeRequest(name)
		if arg then
			local ok, err = pcall(T.controlHandlers[name], arg)
			if not ok then
				T.journal("control_error", { request = name, error = tostring(err) })
			end
		end
	end
end

local control = GlobalEvent("TibiaAIControl")
function control.onThink(interval)
	T.measure("control", controlTick)
	T.flushPerf(60)
	return true
end
control:interval(1000)
control:register()
