-- Training arena scenario controller (WorldPolicy for one place). Only this module may place
-- monsters, and only from the allowlist in agents.json "arena". Agents never call it directly.
-- Requests through runtime/control (local administrator or test harness):
--   arena-spawn.request   "Troll,5014,5004,7"
--   arena-clear.request   removes monsters placed by this controller
-- Developer exceptions are separate, explicit and journaled as dev_exception_used. They exist to
-- reach states that are slow to reach in play (e.g. near-death) and are limited to arena.devCharacters:
--   dev-set-health.request "Kael,10"
--   dev-give-item.request  "Kael,266,5"
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

T.registerControl("dev-give-item.request", function(arg)
	local name, itemId, count = (arg or ""):match("^([%a ]+),(%d+),(%d+)$")
	local player = devPlayer(name)
	if not player then
		return T.journal("dev_exception_used", { action = "give_item", ok = false, arg = arg })
	end
	local item = player:addItem(tonumber(itemId), tonumber(count))
	T.journal("dev_exception_used", { action = "give_item", ok = item ~= nil, character = name, itemId = tonumber(itemId), count = tonumber(count) })
end)
