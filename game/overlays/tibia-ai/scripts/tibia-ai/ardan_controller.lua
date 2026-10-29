-- Ardan controller: deterministic state machine driven by a 1000 ms GlobalEvent tick
-- (NPC onThink only runs while a player is in view, see Npc::manageIdle in Canary v3.6.1).
-- States: IDLE -> PATROL -> ALERT -> RETURN -> PATROL, plus TALK (short pause) and STOPPED.
-- Priority: invalid unit/stop > alarm > talk > patrol. Movement is one step per tick through
-- Npc:move(direction) (engine collision checks, no FLAG_NOLIMIT) along Creature:getPathTo.
-- No path or no progress for moveTimeoutTicks => failure; the controller never teleports.
TibiaAI = TibiaAI or {}
local T = TibiaAI

T.ardan = T.ardan or {
	npcId = nil,
	state = "IDLE",
	tick = 0,
	routeId = nil,
	routeIndex = 1,
	resumeIndex = 1,
	mover = nil, -- { target, label, lastProgressTick, onDone, commandId }
	waitUntilTick = 0,
	talkUntilTick = 0,
	alarmActive = false,
	lastWarnTick = 0,
	greetCooldown = {}, -- playerGuid -> os.time()
	pendingGreeting = nil, -- { correlationId, playerId, deadlineTick }
	fallbackUsed = {}, -- correlationId -> true when the local greeting already answered
	fallbackCount = 0,
	lastSayTime = 0,
	planRevision = 0,
}

local A = T.ardan

local function cfg()
	return T.ardanConfig
end

function T.getArdan()
	if not A.npcId then
		return nil
	end
	local npc = Npc(A.npcId)
	if not npc or npc:isRemoved() then
		return nil
	end
	return npc
end

local function setState(newState, reason)
	if A.state ~= newState then
		T.journal("state_changed", { agentKey = cfg().agentKey, from = A.state, to = newState, reason = reason })
		A.state = newState
	end
end

-- Speech --------------------------------------------------------------------------------------
-- Local speech only (TALKTYPE_SAY / YELL): heard by players in normal hearing range.
function T.ardanSay(npc, text, yell, source)
	text = tostring(text):gsub("%c", " "):sub(1, 200)
	npc:say(text, yell and TALKTYPE_YELL or TALKTYPE_SAY)
	A.lastSayTime = os.time()
	T.journal("npc_said", { agentKey = cfg().agentKey, text = text, source = source or "rules" })
end

-- Movement executor ----------------------------------------------------------------------------
local function startMove(target, label, onDone)
	A.mover = { target = target, label = label, lastProgressTick = A.tick, onDone = onDone }
end

local function finishMove(npc, ok, reason)
	local m = A.mover
	A.mover = nil
	T.journal(ok and "move_completed" or "move_failed", {
		agentKey = cfg().agentKey,
		target = m.label,
		reason = reason,
		position = T.posTable(npc:getPosition()),
	})
	if m.onDone then
		m.onDone(npc, ok, reason)
	end
end

