-- Registers one Canary NpcType per agent definition. No shop, combat or loot. Random walking is
-- disabled (walkInterval = 0, see Npc::onThinkWalk) so only the TibiaAI controller moves agents.
-- Callbacks bind to g_scripts' interface (npc_type_functions.cpp:388), so registering from a
-- script is equivalent to an npc/*.lua file.
local T = TibiaAI

function T.registerNpcTypes()
	for _, key in ipairs(T.sortedKeys(T.agentDefs)) do
		local def = T.agentDefs[key]
		local npcType = Game.createNpcType(def.npcName)
		npcType.onSay = function(npc, creature, type, message)
			T.onNpcSay(npc, creature, type, message)
		end
		npcType.onAppear = function(npc, creature) end
		npcType.onDisappear = function(npc, creature) end
		npcType.onMove = function(npc, creature, fromPosition, toPosition) end
		npcType.onCloseChannel = function(npc, player) end
		npcType:register({
			name = def.npcName,
			description = def.description or def.npcName,
			health = 100,
			maxHealth = 100,
			walkInterval = 0,
			walkRadius = 0,
			speed = def.speed or 100,
			outfit = def.outfit,
			flags = { floorchange = false },
		})
	end
end
