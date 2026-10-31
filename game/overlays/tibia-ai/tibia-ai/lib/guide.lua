-- Guide behavior (skill "guide" in agents.json): walks one player to an allowlisted place. Reusable
-- by any agent through configuration; no agent name appears here. Brain only asks to start: the
-- engine owns the walk, checks the player every tick and alone declares the outcome.
-- Outcomes: arrived, left_behind, player_gone, cancelled, blocked, alarm, stopped, timeout.
-- Priority over the routine: stop > alarm > GUIDE > talk > routine.
local T = TibiaAI

local function skill()
	return (T.defs.skills and T.defs.skills.guide) or {}
end

local function param(name, default)
	return (skill().params or {})[name] or default
end

function T.agentHasSkill(def, name)
	for _, s in ipairs(def.skills or {}) do
		if s == name then
			return true
		end
	end
	return false
end

function T.guidePlace(def, placeId)
	for _, id in ipairs(def.guidePlaces or {}) do
		if id == placeId then
			local place = T.defs.places and T.defs.places[placeId]
			return place and place.position and place or nil
		end
	end
	return nil
end

local function vars(agent, name)
	local place = T.defs.places and T.defs.places[agent.guide and agent.guide.placeId or ""]
	return { name = name, place = place and place.label or "" }
end

local OUTCOME_TEXT = {
	arrived = "guideArrived",
	left_behind = "guideLeftBehind",
	cancelled = "guideCancelled",
	blocked = "guideBlocked",
	alarm = "guideAlarm",
	timeout = "guideTimeout",
}

-- Ends the walk exactly once and reports what really happened. player_gone stays silent: nobody
-- is there to hear it. Every outcome except alarm and stop sends the agent back to its routine.
function T.guideEnd(agent, npc, outcome)
	local g = agent.guide
	if not g then
		return
	end
	local textKey = OUTCOME_TEXT[outcome]
	local text = textKey and T.agentText(agent, textKey, vars(agent, g.playerName))
	agent.guide = nil
	agent.mover = nil
	local position = T.posTable(npc:getPosition())
	T.journal("guide_ended", { agentKey = agent.key, playerGuid = g.playerGuid, placeId = g.placeId, outcome = outcome, ticks = g.ticks, position = position })
	T.bridgeEmit(agent.key, "guide_ended", { playerGuid = g.playerGuid, playerName = g.playerName, placeId = g.placeId, outcome = outcome, x = position.x, y = position.y, z = position.z })
	T.agentSay(agent, npc, text, false, "rules")
	if outcome ~= "alarm" and outcome ~= "stopped" then
		agent.waitUntilTick = agent.tick + param("holdTicks", 8)
		T.setAgentState(agent, "RETURN", "guide_" .. outcome)
	end
end

