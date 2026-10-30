-- Agent registry: validated definitions (agents.json) and per-agent runtime state.
local T = TibiaAI

local BEHAVIORS = { patrol = true, stationary = true }

local function isPos(p)
	return type(p) == "table" and type(p.x) == "number" and type(p.y) == "number" and type(p.z) == "number"
end

-- Returns nil when valid, otherwise a short description of the first problem.
function T.validateDefinition(def)
	if type(def) ~= "table" then
		return "not an object"
	end
	if type(def.npcName) ~= "string" or def.npcName == "" then
		return "npcName"
	end
	if type(def.waypoints) ~= "table" or next(def.waypoints) == nil then
		return "waypoints"
	end
	for id, wp in pairs(def.waypoints) do
		if not isPos(wp) then
			return "waypoint " .. tostring(id)
		end
	end
	if not def.waypoints[def.spawn] then
		return "spawn must be a waypoint id"
	end
	for routeId, route in pairs(def.routes or {}) do
		if type(route) ~= "table" or #route == 0 then
			return "route " .. tostring(routeId)
		end
		for _, wp in ipairs(route) do
			if not def.waypoints[wp] then
				return "route " .. tostring(routeId) .. " -> " .. tostring(wp)
			end
		end
	end
	local b = def.behavior
	if type(b) ~= "table" or not BEHAVIORS[b.type] then
		return "behavior.type"
	end
	if b.type == "patrol" and not (def.routes and def.routes[b.defaultRoute]) then
		return "behavior.defaultRoute"
	end
	if b.type == "stationary" and not def.waypoints[b.home] then
		return "behavior.home"
	end
	if def.alarm ~= nil then
		if type(def.alarm) ~= "table" or type(def.alarm.zones) ~= "table" or not def.waypoints[def.alarm.moveTo] then
			return "alarm"
		end
	end
	if def.hearing ~= nil then
		local h = def.hearing
		if type(h) ~= "table" or type(h.range) ~= "number" or (h.yellRange ~= nil and type(h.yellRange) ~= "number") then
			return "hearing"
		end
	end
	if type(def.greeting) ~= "table" or type(def.greeting.words) ~= "table" or type(def.greeting.range) ~= "number" then
		return "greeting"
	end
	if type(def.texts) ~= "table" or type(def.texts.greetFallback) ~= "string" then
		return "texts.greetFallback"
	end
	return nil
end

T.defs = T.defs or { agents = {}, timing = {} }
T.agentDefs = T.agentDefs or {}
T.timing = T.timing or {}
T.agents = T.agents or {} -- agentKey -> runtime state

-- Ticks are 1000 ms (TibiaAIAgentTick GlobalEvent); *Ticks values below count those ticks.
local DEFAULT_TIMING = {
	talkPauseTicks = 4,
	brainReplyTicks = 2,
	moveTimeoutTicks = 8,
	retryAfterTicks = 5,
	waypointPauseTicks = 2,
	pathSearchDistance = 30,
	sayCooldownSeconds = 3,
	conversationTimeoutSeconds = 45,
	speechCooldownSeconds = 2,
}

function T.loadDefinitions()
	T.agentDefs = {}
	T.timing = {}
	for k, v in pairs(DEFAULT_TIMING) do
		T.timing[k] = v
	end
	local raw = T.readFile(T.paths.agents, 1024 * 1024)
	if not raw then
		T.journal("agent_definitions_missing", { path = T.paths.agents })
		return
	end
	local doc, err = T.json.decode(raw)
	if type(doc) ~= "table" or doc.schemaVersion ~= 1 or type(doc.agents) ~= "table" then
		T.journal("agent_definitions_invalid", { error = err or "schemaVersion/agents" })
		return
	end
	T.defs = doc
	for k, v in pairs(doc.timing or {}) do
		if type(v) == "number" then
			T.timing[k] = v
		end
	end
	for _, key in ipairs(T.sortedKeys(doc.agents)) do
		local def = doc.agents[key]
		local problem = T.validateDefinition(def)
		if problem or not key:match("^[a-z][a-z0-9_]*$") then
			T.journal("agent_definition_invalid", { agentKey = key, problem = problem or "agentKey format" })
		else
			def.key = key
			T.agentDefs[key] = def
		end
	end
	T.journal("agent_definitions_loaded", { agents = T.sortedKeys(T.agentDefs) })
end

function T.sortedKeys(t)
	local keys = {}
	for k in pairs(t or {}) do
		keys[#keys + 1] = k
	end
	table.sort(keys)
	return keys
end

function T.newAgentState(key)
	return {
		key = key,
		npcId = nil,
		state = "IDLE",
		tick = 0,
		routeId = nil,
		routeIndex = 1,
		resumeIndex = 1,
		mover = nil, -- { target, label, lastProgressTick, onDone }
		waitUntilTick = 0,
		talkUntilTick = 0,
		alarmZone = nil,
		lastWarnTick = 0,
		greetCooldown = {}, -- playerGuid -> os.time()
		pendingReplies = {}, -- { correlationId, playerId, greeting, deadlineTick }
		talkers = {}, -- playerGuid -> os.time() of the last message addressed to this NPC
		lastSpeech = {}, -- playerGuid -> os.time() of the last message heard (rate limit)
		fallbackUsed = {}, -- correlationId -> true once the local reply answered
		fallbackCount = 0,
		lastSayTime = 0,
		planRevision = 0,
	}
end

function T.agentDef(agent)
	return T.agentDefs[agent.key]
end

function T.agentNpc(agent)
	if not agent or not agent.npcId then
		return nil
	end
	local npc = Npc(agent.npcId)
	if not npc or npc:isRemoved() then
		return nil
	end
	return npc
end

function T.agentByNpcId(npcId)
	for _, agent in pairs(T.agents) do
		if agent.npcId == npcId then
			return agent
		end
	end
	return nil
end

function T.agentText(agent, key, vars)
	local text = T.agentDef(agent).texts[key]
	if type(text) ~= "string" or text == "" then
		return nil
	end
	return T.format(text, vars)
end
