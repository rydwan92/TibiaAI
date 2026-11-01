-- Training arena scenario controller (WorldPolicy for one place). Only this module may place
-- monsters, and only from the allowlist in agents.json "arena". Agents never call it directly.
-- Requests through runtime/control (local administrator or test harness):
--   arena-spawn.request   "Troll,32373,32251,7"
--   arena-clear.request   removes monsters placed by this controller
-- Developer exceptions are separate, explicit and journaled as dev_exception_used. They exist to
-- reach states that are slow to reach in play (e.g. near-death) and are limited to arena.devCharacters:
--   dev-set-health.request "Kael,10"
--   dev-give-item.request  "Kael,266,5"
--   dev-no-flasks.request  "Kael"   no empty flasks for this character, removes the ones it has
local T = TibiaAI

T.arena = T.arena or { monsters = {} }
local A = T.arena

local function config()
	return T.defs.arena or {}
end

local function allowedMonster(name)
	for _, m in ipairs(config().monsters or {}) do
		if m:lower() == name:lower() then
			return m
		end
	end
	return nil
end

local function liveMonsters()
	local alive = {}
	for _, id in ipairs(A.monsters) do
		local m = Monster(id)
		if m and not m:isRemoved() then
			alive[#alive + 1] = id
		end
	end
	A.monsters = alive
	return alive
end

local function inArena(pos)
	local c = config().center
	return c and T.distance(pos, c) <= (config().radius or 0)
end

function T.arenaSpawn(name, pos)
	local monster = allowedMonster(name)
	if not monster then
		return false, "monster_not_allowed"
	end
	if not inArena(pos) then
		return false, "outside_arena"
	end
	if #liveMonsters() >= (config().maxMonsters or 1) then
		return false, "arena_full"
	end
	local m = Game.createMonster(monster, Position(pos.x, pos.y, pos.z), true, true)
	if not m then
		return false, "spawn_failed"
	end
	A.monsters[#A.monsters + 1] = m:getId()
	return true, m:getId()
end

function T.arenaClear()
	local removed = 0
	for _, id in ipairs(liveMonsters()) do
		Monster(id):remove()
		removed = removed + 1
	end
	A.monsters = {}
	return removed
end

T.registerControl("arena-spawn.request", function(arg)
	local name, x, y, z = (arg or ""):match("^([%a ]+),(%d+),(%d+),(%d+)$")
	if not name then
		return T.journal("arena_spawn", { ok = false, reason = "expected name,x,y,z", arg = arg })
	end
	local ok, info = T.arenaSpawn(name, { x = tonumber(x), y = tonumber(y), z = tonumber(z) })
	T.journal("arena_spawn", { ok = ok, monster = name, position = { x = tonumber(x), y = tonumber(y), z = tonumber(z) }, info = info })
end)

T.registerControl("arena-clear.request", function()
	T.journal("arena_clear", { removed = T.arenaClear() })
end)

local function devPlayer(name)
	for _, allowed in ipairs(config().devCharacters or {}) do
		if allowed:lower() == (name or ""):lower() then
			return Player(allowed)
		end
	end
	return nil
end

T.registerControl("dev-set-health.request", function(arg)
	local name, hp = (arg or ""):match("^([%a ]+),(%d+)$")
	local player = devPlayer(name)
	if not player then
		return T.journal("dev_exception_used", { action = "set_health", ok = false, arg = arg })
	end
	player:addHealth(tonumber(hp) - player:getHealth())
	T.journal("dev_exception_used", { action = "set_health", ok = true, character = name, health = player:getHealth() })
end)

-- A character stays in the world after its client disconnects; this logs it out with a save.
T.registerControl("dev-kick.request", function(arg)
	local player = devPlayer(arg)
	if player then
		player:remove()
	end
	T.journal("dev_exception_used", { action = "kick", ok = player ~= nil, character = arg })
end)

-- Read-only engine view of a fighter, for diagnosing combat experiments.
T.registerControl("arena-probe.request", function(arg)
	local player = devPlayer(arg)
	if not player then
		return T.journal("arena_probe", { ok = false, arg = arg })
	end
	local target = player:getTarget()
	local weapon = player:getSlotItem(CONST_SLOT_LEFT) or player:getSlotItem(CONST_SLOT_RIGHT)
	T.journal("arena_probe", {
		ok = true,
		health = player:getHealth(),
		position = T.posTable(player:getPosition()),
		target = target and target:getName() or nil,
		targetHealth = target and target:getHealth() or nil,
		targetMaxHealth = target and target:getMaxHealth() or nil,
		targetPosition = target and T.posTable(target:getPosition()) or nil,
		weapon = weapon and weapon:getId() or nil,
		fightMode = player:getFightMode(),
		pacified = player:getCondition(CONDITION_PACIFIED) ~= nil,
		protectionZone = player:getTile():hasFlag(TILESTATE_PROTECTIONZONE),
		axeSkill = player:getSkillLevel(SKILL_AXE),
	})
end)

-- Empty flasks pile up over test runs and eat the character's capacity. Uses the engine's own
-- per-player switch (the !flask talkaction), so the potion rules stay the same for everyone else.
local EMPTY_FLASKS = { 283, 284, 285 }

T.registerControl("dev-no-flasks.request", function(arg)
	local player = devPlayer(arg)
	if not player then
		return T.journal("dev_exception_used", { action = "no_flasks", ok = false, arg = arg })
	end
	player:kv():set("talkaction.potions.flask", true)
	local removed = 0
	for _, id in ipairs(EMPTY_FLASKS) do
		local count = player:getItemCount(id)
		if count > 0 and player:removeItem(id, count) then
			removed = removed + count
		end
	end
	T.journal("dev_exception_used", { action = "no_flasks", ok = true, character = arg, removed = removed })
end)

-- Scenario tests repeat an errand, so a dev character can start it over. Only tasks listed in
-- arena.devTasks; ordinary characters keep their progress.
T.registerControl("dev-reset-task.request", function(arg)
	local name, taskId = (arg or ""):match("^([%a ]+),([%w_]+)$")
	local player = devPlayer(name)
	local task = T.taskDefs[taskId or ""]
	local listed = false
	for _, id in ipairs(config().devTasks or {}) do
		listed = listed or id == taskId
	end
	if not player or not task or not listed then
		return T.journal("dev_exception_used", { action = "reset_task", ok = false, arg = arg })
	end
	player:setStorageValue(task.storage, 0)
	for _, step in ipairs(task.steps) do
		local item = step.giveItem
		if item and player:getItemCount(item.id) > 0 then
			player:removeItem(item.id, player:getItemCount(item.id))
		end
	end
	T.journal("dev_exception_used", { action = "reset_task", ok = true, character = name, taskId = taskId })
end)

-- Start equipment of a player agent, once per character (arena.kits in agents.json).
local KIT_SLOTS = {
	backpack = CONST_SLOT_BACKPACK, armor = CONST_SLOT_ARMOR, head = CONST_SLOT_HEAD, legs = CONST_SLOT_LEGS,
	feet = CONST_SLOT_FEET, left = CONST_SLOT_LEFT, right = CONST_SLOT_RIGHT,
}

T.registerControl("dev-kit.request", function(arg)
	local name, kitName, refresh = (arg or ""):match("^([%a ]+),(%a+),?(%a*)$")
	local player = devPlayer(name)
	local kit = (config().kits or {})[kitName or ""]
	if not player or not kit then
		return T.journal("dev_exception_used", { action = "kit", ok = false, arg = arg })
	end
	-- Nobody teaches spells in this world yet, so a dev character knows those of its vocation.
	for _, spell in ipairs((config().kitSpells or {})[kitName] or {}) do
		player:learnSpell(spell)
	end
	local storage = config().kitStorage
	if player:getStorageValue(storage) == 1 and refresh ~= "refresh" then
		return T.journal("dev_exception_used", { action = "kit", ok = true, character = name, already = true })
	end
	-- A slot already taken makes addItem drop the new piece on the floor, so a first kit clears them too.
	if refresh == "refresh" or (config().replaceWorn or {})[kitName] then
		for _, slot in pairs(KIT_SLOTS) do
			local worn = player:getSlotItem(slot)
			if worn then
				worn:remove()
			end
		end
	end
	for _, item in ipairs(kit) do
		-- With a subtype given, the engine reads count as that many separate items; one stack is wanted.
		-- Bows here draw only from a quiver in the right hand (Player::getQuiverAmmoOfType).
		local given = player:addItem(item.id, 1, true, item.count or 1, KIT_SLOTS[item.slot] or CONST_SLOT_WHEREEVER)
		for _, inner in ipairs(item.contains or {}) do
			given:addItem(inner.id, inner.count)
		end
	end
	player:setStorageValue(storage, 1)
	player:kv():set("talkaction.potions.flask", true) -- empty flasks would only eat capacity
	T.journal("dev_exception_used", { action = "kit", ok = true, character = name, kit = kitName })
end)

-- Test hooks: what a death or a thief would do, on demand and only to dev characters.
T.registerControl("dev-strip.request", function(arg)
	local name, slot = (arg or ""):match("^([%a ]+),(%d+)$")
	local player = devPlayer(name)
	local worn = player and player:getSlotItem(tonumber(slot))
	if worn then
		worn:remove()
	end
	T.journal("dev_exception_used", { action = "strip", ok = worn ~= nil, character = name, slot = slot })
end)

T.registerControl("dev-kill.request", function(arg)
	local player = devPlayer(arg)
	if player then
		player:addHealth(-player:getHealth())
	end
	T.journal("dev_exception_used", { action = "kill", ok = player ~= nil, character = arg })
end)

T.registerControl("dev-give-item.request", function(arg)
	local name, itemId, count = (arg or ""):match("^([%a ]+),(%d+),(%d+)$")
	local player = devPlayer(name)
	if not player then
		return T.journal("dev_exception_used", { action = "give_item", ok = false, arg = arg })
	end
	local item = player:addItem(tonumber(itemId), tonumber(count))
	T.journal("dev_exception_used", { action = "give_item", ok = item ~= nil, character = name, itemId = tonumber(itemId), count = tonumber(count) })
end)
