-- Movement executor: one step per tick towards an allowlisted waypoint.
-- Npc:move(direction) keeps engine collision checks (Creature:move would use FLAG_NOLIMIT).
-- No path or no progress for timing.moveTimeoutTicks => failure. Never teleports.
local T = TibiaAI

-- meta (optional) is copied into the move_completed / move_failed journal entry (e.g. commandId).
function T.startMove(agent, waypointId, onDone, meta)
	T.startMoveTo(agent, T.agentDef(agent).waypoints[waypointId], waypointId, onDone, meta)
end

function T.startMoveTo(agent, target, label, onDone, meta)
	agent.mover = { target = target, label = label, lastProgressTick = agent.tick, onDone = onDone, meta = meta }
end

local function finishMove(agent, npc, ok, reason)
	local m = agent.mover
	agent.mover = nil
	local entry = { agentKey = agent.key, target = m.label, reason = reason, position = T.posTable(npc:getPosition()) }
	for k, v in pairs(m.meta or {}) do
		entry[k] = v
	end
	T.journal(ok and "move_completed" or "move_failed", entry)
	if m.onDone then
		m.onDone(npc, ok, reason)
	end
end

function T.stepMove(agent, npc)
	local m = agent.mover
	local pos = npc:getPosition()
	if T.samePos(pos, m.target) then
		return finishMove(agent, npc, true, "arrived")
	end
	local dirs = npc:getPathTo(Position(m.target.x, m.target.y, m.target.z), 0, 0, true, true, T.timing.pathSearchDistance)
	if type(dirs) == "table" and #dirs > 0 then
		-- Canary stores paths reversed (Creature::getNextStep consumes listWalkDir.back()),
		-- so the first step is the last element.
		npc:move(dirs[#dirs])
		local after = npc:getPosition()
		if not T.samePos(after, pos) then
			m.lastProgressTick = agent.tick
			if T.samePos(after, m.target) then
				finishMove(agent, npc, true, "arrived")
			end
			return
		end
	end
	if agent.tick - m.lastProgressTick >= T.timing.moveTimeoutTicks then
		finishMove(agent, npc, false, type(dirs) == "table" and "blocked_timeout" or "no_path")
	end
end

-- Engine-side check of every waypoint of an agent: tile, ground, no solid blocker, and a path
-- found by the engine pathfinder from the NPC's current position.
function T.verifyWaypoints(agent, npc)
	local def = T.agentDef(agent)
	local results = {}
	for _, id in ipairs(T.sortedKeys(def.waypoints)) do
		local wp = def.waypoints[id]
		local pos = Position(wp.x, wp.y, wp.z)
		local tile = Tile(pos)
		local r = { agentKey = agent.key, waypoint = id, x = wp.x, y = wp.y, z = wp.z }
		r.ground = tile ~= nil and tile:getGround() ~= nil
		r.blockSolid = tile ~= nil and tile:hasFlag(TILESTATE_BLOCKSOLID) or false
		r.protectionZone = tile ~= nil and tile:hasFlag(TILESTATE_PROTECTIONZONE) or false
		if T.samePos(npc:getPosition(), wp) then
			r.pathSteps = 0
		else
			local dirs = npc:getPathTo(pos, 0, 0, true, true, T.timing.pathSearchDistance)
			r.pathSteps = type(dirs) == "table" and #dirs or false
		end
		r.reachable = r.ground and not r.blockSolid and r.pathSteps ~= false
		results[#results + 1] = r
		T.journal("waypoint_check", r)
	end
	return results
end

-- ASCII walkability map around a centre: '.' walkable, '#' solid, '^' floor change, ' ' no tile.
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
