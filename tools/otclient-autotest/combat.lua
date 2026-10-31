-- Combat capability experiment, driven through the real client (normal game rules apply).
-- Each result below is produced by the server's reaction, never assumed by the script:
-- collision -> received damage -> potion heal with real consumption and exhaust -> melee with
-- attack cadence -> monster death -> player death -> relogin.
local T = TibiaAIAutotest
local POTION = 266 -- health potion (data/scripts/actions/items/potions.lua: heals 125-175)
local BACKPACK = 2854 -- a death can drop the backpack; without one, potions do not count as inventory
local EMPTY_FLASK = 285 -- what a health potion leaves behind

local function me() return g_game.getLocalPlayer() end

local function nearestMonster()
  local best
  local here = me():getPosition()
  for _, c in ipairs(g_map.getSpectators(here, false)) do
    if c:isMonster() then
      local d = math.max(math.abs(c:getPosition().x - here.x), math.abs(c:getPosition().y - here.y))
      if not best or d < best.d then best = { c = c, d = d } end
    end
  end
  return best and best.c
end

function T.combatStart()
  local cfg = T.cfg
  T.messages = {}
  T.exclusive = true
  modules.game_interface.processMouseAction = function() return true end -- ignore clicks on the map
  T.request("dev-no-flasks.request", cfg.character)
  local giveDelay = 0
  if not me():getInventoryItem(InventorySlotBack) then
    T.request("dev-give-item.request", cfg.character .. "," .. BACKPACK .. ",1")
    giveDelay = 1500
  end
  scheduleEvent(function()
    if me():getInventoryCount(POTION, 0) < 2 then
      T.request("dev-give-item.request", cfg.character .. "," .. POTION .. ",5")
    end
  end, giveDelay)
  g_game.setFightMode(FightOffensive)
  g_game.setChaseMode(DontChase)
  T.log("combat start: %s hp %d/%d potions %d exp %d", me():getName(), me():getHealth(), me():getMaxHealth(),
    me():getInventoryCount(POTION, 0), me():getExperience())
  -- Every run starts from full health, whatever the previous run left (declared dev exception).
  T.request("dev-set-health.request", cfg.character .. "," .. me():getMaxHealth())
  scheduleEvent(T.combatCollision, giveDelay + 1500)
end

-- Walls are enforced by the server: stepping into one must not change the position.
function T.combatCollision()
  local cfg = T.cfg
  local start = me():getPosition()
  g_game.walk(cfg.wallDirection)
  scheduleEvent(function()
    local now = me():getPosition()
    T.result("collision", now.x == start.x and now.y == start.y, "stayed at " .. T.posText(now) .. " after walking into a wall")
    g_game.walk(cfg.openDirection)
    scheduleEvent(function()
      local moved = me():getPosition()
      T.result("move", moved.x ~= start.x or moved.y ~= start.y, T.posText(start) .. " -> " .. T.posText(moved))
      T.combatDamage()
    end, 1000)
  end, 1000)
end

-- Spawn through the arena controller, do not fight back, wait for real damage.
function T.combatDamage()
  local p = me():getPosition()
  T.request("arena-spawn.request", string.format("Valkyrie,%d,%d,%d", p.x + 2, p.y - 2, p.z))
  T.poll(nearestMonster, 8000, function(m)
    T.result("monster_spawned", true, m:getName() .. " at " .. T.posText(m:getPosition()))
    local full = me():getHealth()
    T.poll(function() return me():getHealth() < full end, 45000, function()
      T.result("damage_received", true, string.format("hp %d -> %d", full, me():getHealth()))
      -- Hits are small at this level; lower HP through the declared developer exception so the
      -- potion has something to heal. The heal itself is the game's.
      T.request("dev-set-health.request", T.cfg.character .. ",60")
      T.poll(function() return me():getHealth() <= 60 end, 5000, T.combatPotion, T.combatPotion)
    end, function()
      T.result("damage_received", false, "hp still " .. me():getHealth() .. " after 45 s")
      T.combatSwapToWeakTarget()
    end)
  end, function()
    T.result("monster_spawned", false, "no monster visible")
    T.combatEnd()
  end)
end

