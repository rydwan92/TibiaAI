-- World start: new worldSessionId, bridge probe, Ardan spawn and engine verification of waypoints.
TibiaAI = TibiaAI or {}
local T = TibiaAI

-- Engine-side check of an allowlisted waypoint: tile exists, has ground, no solid blocker, and the
-- engine pathfinder finds a path from Ardan's current position.
function T.verifyWaypoints(npc)
	local cfg = T.ardanConfig
	local results = {}
	local ids = {}
	for id in pairs(cfg.waypoints) do
		ids[#ids + 1] = id
	end
	table.sort(ids)
	for _, id in ipairs(ids) do
		local wp = cfg.waypoints[id]
		local pos = Position(wp.x, wp.y, wp.z)
		local tile = Tile(pos)
		local r = { waypoint = id, x = wp.x, y = wp.y, z = wp.z }
		r.tile = tile ~= nil
		r.ground = tile ~= nil and tile:getGround() ~= nil
		r.blockSolid = tile ~= nil and tile:hasFlag(TILESTATE_BLOCKSOLID) or false
		r.protectionZone = tile ~= nil and tile:hasFlag(TILESTATE_PROTECTIONZONE) or false
		if T.samePos(npc:getPosition(), wp) then
			r.pathSteps = 0
		else
			local dirs = npc:getPathTo(pos, 0, 0, true, true, cfg.pathSearchDistance)
			r.pathSteps = type(dirs) == "table" and #dirs or false
		end
		r.reachable = r.ground and not r.blockSolid and r.pathSteps ~= false
		results[#results + 1] = r
		T.journal("waypoint_check", r)
	end
	return results
end

-- ASCII map of walkability around a centre (engine view): '.' walkable, '#' solid, ' ' no tile.
function T.scanArea(center, radius)
	local rows = {}
	for y = center.y - radius, center.y + radius do
		local row = {}
		for x = center.x - radius, center.x + radius do
			local tile = Tile(Position(x, y, center.z))
			local ch = " "
			if tile and tile:getGround() then
				ch = tile:hasFlag(TILESTATE_BLOCKSOLID) and "#" or (tile:hasFlag(TILESTATE_FLOORCHANGE) and "^" or ".")
			end
			if x == center.x and y == center.y then
				ch = "@"
			end
			row[#row + 1] = ch
		end
		rows[#rows + 1] = string.format("%5d %s", y, table.concat(row))
	end
	return rows
end

local startup = GlobalEvent("TibiaAIStartup")
function startup.onStartup()
	math.randomseed(os.time())
	T.worldSessionId = T.randomHex(16)
	T.worldStartedAtMs = T.nowMs()
	T.journal("world_session_started", { worldSessionId = T.worldSessionId })
	T.bridgeInit()

	local cfg = T.ardanConfig
	local npc = Game.createNpc(cfg.npcName, Position(cfg.spawn.x, cfg.spawn.y, cfg.spawn.z))
	if not npc then
		T.journal("agent_spawn_failed", { agentKey = cfg.agentKey, spawn = cfg.spawn })
		return true
	end
	T.ardan.npcId = npc:getId()
	T.journal("agent_spawned", { agentKey = cfg.agentKey, creatureId = npc:getId(), position = T.posTable(npc:getPosition()) })
	T.verifyWaypoints(npc)
	for _, line in ipairs(T.scanArea(cfg.spawn, 12)) do
		logger.info("[TibiaAI] scan {}", line)
	end
	return true
end
startup:register()