-- Returns true, or false and a reason. The agent says the reply only after every engine check, so
-- a promise to walk is never spoken for a walk that will not start.
function T.guideStart(agent, npc, playerGuid, placeId, text, commandId)
	local def = T.agentDef(agent)
	local place = T.guidePlace(def, placeId)
	if not T.agentHasSkill(def, "guide") or not place then
		return false, "guide_not_allowed"
	end
	local player = T.playerByGuid(playerGuid)
	local range = def.hearing and def.hearing.range or def.greeting.range
	if not player or T.distance(player:getPosition(), npc:getPosition()) > range then
		return false, "addressee_gone"
	end
	local name = player:getName()
	local label = { name = name, place = place.label }
	if agent.alarmZone then
		return false, "alarm_active"
	end
	if agent.state == "STOPPED" then
		return false, "agent_stopped"
	end
	if agent.guide then
		T.agentSay(agent, npc, T.agentText(agent, "guideBusy", label), false, "rules")
		return false, agent.guide.playerGuid == playerGuid and "guide_already_active" or "guide_busy"
	end
	-- getPathTo can fail for a moment on a reachable place (seen right after a walk), so only a place
	-- the engine could not reach at spawn is refused at once; a passing failure is the mover's job.
	local to = place.position
	if agent.unreachablePlaces[placeId] then
		T.agentSay(agent, npc, T.agentText(agent, "guideNoPath", label), false, "rules")
		T.journal("guide_refused", { agentKey = agent.key, playerGuid = playerGuid, placeId = placeId, reason = "no_path" })
		return false, "no_path"
	end
	agent.guide = { playerGuid = playerGuid, playerName = name, placeId = placeId, ticks = 0, waiting = false, waitStartTick = 0, commandId = commandId }
	agent.talkUntilTick = 0
	agent.waitUntilTick = 0
	T.setAgentState(agent, "GUIDE", "guide_started")
	T.startMoveTo(agent, to, placeId, function(n, ok)
		-- The mover reports "arrived" only when the position equals the target.
		T.guideEnd(agent, n, ok and "arrived" or "blocked")
	end, { commandId = commandId })
	T.journal("guide_started", { agentKey = agent.key, playerGuid = playerGuid, placeId = placeId, commandId = commandId })
	T.agentSay(agent, npc, text ~= "" and text or T.agentText(agent, "guideStart", label), false, "brain", { commandId = commandId })
	return true
end

function T.guideTick(agent, npc)
	local g = agent.guide
	if not g then
		return T.setAgentState(agent, "RETURN", "guide_lost")
	end
	g.ticks = g.ticks + 1
	local player = T.playerByGuid(g.playerGuid)
	if not player then
		return T.guideEnd(agent, npc, "player_gone")
	end
	if g.ticks > param("maxTicks", 240) then
		return T.guideEnd(agent, npc, "timeout")
	end
	local distance = T.distance(player:getPosition(), npc:getPosition())
	if g.waiting then
		if distance <= param("resumeDistance", 3) then
			g.waiting = false
			agent.mover.lastProgressTick = agent.tick
			T.journal("guide_resumed", { agentKey = agent.key, playerGuid = g.playerGuid, waitedTicks = agent.tick - g.waitStartTick })
			T.agentSay(agent, npc, T.agentText(agent, "guideResume", vars(agent, g.playerName)), false, "rules")
		elseif agent.tick - g.waitStartTick >= param("leftBehindTicks", 25) then
			T.guideEnd(agent, npc, "left_behind")
		end
		return
	end
	if distance > param("waitDistance", 4) then
		g.waiting = true
		g.waitStartTick = agent.tick
		T.journal("guide_waiting", { agentKey = agent.key, playerGuid = g.playerGuid, distance = distance < math.huge and distance or -1 })
		T.agentSay(agent, npc, T.agentText(agent, "guideWait", vars(agent, g.playerName)), false, "rules")
		return
	end
	if agent.mover then
		T.stepMove(agent, npc)
	end
end

function T.guideIsCancel(message)
	local text = " " .. message:lower():gsub("[%p]", " "):gsub("%s+", " ") .. " "
	for _, word in ipairs(skill().cancelWords or {}) do
		if text:find(" " .. word .. " ", 1, true) then
			return true
		end
	end
	return false
end

-- Engine-side check of every place an agent may guide to, like waypoint_check.
function T.verifyGuidePlaces(agent, npc)
	local def = T.agentDef(agent)
	for _, id in ipairs(def.guidePlaces or {}) do
		local place = T.defs.places and T.defs.places[id]
		if place and place.position then
			local to = place.position
			local dirs = npc:getPathTo(Position(to.x, to.y, to.z), 0, 0, true, true, T.timing.pathSearchDistance)
			local reachable = type(dirs) == "table" and #dirs > 0
			agent.unreachablePlaces[id] = not reachable or nil
			T.journal("place_check", { agentKey = agent.key, placeId = id, x = to.x, y = to.y, z = to.z, pathSteps = reachable and #dirs or false })
		else
			T.journal("place_check", { agentKey = agent.key, placeId = id, error = "unknown_place" })
		end
	end
end
