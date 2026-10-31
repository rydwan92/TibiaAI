-- Registers one Canary NpcType per agent definition. No combat or loot; a merchant ("shop": true) has
-- the price list from packages/contracts/shop.json. Random walking is
-- disabled (walkInterval = 0, see Npc::onThinkWalk) so only the TibiaAI controller moves agents.
-- Callbacks bind to g_scripts' interface (npc_type_functions.cpp:388), so registering from a
-- script is equivalent to an npc/*.lua file.
local T = TibiaAI

local function shopList()
	local raw = T.readFile(DATA_DIRECTORY .. "/tibia-ai/shop.json", 256 * 1024)
	local data = raw and T.json.decode(raw)
	if not data then
		return nil
	end
	local list = {}
	for _, item in ipairs(data.sold) do
		list[#list + 1] = { itemName = item.name, clientId = item.id, buy = item.price }
	end
	for _, item in ipairs(data.bought) do
		list[#list + 1] = { itemName = item.name, clientId = item.id, sell = item.price }
	end
	return list
end

function T.registerNpcTypes()
	for _, key in ipairs(T.sortedKeys(T.agentDefs)) do
		local def = T.agentDefs[key]
		local shownName = T.displayName(def)
		local marker = def.marked and T.defs.aiMarker or {}
		local outfit = {}
		for k, v in pairs(def.outfit or {}) do
			outfit[k] = v
		end
		for k, v in pairs(marker.outfitAccent or {}) do
			outfit[k] = v
		end
		local npcType = Game.createNpcType(shownName)
		npcType.onSay = function(npc, creature, type, message)
			T.onNpcSay(npc, creature, type, message)
		end
		npcType.onAppear = function(npc, creature) end
		npcType.onDisappear = function(npc, creature) end
		npcType.onMove = function(npc, creature, fromPosition, toPosition) end
		npcType.onCloseChannel = function(npc, player) end
		npcType.onBuyItem = function(npc, player, itemId, subType, amount, ignore, inBackpacks, totalCost)
			npc:sellItem(player, itemId, amount, subType, 0, ignore, inBackpacks)
		end
		npcType.onSellItem = function(npc, player, itemId, subtype, amount, ignore, name, totalCost)
			player:sendTextMessage(MESSAGE_TRADE, string.format("Sold %ix %s for %i gold.", amount, name, totalCost))
		end
		npcType.onCheckItem = function(npc, player, clientId, subType) end
		npcType:register({
			name = shownName,
			description = (def.description or def.npcName) .. (marker.lookNote and (". " .. marker.lookNote) or ""),
			health = 100,
			maxHealth = 100,
			walkInterval = 0,
			walkRadius = 0,
			speed = def.speed or 100,
			outfit = outfit,
			flags = { floorchange = false },
			shop = def.shop and shopList() or nil,
		})
	end
end
