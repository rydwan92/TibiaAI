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
	T.propagateSpeech(agent, npc, text, yell)
	return true
end

-- Local hearing between agents (ADR 0005): other agents with `hearing` in range on the same floor
-- receive an agent_heard event. Nothing here ever makes the listener speak (no agent<->agent loops).
function T.propagateSpeech(speaker, npc, text, yell)
	local from = npc:getPosition()
	for _, key in ipairs(T.sortedKeys(T.agents)) do
		local listener = T.agents[key]
		local hearing = key ~= speaker.key and T.agentDef(listener).hearing or nil
		local listenerNpc = hearing and T.agentNpc(listener) or nil
		if listenerNpc then
			local d = T.distance(from, listenerNpc:getPosition())
			local limit = yell and (hearing.yellRange or hearing.range) or hearing.range
			if d <= limit then
				T.bridgeEmit(key, "agent_heard", { speakerKey = speaker.key, text = text, yelled = yell and true or false, distance = d })
			end
		end
	end
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
	agent.pendingReplies = {}
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

-- Speech reaches an NPC through Canary only when the player is in hearing range. A message goes to
-- one NPC: the one it names, else the one the player is talking to, else (for a greeting) the
-- closest. Everything else within hearing is overheard and never answered.
function T.namesNpc(def, message)
	-- Polish vocative: Ardan -> Ardanie, Mira -> Miro.
	local stem = def.npcName:lower():gsub("[aeiouy]$", "")
	return (" " .. message:lower() .. " "):find("%A" .. stem .. "%a?%a?%a?%A") ~= nil
end

local function namesOtherNpc(agent, message)
	for _, other in pairs(T.agents) do
		if other ~= agent and T.namesNpc(T.agentDef(other), message) then
			return true
		end
	end
	return false
end

local function isClosestAgent(agent, npc, player)
	local here = player:getPosition()
	local mine = T.distance(here, npc:getPosition())
	for _, key in ipairs(T.sortedKeys(T.agents)) do
		local other = T.agents[key]
		local otherNpc = other ~= agent and T.agentNpc(other) or nil
		if otherNpc then
			local d = T.distance(here, otherNpc:getPosition())
			if d < mine or (d == mine and key < agent.key) then
				return false
			end
		end
	end
	return true
end

local function inConversation(agent, guid)
	local last = agent.talkers[guid]
	return last ~= nil and os.time() - last <= T.timing.conversationTimeoutSeconds
end

function T.onNpcSay(npc, creature, msgType, message)
	local agent = T.agentByNpcId(npc:getId())
	if not agent or not creature or not creature:isPlayer() then
		return
	end
	local def = T.agentDef(agent)
	local player = Player(creature:getId())
	if not player then
		return
	end
	local distance = T.distance(player:getPosition(), npc:getPosition())
	local hearing = def.hearing and def.hearing.range or def.greeting.range
	if distance > hearing then
		return
	end
	local guid = player:getGuid()
	local now = os.time()
	if agent.lastSpeech[guid] and now - agent.lastSpeech[guid] < T.timing.speechCooldownSeconds then
		return
	end
	agent.lastSpeech[guid] = now

	local greeting = isGreeting(def, message)
	local addressed = distance <= def.greeting.range and not namesOtherNpc(agent, message)
		and (T.namesNpc(def, message) or inConversation(agent, guid) or (greeting and isClosestAgent(agent, npc, player)))
	local fields = { playerGuid = guid, playerName = player:getName(), text = message:sub(1, 300), worldMinutes = T.worldMinutes() }
	if not addressed then
		fields.addressed, fields.distance = false, distance
		T.bridgeEmit(agent.key, "player_said", fields)
		return
	end

	agent.talkers[guid] = now
	npc:turnToCreature(player)
	if not agent.alarmZone then
		agent.talkUntilTick = agent.tick + T.timing.talkPauseTicks
	end
	local eventId
	if greeting then
		eventId = T.bridgeEmit(agent.key, "player_greeted", fields)
	else
		fields.addressed, fields.distance = true, distance
		eventId = T.bridgeEmit(agent.key, "player_said", fields)
	end
	if agent.alarmZone then
		T.agentSay(agent, npc, T.agentText(agent, "greetDuringAlarm", { name = player:getName() }), false, "rules")
	elseif eventId and T.bridgeIsBrainOnline() then
		agent.pendingReplies[#agent.pendingReplies + 1] = { correlationId = eventId, playerId = player:getId(), greeting = greeting, deadlineTick = agent.tick + T.timing.brainReplyTicks }
		if not agent.alarmZone then
			agent.talkUntilTick = math.max(agent.talkUntilTick, agent.tick + T.timing.brainReplyTicks)
		end
	elseif greeting then
		localGreeting(agent, npc, player)
	end
end

local function takePendingReply(agent, correlationId)
	for i, p in ipairs(agent.pendingReplies) do
		if p.correlationId == correlationId then
			table.remove(agent.pendingReplies, i)
			return p
		end
	end
	return nil
end

function T.playerByGuid(guid)
	for _, player in ipairs(Game.getPlayers()) do
		if player:getGuid() == guid then
			return player
		end
	end
	return nil
end

-- Main tick ----------------------------------------------------------------------------------------
function T.agentOnTick(agent, npc)
	local def = T.agentDef(agent)
	agent.tick = agent.tick + 1

	-- A late Brain reply must not follow the local one (superseded_by_fallback).
	for i = #agent.pendingReplies, 1, -1 do
		local p = agent.pendingReplies[i]
		if agent.tick >= p.deadlineTick then
			table.remove(agent.pendingReplies, i)
			agent.fallbackUsed[p.correlationId] = true
			agent.fallbackCount = agent.fallbackCount + 1
			if agent.fallbackCount > 100 then
				agent.fallbackUsed, agent.fallbackCount = { [p.correlationId] = true }, 1
			end
			local player = Player(p.playerId)
			if player then
				T.journal("brain_reply_timeout", { agentKey = agent.key, correlationId = p.correlationId })
				if p.greeting then
					localGreeting(agent, npc, player)
				else
					T.agentSay(agent, npc, T.agentText(agent, "busyReply", { name = player:getName() }), false, "rules_fallback")
				end
			end
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
		-- The reply is for one player: never deliver it after they left hearing range.
		if args.toPlayerGuid then
			local target = T.playerByGuid(tonumber(args.toPlayerGuid))
			local range = T.agentDef(agent).hearing and T.agentDef(agent).hearing.range or T.agentDef(agent).greeting.range
			if not target or T.distance(target:getPosition(), npc:getPosition()) > range then
				takePendingReply(agent, cmd.correlationId)
				return report("rejected", "addressee_gone")
			end
		end
		local isReply = takePendingReply(agent, cmd.correlationId) ~= nil
		if not isReply and os.time() - agent.lastSayTime < T.timing.sayCooldownSeconds then
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

local function tickAllAgents()
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
end

local tick = GlobalEvent("TibiaAIAgentTick")
function tick.onThink(interval)
	T.measure("agent_tick", tickAllAgents)
	return true
end
tick:interval(1000)
tick:register()