local function stepMove(npc)
	local m = A.mover
	local pos = npc:getPosition()
	if T.samePos(pos, m.target) then
		finishMove(npc, true, "arrived")
		return
	end
	local dirs = npc:getPathTo(Position(m.target.x, m.target.y, m.target.z), 0, 0, true, true, cfg().pathSearchDistance)
	if type(dirs) == "table" and #dirs > 0 then
		-- Canary stores paths reversed (Creature::getNextStep consumes listWalkDir.back()),
		-- so the first step is the last element.
		npc:move(dirs[#dirs])
		local after = npc:getPosition()
		if not T.samePos(after, pos) then
			m.lastProgressTick = A.tick
			if T.samePos(after, m.target) then
				finishMove(npc, true, "arrived")
			end
			return
		end
	end
	if A.tick - m.lastProgressTick >= cfg().moveTimeoutTicks then
		finishMove(npc, false, type(dirs) == "table" and "blocked_timeout" or "no_path")
	end
end

-- Patrol ----------------------------------------------------------------------------------------
local function routeWaypoints()
	return cfg().routes[A.routeId] or {}
end

local patrolNext

local function onPatrolArrive(npc, ok, reason)
	local route = routeWaypoints()
	if ok then
		A.waitUntilTick = A.tick + cfg().waypointPauseTicks
	else
		A.waitUntilTick = A.tick + cfg().retryAfterTicks
	end
	A.routeIndex = (A.routeIndex % #route) + 1
end

patrolNext = function()
	local route = routeWaypoints()
	if #route == 0 then
		return
	end
	local wpId = route[A.routeIndex]
	startMove(cfg().waypoints[wpId], wpId, onPatrolArrive)
end

function T.ardanStartPatrol(routeId, reason)
	if not cfg().routes[routeId] then
		return false, "unknown_route"
	end
	A.routeId = routeId
	A.mover = nil
	setState("PATROL", reason)
	return true
end

-- Alarm (training event triggered by an administrator, not a real threat detection) ------------
function T.ardanAlarmStart(zoneId, byName)
	local npc = T.getArdan()
	if not npc then
		return false, "agent_missing"
	end
	if A.alarmActive then
		return false, "already_active"
	end
	A.alarmActive = true
	A.resumeIndex = A.routeIndex
	A.mover = nil
	setState("ALERT", "training_alarm_started")
	T.bridgeEmit("training_alarm_started", { zoneId = zoneId, triggeredBy = byName })
	T.ardanSay(npc, "ALARM! Cwiczenia przy bramie. Cywile do swiatyni!", true, "rules")
	A.lastWarnTick = A.tick
	local wp = cfg().alarm.watchWaypoint
	startMove(cfg().waypoints[wp], wp, function(n, ok)
		A.lastWarnTick = A.tick
		if ok then
			T.ardanSay(n, "Jestem na posterunku przy bramie. Obserwuje.", false, "rules")
		else
			T.ardanSay(n, "Nie moge dojsc do bramy. Pilnuje stad.", false, "rules")
		end
	end)
	return true
end

function T.ardanAlarmClear(zoneId, byName)
	local npc = T.getArdan()
	if not npc then
		return false, "agent_missing"
	end
	if not A.alarmActive then
		return false, "not_active"
	end
	A.alarmActive = false
	A.mover = nil
	setState("RETURN", "training_alarm_cleared")
	T.bridgeEmit("training_alarm_cleared", { zoneId = zoneId, clearedBy = byName })
	T.ardanSay(npc, "Alarm odwolany. Wracam na patrol.", false, "rules")
	return true
end

local function returnToRoute()
	local route = routeWaypoints()
	local wpId = route[A.resumeIndex] or route[1]
	startMove(cfg().waypoints[wpId], wpId, function(n, ok)
		if ok then
			A.routeIndex = (A.resumeIndex % #route) + 1
			setState("PATROL", "returned_to_route")
		else
			A.waitUntilTick = A.tick + cfg().retryAfterTicks
		end
	end)
end

-- Greeting ----------------------------------------------------------------------------------------
local function isGreeting(message)
	local msg = message:lower():gsub("[%p]", " ")
	msg = " " .. msg:gsub("%s+", " ") .. " "
	for _, word in ipairs(cfg().greetWords) do
		if msg:find(" " .. word .. " ", 1, true) then
			return true
		end
	end
	return false
end

local function localGreeting(npc, player)
	T.ardanSay(npc, string.format("Witaj, %s. Jestem Ardan, straznik Montag. Trzymaj sie blisko swiatyni.", player:getName()), false, "rules_fallback")
end

function T.ardanOnSay(npc, creature, msgType, message)
	if not creature or not creature:isPlayer() or not isGreeting(message) then
		return
	end
	local player = Player(creature:getId())
	if not player or T.distance(player:getPosition(), npc:getPosition()) > cfg().greetRange then
		return
	end
	local guid = player:getGuid()
	local now = os.time()
	if A.greetCooldown[guid] and now - A.greetCooldown[guid] < cfg().greetCooldownSeconds then
		return
	end
	A.greetCooldown[guid] = now
	npc:turnToCreature(player)
	if not A.alarmActive then
		A.talkUntilTick = A.tick + cfg().talkPauseTicks
	end

	local eventId = T.bridgeEmit("player_greeted", {
		playerGuid = guid,
		playerName = player:getName(),
		text = message:sub(1, 300),
	})
	if A.alarmActive then
		T.ardanSay(npc, "Nie teraz, trwa alarm. Idz do swiatyni!", false, "rules")
	elseif eventId and T.bridgeIsBrainOnline() then
		A.pendingGreeting = { correlationId = eventId, playerId = player:getId(), deadlineTick = A.tick + cfg().brainReplyTicks }
	else
		localGreeting(npc, player)
	end
end

-- Called by the bridge when a valid Brain "say" arrives. Returns false if the fallback already spoke.
function T.ardanClaimGreeting(correlationId)
	local p = A.pendingGreeting
	if p and p.correlationId == correlationId then
		A.pendingGreeting = nil
		return true
	end
	return false
end

-- Main tick ------------------------------------------------------------------------------------
function T.ardanOnThink(npc, interval)
	A.npcId = npc:getId()
	A.tick = A.tick + 1

	local p = A.pendingGreeting
	if p and A.tick >= p.deadlineTick then
		A.pendingGreeting = nil
		A.fallbackUsed[p.correlationId] = true
		A.fallbackCount = A.fallbackCount + 1
		if A.fallbackCount > 100 then
			A.fallbackUsed, A.fallbackCount = { [p.correlationId] = true }, 1
		end
		local player = Player(p.playerId)
		if player then
			T.journal("brain_reply_timeout", { agentKey = cfg().agentKey, correlationId = p.correlationId })
			localGreeting(npc, player)
		end
	end

	if A.state == "IDLE" then
		T.ardanStartPatrol(cfg().defaultRoute, "startup")
		return
	end
	if A.state == "STOPPED" then
		return
	end

	if A.state == "ALERT" then
		if A.mover then
			stepMove(npc)
		elseif A.tick - A.lastWarnTick >= cfg().alarm.rewarnSeconds then
			A.lastWarnTick = A.tick
			T.ardanSay(npc, "Alarm trwa. Nie zblizajcie sie do bramy.", false, "rules")
		end
		return
	end

	if A.tick < A.talkUntilTick or A.tick < A.waitUntilTick then
		return
	end

	if A.mover then
		stepMove(npc)
		return
	end

	if A.state == "RETURN" then
		returnToRoute()
	elseif A.state == "PATROL" then
		patrolNext()
	elseif A.state == "COMMAND_MOVE" then
		-- move_to finished; hold position until a patrol command or alarm.
		return
	end
end

-- Commands from Brain (already validated by the bridge) ------------------------------------------
function T.ardanExecute(cmd, report)
	local npc = T.getArdan()
	if not npc then
		return report("rejected", "agent_missing")
	end
	local action, args = cmd.action, cmd.args
	if A.alarmActive and (action == "patrol" or action == "move_to") then
		return report("rejected", "alarm_active")
	end
	if action == "say" then
		if A.fallbackUsed[cmd.correlationId] then
			return report("rejected", "superseded_by_fallback")
		end
		local isReply = T.ardanClaimGreeting(cmd.correlationId)
		if not isReply and os.time() - A.lastSayTime < cfg().sayCooldownSeconds then
			return report("rejected", "say_rate_limited")
		end
		T.ardanSay(npc, args.text, false, "brain")
		return report("completed", "said")
	elseif action == "patrol" then
		local ok, reason = T.ardanStartPatrol(args.routeId, "command")
		return report(ok and "completed" or "rejected", ok and "patrol_started" or reason)
	elseif action == "move_to" then
		local wpId = args.waypointId
		A.mover = nil
		setState("COMMAND_MOVE", "command")
		report("accepted", "moving")
		startMove(cfg().waypoints[wpId], wpId, function(n, ok, reason)
			report(ok and "completed" or "failed", reason, T.posTable(n:getPosition()))
		end)
		return
	elseif action == "stop" then
		A.mover = nil
		setState("STOPPED", "command")
		return report("completed", "stopped", T.posTable(npc:getPosition()))
	end
	return report("rejected", "unknown_action")
end

local tick = GlobalEvent("TibiaAIArdanTick")
function tick.onThink(interval)
	local npc = T.getArdan()
	if npc then
		local ok, err = pcall(T.ardanOnThink, npc, interval)
		if not ok then
			T.journal("controller_error", { error = tostring(err) })
		end
	end
	return true
end
tick:interval(1000)
tick:register()

function T.ardanStatus()
	local npc = T.getArdan()
	return {
		state = A.state,
		alarmActive = A.alarmActive,
		routeId = A.routeId,
		routeIndex = A.routeIndex,
		moving = A.mover and A.mover.label or nil,
		position = npc and T.posTable(npc:getPosition()) or nil,
		planRevision = A.planRevision,
	}
end
