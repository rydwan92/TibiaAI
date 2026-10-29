-- Generic agent controller: deterministic state machine driven by agent definitions.
-- States: IDLE -> PATROL | HOME (by behavior) ; ALERT -> RETURN on alarms ; COMMAND_MOVE, STOPPED.
-- TALK is a short pause (talkUntilTick). Priority: stop > alarm > talk > routine.
-- Ticks come from a GlobalEvent (NPC onThink only runs while a player sees the NPC,
-- Npc::manageIdle in Canary v3.6.1).
local T = TibiaAI

local function setState(agent, newState, reason)
	if agent.state ~= newState then
		T.journal("state_changed", { agentKey = agent.key, from = agent.state, to = newState, reason = reason })
		agent.state = newState
	end
end
T.setAgentState = setState

-- Local speech only (TALKTYPE_SAY / YELL), heard by players in hearing range. Empty text is skipped.
-- meta (optional) is copied into the journal entry, e.g. { commandId, correlationId } for Brain speech.
function T.agentSay(agent, npc, text, yell, source, meta)
	if not text or text == "" then
		return false
	end
	text = tostring(text):gsub("%c", " "):sub(1, 200)
	npc:say(text, yell and TALKTYPE_YELL or TALKTYPE_SAY)
	agent.lastSayTime = os.time()
	local entry = { agentKey = agent.key, text = text, source = source or "rules" }
	for k, v in pairs(meta or {}) do
		entry[k] = v
	end
	T.journal("npc_said", entry)
	return true
end

-- Routine behaviors ------------------------------------------------------------------------------
local routines = {}