-- Two uses in the same instant: Canary does not refuse the second one, it queues it until the
-- potion cooldown ends (Game::playerUseWithCreature, setNextPotionActionTask). So the rule to
-- verify is the spacing between real consumptions, measured from the inventory count.
function T.combatPotion()
  local hp0, count0 = me():getHealth(), me():getInventoryCount(POTION, 0)
  if count0 < 2 then
    T.result("potion_heal", false, "need 2 potions, have " .. count0)
    return T.combatSwapToWeakTarget()
  end
  T.messages = {}
  local sentAt = g_clock.millis()
  local seen, times = count0, {}
  g_game.useInventoryItemWith(POTION, me(), 0)
  g_game.useInventoryItemWith(POTION, me(), 0)
  T.poll(function()
    local c = me():getInventoryCount(POTION, 0)
    if c < seen then
      for _ = 1, seen - c do times[#times + 1] = g_clock.millis() - sentAt end
      seen = c
    end
    return #times >= 2
  end, 4000, function()
    local gap = times[2] - times[1]
    T.result("potion_heal", me():getHealth() > hp0, string.format("hp %d -> %d", hp0, me():getHealth()))
    T.result("potion_consumed", seen == count0 - 2, string.format("potions %d -> %d for 2 uses", count0, seen))
    T.result("potion_cooldown", gap >= 900, string.format("2nd potion applied %d ms after the 1st (queued by the server)", gap))
    T.result("no_flasks_left", me():getInventoryCount(EMPTY_FLASK, 0) == 0, string.format("%d empty flasks in the backpack", me():getInventoryCount(EMPTY_FLASK, 0)))
    T.log("server messages: %s", table.concat(T.messages, " | "))
    T.combatSwapToWeakTarget()
  end, function()
    T.result("potion_cooldown", false, string.format("%d consumptions in 4 s, potions %d -> %d", #times, count0, seen))
    T.combatSwapToWeakTarget()
  end)
end

-- The strong attacker has done its job; a weak monster lets a level 7 knight finish a kill.
function T.combatSwapToWeakTarget()
  T.request("arena-clear.request", "")
  scheduleEvent(function()
    local p = me():getPosition()
    -- 30 HP and runHealth 0: a cave rat flees at 3 HP, out of reach, which failed the melee check at random.
    T.request("arena-spawn.request", string.format("Sandcrawler,%d,%d,%d", p.x, p.y - 1, p.z))
    T.poll(nearestMonster, 6000, T.combatMelee, T.combatMelee)
  end, 1500)
end

-- Attack through the normal target packet and measure what the server does.
function T.combatMelee()
  local m = nearestMonster()
  if not m then
    T.result("melee", false, "no monster to attack")
    return T.combatDeath()
  end
  local exp0 = me():getExperience()
  local id = m:getId()
  local last, hits, firstAt, lastAt = m:getHealthPercent(), 0, nil, nil
  local weapon = me():getInventoryItem(InventorySlotLeft) or me():getInventoryItem(InventorySlotRight)
  T.log("melee: target %s distance %d, weapon id %s, fight mode %s", m:getName(), m:getPosition().x - me():getPosition().x,
    tostring(weapon and weapon:getId()), tostring(g_game.getFightMode()))
  T.messages = {}
  g_game.attack(m)
  scheduleEvent(function()
    T.log("melee after 4 s: attacking=%s target=%s", tostring(g_game.isAttacking()),
      tostring(g_game.getAttackingCreature() and g_game.getAttackingCreature():getName()))
    T.request("arena-probe.request", T.cfg.character)
  end, 4000)
  T.poll(function()
    local c = g_map.getCreatureById(id)
    if not c or c:getHealthPercent() <= 0 then return true end
    local pct = c:getHealthPercent()
    if pct < last then
      hits = hits + 1
      firstAt = firstAt or g_clock.millis()
      lastAt = g_clock.millis()
      last = pct
    end
    return false
  end, 120000, function() -- a level 8 character needs a while for 30 HP behind armor
    T.log("melee messages: %s", table.concat(T.messages, " | "))
    local gap = hits > 1 and math.floor((lastAt - firstAt) / (hits - 1)) or 0
    T.result("melee_hits", hits > 0, string.format("%d damaging hits, mean gap %d ms (attack speed 2000 ms, misses and blocks not counted)", hits, gap))
    scheduleEvent(function()
      T.result("monster_killed", me():getExperience() > exp0, string.format("exp %d -> %d", exp0, me():getExperience()))
      T.combatDeath()
    end, 1000)
  end, function()
    T.log("melee messages: %s", table.concat(T.messages, " | "))
    T.result("melee_hits", false, string.format("monster still alive, %d hits, %d%%", hits, last))
    T.combatDeath()
  end)
end

-- Near-death is a declared developer exception; the killing blow comes from the game itself.
function T.combatDeath()
  local p = me():getPosition()
  T.request("arena-spawn.request", string.format("Valkyrie,%d,%d,%d", p.x + 1, p.y - 1, p.z))
  T.request("dev-set-health.request", T.cfg.character .. ",20")
  T.dead = false
  T.messages = {}
  T.poll(function() return T.dead or not g_game.isOnline() end, 90000, function()
    T.result("death", T.dead == true, T.dead and "server reported death to the client" or "went offline without death message")
    T.combatEnd()
  end, function()
    T.log("death phase messages: %s", table.concat(T.messages, " | "))
    T.result("death", false, "alive after 90 s, hp " .. me():getHealth())
    T.combatEnd()
  end)
end

function T.combatEnd()
  T.request("arena-clear.request", "")
  scheduleEvent(function()
    if g_game.isOnline() then g_game.forceLogout() end
    scheduleEvent(T.finish, 2000)
  end, 1500)
end
