-- World start: new worldSessionId, bridge probe, spawn of every valid agent and engine
-- verification of its waypoints.
local T = TibiaAI

function T.spawnAgent(key)
	local def = T.agentDefs[key]
	local wp = def.waypoints[def.spawn]
	local npc = Game.createNpc(def.npcName, Position(wp.x, wp.y, wp.z))
	if not npc then
		T.journal("agent_spawn_failed", { agentKey = key, spawn = def.spawn })
		return nil
	end
	local agent = T.newAgentState(key)
	agent.npcId = npc:getId()
	T.agents[key] = agent
	T.journal("agent_spawned", { agentKey = key, creatureId = npc:getId(), behavior = def.behavior.type, position = T.posTable(npc:getPosition()) })
	T.verifyWaypoints(agent, npc)
	return agent
end

local startup = GlobalEvent("TibiaAIStartup")
function startup.onStartup()
	math.randomseed(os.time())
	T.worldSessionId = T.randomHex(16)
	T.worldStartedAtMs = T.nowMs()
	T.journal("world_session_started", { worldSessionId = T.worldSessionId, agents = T.sortedKeys(T.agentDefs) })
	T.bridgeInit()
	for _, key in ipairs(T.sortedKeys(T.agentDefs)) do
		T.spawnAgent(key)
	end
	return true
end
startup:register()