routines.patrol = {
	start = function(agent, def)
		agent.routeId = agent.routeId or def.behavior.defaultRoute
		setState(agent, "PATROL", "startup")
	end,
	next = function(agent, def)
		local route = def.routes[agent.routeId] or {}
		if #route == 0 then
			return
		end
		if agent.routeIndex > #route then
			agent.routeIndex = 1
		end
		T.startMove(agent, route[agent.routeIndex], function(_, ok)
			agent.waitUntilTick = agent.tick + (ok and T.timing.waypointPauseTicks or T.timing.retryAfterTicks)
			agent.routeIndex = (agent.routeIndex % #route) + 1
		end)
	end,
	resumeTarget = function(agent, def)
		local route = def.routes[agent.routeId] or {}
		return route[agent.resumeIndex] or route[1]
	end,
	onResumed = function(agent, def)
		local route = def.routes[agent.routeId] or {}
		agent.routeIndex = (agent.resumeIndex % math.max(#route, 1)) + 1
		setState(agent, "PATROL", "returned_to_route")
	end,
	activeState = "PATROL",
}

routines.stationary = {
	start = function(agent)
		setState(agent, "HOME", "startup")
	end,
	next = function(agent, def, npc)
		local home = def.waypoints[def.behavior.home]
		if not T.samePos(npc:getPosition(), home) then
			T.startMove(agent, def.behavior.home, function(_, ok)
				if not ok then
					agent.waitUntilTick = agent.tick + T.timing.retryAfterTicks
				end
			end)
		end
	end,
	resumeTarget = function(_, def)
		return def.behavior.home
	end,
	onResumed = function(agent)
		setState(agent, "HOME", "returned_home")
	end,
	activeState = "HOME",
}

local function routine(def)
	return routines[def.behavior.type]
end

function T.agentStartRoutine(agent, reason)
	local def = T.agentDef(agent)
	agent.mover = nil
	setState(agent, routine(def).activeState, reason)
end

function T.agentStartPatrol(agent, routeId, reason)
	local def = T.agentDef(agent)
	if def.behavior.type ~= "patrol" then
		return false, "not_a_patrol_agent"
	end
	if not def.routes[routeId] then
		return false, "unknown_route"
	end
	agent.routeId = routeId
	agent.mover = nil
	setState(agent, "PATROL", reason)
	return true
end

-- Training alarm (administrator test event, not real threat detection) ---------------------------
local function reactsTo(def, zoneId)
	if not def.alarm then
		return false
	end
	for _, z in ipairs(def.alarm.zones) do
		if z == zoneId then
			return true
		end
	end
	return false
end

local function agentAlarmStart(agent, npc, zoneId, byName)
	local def = T.agentDef(agent)
	agent.alarmZone = zoneId
	agent.resumeIndex = agent.routeIndex
	agent.mover = nil
	agent.pendingGreeting = nil
	setState(agent, "ALERT", "training_alarm_started")
	T.bridgeEmit(agent.key, "training_alarm_started", { zoneId = zoneId, triggeredBy = byName })
	T.agentSay(agent, npc, T.agentText(agent, "alarmStart"), def.alarm.yell, "rules")
	agent.lastWarnTick = agent.tick
	T.startMove(agent, def.alarm.moveTo, function(n, ok)
		agent.lastWarnTick = agent.tick
		T.agentSay(agent, n, T.agentText(agent, ok and "alarmArrive" or "alarmBlocked"), false, "rules")
	end)
end

local function agentAlarmClear(agent, npc, zoneId, byName)
	agent.alarmZone = nil
	agent.mover = nil
	setState(agent, "RETURN", "training_alarm_cleared")
	T.bridgeEmit(agent.key, "training_alarm_cleared", { zoneId = zoneId, clearedBy = byName })
	T.agentSay(agent, npc, T.agentText(agent, "alarmClear"), false, "rules")
end

-- Returns the list of agent keys that reacted (empty list + reason when none did).
function T.alarmStart(zoneId, byName)
	local reacted = {}
	for _, key in ipairs(T.sortedKeys(T.agents)) do
		local agent = T.agents[key]
		local npc = T.agentNpc(agent)
		if npc and not agent.alarmZone and reactsTo(T.agentDef(agent), zoneId) then
			agentAlarmStart(agent, npc, zoneId, byName)
			reacted[#reacted + 1] = key
		end
	end
	return reacted, #reacted == 0 and "no_agent_reacted" or nil
end

function T.alarmClear(zoneId, byName)
	local reacted = {}
	for _, key in ipairs(T.sortedKeys(T.agents)) do
		local agent = T.agents[key]
		local npc = T.agentNpc(agent)
		if npc and agent.alarmZone == zoneId then
			agentAlarmClear(agent, npc, zoneId, byName)
			reacted[#reacted + 1] = key
		end
	end
	return reacted, #reacted == 0 and "not_active" or nil
end

-- Greeting -----------------------------------------------------------------------------------------
local function isGreeting(def, message)
	local msg = " " .. message:lower():gsub("[%p]", " "):gsub("%s+", " ") .. " "
	for _, word in ipairs(def.greeting.words) do
		if msg:find(" " .. word .. " ", 1, true) then
			return true
		end
	end
	return false
end

local function localGreeting(agent, npc, player)
	T.agentSay(agent, npc, T.agentText(agent, "greetFallback", { name = player:getName() }), false, "rules_fallback")
end

function T.onNpcSay(npc, creature, msgType, message)
	local agent = T.agentByNpcId(npc:getId())
	if not agent or not creature or not creature:isPlayer() then
		return
	end
	local def = T.agentDef(agent)
	if not isGreeting(def, message) then
		return
	end
	local player = Player(creature:getId())
	if not player or T.distance(player:getPosition(), npc:getPosition()) > def.greeting.range then
		return
	end
	local guid = player:getGuid()
	local now = os.time()
	local last = agent.greetCooldown[guid]
	if last and now - last < (def.greeting.cooldownSeconds or 8) then
		return
	end
	agent.greetCooldown[guid] = now
	npc:turnToCreature(player)
	if not agent.alarmZone then
		agent.talkUntilTick = agent.tick + T.timing.talkPauseTicks
	end

	local eventId = T.bridgeEmit(agent.key, "player_greeted", {
		playerGuid = guid,
		playerName = player:getName(),
		text = message:sub(1, 300),
	})
	if agent.alarmZone then
		T.agentSay(agent, npc, T.agentText(agent, "greetDuringAlarm", { name = player:getName() }), false, "rules")
	elseif eventId and T.bridgeIsBrainOnline() then
		agent.pendingGreeting = { correlationId = eventId, playerId = player:getId(), deadlineTick = agent.tick + T.timing.brainReplyTicks }
	else
		localGreeting(agent, npc, player)
	end
end

-- Main tick ----------------------------------------------------------------------------------------
function T.agentOnTick(agent, npc)
	local def = T.agentDef(agent)
	agent.tick = agent.tick + 1

	local p = agent.pendingGreeting
	if p and agent.tick >= p.deadlineTick then
		agent.pendingGreeting = nil
		agent.fallbackUsed[p.correlationId] = true
		agent.fallbackCount = agent.fallbackCount + 1
		if agent.fallbackCount > 100 then
			agent.fallbackUsed, agent.fallbackCount = { [p.correlationId] = true }, 1
		end
		local player = Player(p.playerId)
		if player then
			T.journal("brain_reply_timeout", { agentKey = agent.key, correlationId = p.correlationId })
			localGreeting(agent, npc, player)
		end
	end

	if agent.state == "IDLE" then
		routine(def).start(agent, def)
		return
	end
	if agent.state == "STOPPED" then
		return
	end

	if agent.state == "ALERT" then
		if agent.mover then
			T.stepMove(agent, npc)
		elseif (def.alarm.rewarnSeconds or 0) > 0 and agent.tick - agent.lastWarnTick >= def.alarm.rewarnSeconds then
			agent.lastWarnTick = agent.tick
			T.agentSay(agent, npc, T.agentText(agent, "alarmRewarn"), false, "rules")
		end
		return
	end

	if agent.tick < agent.talkUntilTick or agent.tick < agent.waitUntilTick then
		return
	end
	if agent.mover then
		T.stepMove(agent, npc)
		return
	end

	if agent.state == "RETURN" then
		local r = routine(def)
		T.startMove(agent, r.resumeTarget(agent, def), function(_, ok)
			if ok then
				r.onResumed(agent, def)
			else
				agent.waitUntilTick = agent.tick + T.timing.retryAfterTicks
			end
		end)
	elseif agent.state == routine(def).activeState then
		routine(def).next(agent, def, npc)
	end
	-- COMMAND_MOVE: hold position after move_to until a patrol command or alarm.
end

-- Commands from Brain (already validated by the bridge) -------------------------------------------
function T.agentExecute(agent, cmd, report)
	local npc = T.agentNpc(agent)
	if not npc then
		return report("rejected", "agent_missing")
	end
	local action, args = cmd.action, cmd.args
	if agent.alarmZone and (action == "patrol" or action == "move_to") then
		return report("rejected", "alarm_active")
	end
	if action == "say" then
		if agent.fallbackUsed[cmd.correlationId] then
			return report("rejected", "superseded_by_fallback")
		end
		local p = agent.pendingGreeting
		local isReply = p and p.correlationId == cmd.correlationId
		if isReply then
			agent.pendingGreeting = nil
		elseif os.time() - agent.lastSayTime < T.timing.sayCooldownSeconds then
			return report("rejected", "say_rate_limited")
		end
		T.agentSay(agent, npc, args.text, false, "brain", { commandId = cmd.commandId, correlationId = cmd.correlationId })
		return report("completed", "said")
	elseif action == "patrol" then
		local ok, reason = T.agentStartPatrol(agent, args.routeId, "command")
		return report(ok and "completed" or "rejected", ok and "patrol_started" or reason)
	elseif action == "move_to" then
		agent.mover = nil
		setState(agent, "COMMAND_MOVE", "command")
		report("accepted", "moving")
		T.startMove(agent, args.waypointId, function(n, ok, reason)
			report(ok and "completed" or "failed", reason, T.posTable(n:getPosition()))
		end, { commandId = cmd.commandId })
		return
	elseif action == "stop" then
		agent.mover = nil
		setState(agent, "STOPPED", "command")
		return report("completed", "stopped", T.posTable(npc:getPosition()))
	end
	return report("rejected", "unknown_action")
end

function T.agentStatus(agent)
	local npc = T.agentNpc(agent)
	return {
		state = agent.state,
		alarmActive = agent.alarmZone ~= nil,
		routeId = agent.routeId,
		routeIndex = agent.routeIndex,
		moving = agent.mover and agent.mover.label or nil,
		position = npc and T.posTable(npc:getPosition()) or nil,
		planRevision = agent.planRevision,
	}
end

local tick = GlobalEvent("TibiaAIAgentTick")
function tick.onThink(interval)
	for _, key in ipairs(T.sortedKeys(T.agents)) do
		local agent = T.agents[key]
		local npc = T.agentNpc(agent)
		if npc then
			local ok, err = pcall(T.agentOnTick, agent, npc)
			if not ok then
				T.journal("controller_error", { agentKey = key, error = tostring(err) })
			end
		end
	end
	return true
end
tick:interval(1000)
tick:register()
