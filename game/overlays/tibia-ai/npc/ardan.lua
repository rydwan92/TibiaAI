-- Ardan, guard of Montag. No shop, no combat, no loot. Random walking is disabled
-- (walkInterval = 0, checked in Npc::onThinkWalk of Canary v3.6.1) so only TibiaAI's controller moves him.
local npcName = "Ardan"

local npcType = Game.createNpcType(npcName)
local npcConfig = {}

npcConfig.name = npcName
npcConfig.description = "Ardan, the guard of Montag"

npcConfig.health = 100
npcConfig.maxHealth = npcConfig.health
npcConfig.walkInterval = 0
npcConfig.walkRadius = 0
npcConfig.speed = 120

npcConfig.outfit = {
	lookType = 131,
	lookHead = 57,
	lookBody = 59,
	lookLegs = 40,
	lookFeet = 76,
	lookAddons = 0,
}

npcConfig.flags = {
	floorchange = false,
}

-- No npcType.onThink: Canary only schedules NPC think while a player sees the NPC
-- (Npc::manageIdle), so the controller runs from the TibiaAIArdanTick GlobalEvent instead.

npcType.onSay = function(npc, creature, type, message)
	TibiaAI.ardanOnSay(npc, creature, type, message)
end

npcType.onAppear = function(npc, creature) end
npcType.onDisappear = function(npc, creature) end
npcType.onMove = function(npc, creature, fromPosition, toPosition) end
npcType.onCloseChannel = function(npc, player) end

npcType:register(npcConfig)
