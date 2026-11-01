-- Body of a player agent, running inside a real client: everything goes through the same packets a
-- person's client sends, so the server applies every rule. Reflexes (healing, fighting, fleeing,
-- walking) live here and never wait for a model. Brain sets the goal through files in --agent-dir:
--   state.json    written here every second: what this character sees and has
--   events.jsonl  appended here: speech heard, server messages, death
--   orders.json   read here: { goal = {...}, say = { { id, text } } }
TibiaAIAgent = {}
local A = TibiaAIAgent

local TICK_MS = 300
local EVENTS_MAX_BYTES = 2000000
-- How far each shooter reaches: a knight needs no entry, he fights hand to hand.
local RANGE = { paladin = 5, sorcerer = 3, druid = 3 }
local KITE_AT = 1
local KITE_MS = 900
local STATE_MS = 1000
local POTIONS = { health = { 266, 236, 239 }, mana = { 268, 237, 238 } }
local MEAT = 3577
local GOLD = 3031
local BACKPACK = { x = 65535, y = 3, z = 0 }
local PLATINUM = 3035
local KEEP = { [3031] = true, [3035] = true, [3043] = true, [3577] = true, [3582] = true, [3585] = true, [266] = true, [268] = true, [17512] = true }
local MIN_CAP_TO_LOOT = 10
local PARTY_MS = 3000
local OFFLINE_MS = 15000
local SAY_FRESH_MS = 60000
local AWAKE_MS = 480000 -- the server sends away whoever does nothing for 15 minutes
local BREAK_TRIES = 4
local LIGHT_SHOVEL = 5710
local TRADE_STEP_MS = 700
local SAIL_DISTANCE = 2
local SAIL_STEP_MS = 2500
local TRADE_ASK_MS = 6000
local DEPOT_CHEST = 3502
local DEPOT_BOX = 22797
local LOCKER_MIN, LOCKER_MAX = 3497, 3500
local DEPOT_GIVE_UP_MS = 30000
local LOOT_MS = 12000
local MAX_LOOT_MOVES = 8
local VIP_DELAY_MS = 5000
local VIP_ADD_MS = 5000
local ARROW = 3447
local BOW = 3350
local EQUIP_MS = 3000
local ARROWS_MS = 20000
local SLOTS = { 1, 3, 4, 5, 6, 7, 8 }
local SPELL_COOLDOWN_MS = 2100
local POTION_COOLDOWN_MS = 1100
local STUCK_MS = 6000
local USE_MS = 1500
local DIG_MS = 4000
local GIVE_UP_MS = 9000
local IGNORE_MS = 25000

local dir, cfg
local eventSession, eventSeq = "", 0
local orders = { goal = { type = "idle" }, say = {} }
local handlers = {}
local said = {}
local lastSpell, lastPotion, lastState, lastMoveAt, lastMeal = 0, 0, 0, 0, 0
local lastPos
local visited = {}
local relogging = false
local tickEvent
local kitAsked = false
local kitRefresh = false
local lastUse, lastDig, lastEquip, lastArrows, lastKite = 0, 0, 0, 0, 0
local lastKitOrder = 0
local sailGoal, sailStep = 0, 0
local lastParty, lastRest = 0, nil
local lastTurn, offlineAt, playedOnce = 0, nil, false
local comeBackTries = 0
local takeBreak, comeBack
local ignored = {}
local trade, depot
local tradeGoal, tradeGreeted = 0, false
local keep = {}
local safeFightOff = false
local chase = { id = 0, hp = 0, atMs = 0 }
local lastTargetPos, lootAt, lootUntil, corpse = nil, nil, 0, nil
local lootMoves = 0
local vips = {}
local vipsAdded = false
local lastVipAdd = 0
local loginHidden = false
local enteredAt = 0

local function now() return g_clock.millis() end

local function read(name)
  local f = io.open(dir .. name, "rb")
  if not f then return nil end
  local text = f:read("*a")
  f:close()
  return text
end

local function write(name, text)
  local f = io.open(dir .. name .. ".tmp", "wb")
  if not f then return end
  f:write(text)
  f:close()
  os.remove(dir .. name)
  os.rename(dir .. name .. ".tmp", dir .. name)
end

-- Every record carries its run and number, so a repeated one is known for what it is.
local function event(kind, fields)
  fields = fields or {}
  eventSeq = eventSeq + 1
  fields.kind, fields.atMs, fields.session, fields.seq = kind, os.time() * 1000, eventSession, eventSeq
  local f = io.open(dir .. "events.jsonl", "ab")
  if f then
    f:write(json.encode(fields), "\n")
    f:close()
  end
end

local function me() return g_game.getLocalPlayer() end

local function gap(a, b)
  if a.z ~= b.z then return 999 end
  return math.max(math.abs(a.x - b.x), math.abs(a.y - b.y))
end

-- Reflexes -------------------------------------------------------------------------------------
local function hostiles(p)
  local list = {}
  local here = p:getPosition()
  for _, c in ipairs(g_map.getSpectators(here, false)) do
    if c:isMonster() and c:getHealthPercent() > 0 and (ignored[c:getId()] or 0) < now() then
      list[#list + 1] = { c = c, d = gap(c:getPosition(), here) }
    end
  end
  table.sort(list, function(a, b) return a.d < b.d end)
  return list
end

local function owned(p, ids)
  local total = 0
  for _, id in ipairs(ids) do total = total + p:getInventoryCount(id, 0) end
  return total
end

-- The strongest potion this character may drink; the mind knows what its level allows.
local function drink(p, kind)
  if now() - lastPotion < POTION_COOLDOWN_MS then return false end
  for _, id in ipairs((orders.potions and orders.potions[kind]) or POTIONS[kind]) do
    if p:getInventoryCount(id, 0) > 0 then
      lastPotion = now()
      g_game.useInventoryItemWith(id, p, 0)
      return true
    end
  end
  return false
end

local function cast(words)
  if not words or now() - lastSpell < SPELL_COOLDOWN_MS then return false end
  lastSpell = now()
  g_game.talk(words)
  return true
end

local function heal(p)
  local r = cfg.reflexes
  local hp = p:getHealth() / math.max(p:getMaxHealth(), 1)
  if hp < r.healAt then
    if not drink(p, "health") and p:getMana() >= (orders.healMana or 20) then cast(orders.healSpell or cfg.healSpell) end
  end
  if p:getMana() / math.max(p:getMaxMana(), 1) < r.manaAt and hp > r.healAt then drink(p, "mana") end
  return hp
end

local function walkTowards(p, target)
  if p:isAutoWalking() then return end
  local here = p:getPosition()
  if here.z ~= target.z then return end
  if gap(here, target) <= 7 and p:autoWalk(target) then return end
  -- Far targets are outside the known map: take the visible tile that gets closest.
  local best, bestScore
  for dx = -7, 7 do
    for dy = -5, 5 do
      local to = { x = here.x + dx, y = here.y + dy, z = here.z }
      local key = to.x .. ":" .. to.y .. ":" .. to.z
      local tile = g_map.getTile(to)
      if tile and tile:isWalkable() and (dx ~= 0 or dy ~= 0) then
        local score = math.max(math.abs(target.x - to.x), math.abs(target.y - to.y)) + (visited[key] or 0) * 4
        if not best or score < bestScore then
          best, bestScore = to, score
        end
      end
    end
  end
  if best then
    local key = best.x .. ":" .. best.y .. ":" .. best.z
    visited[key] = (visited[key] or 0) + 1
    p:autoWalk(best)
  end
end

local function wander(p)
  if p:isAutoWalking() then return end
  local here = p:getPosition()
  local heading = orders.goal.heading
  if heading and (heading.x ~= 0 or heading.y ~= 0) then
    walkTowards(p, { x = here.x + heading.x * 30, y = here.y + heading.y * 30, z = here.z })
    return
  end
  -- Hunting ground: walk around looking for something, with the odd pause, as a person does.
  if math.random() < 0.3 then return end
  local best, bestScore
  for _ = 1, 12 do
    local to = { x = here.x + math.random(-6, 6), y = here.y + math.random(-5, 5), z = here.z }
    local tile = g_map.getTile(to)
    if tile and tile:isWalkable() and tile:isPathable() then
      local score = visited[to.x .. ":" .. to.y] or 0
      if not best or score < bestScore then best, bestScore = to, score end
    end
  end
  if best then
    local key = best.x .. ":" .. best.y
    visited[key] = (visited[key] or 0) + 1
    p:autoWalk(best)
  end
end

local function useThing(p, spot, how)
  if now() - lastUse < USE_MS then return end
  local tile = g_map.getTile(spot)
  local thing = tile and tile:getTopUseThing()
  if not thing then return end
  lastUse = now()
  how(thing)
end

local function openDoor(p, goal)
  local here = p:getPosition()
  local spot = { x = goal.x, y = goal.y, z = goal.z }
  if here.z ~= goal.z then return end
  if gap(here, spot) > 1 then
    walkTowards(p, spot)
    return
  end
  local tile = g_map.getTile(spot)
  if tile and tile:isWalkable() then
    if not p:isAutoWalking() then p:autoWalk(spot) end
    return
  end
  useThing(p, spot, function(thing) g_game.use(thing) end)
end

-- Floors: stairs and holes are walked onto, ladders and grates are used, rope spots need a rope.
local function changeFloor(p, goal)
  local here = p:getPosition()
  local spot = { x = goal.x, y = goal.y, z = goal.z }
  if here.z ~= goal.z then return end
  if goal.kind == "stairs" or goal.kind == "hole" or goal.kind == "teleport" then
    if not p:isAutoWalking() then p:autoWalk(spot) end
    return
  end
  if gap(here, spot) > 1 then
    walkTowards(p, spot)
    return
  end
  if goal.kind == "rope_spot" then
    useThing(p, spot, function(thing) g_game.useInventoryItemWith(3003, thing, 0) end)
  elseif goal.kind == "shovel_hole" then
    -- The shovel opens the ground for a moment; then the hole is walked into.
    if now() - lastDig > DIG_MS then
      lastDig = now()
      lastUse = 0
      -- A new character gets a light shovel from the server, a shop sells the ordinary one.
      local shovel = p:getInventoryCount(LIGHT_SHOVEL, 0) > 0 and LIGHT_SHOVEL or 3457
      useThing(p, spot, function(thing) g_game.useInventoryItemWith(shovel, thing, 0) end)
    elseif not p:isAutoWalking() then
      p:autoWalk(spot)
    end
  else
    useThing(p, spot, function(thing) g_game.use(thing) end)
  end
end

local function eat(p)
  if now() - lastMeal < 90000 then return end
  lastMeal = now()
  if p:getInventoryCount(MEAT, 0) > 0 then g_game.useInventoryItem(MEAT) end
end

-- After a greeting an NPC listens only in its own tab, which the client opens at its first answer.
local function npcMessage(text)
  local console = modules.game_console
  local ok = pcall(function()
    local tab = console.getTab("NPCs")
    console.consoleTabBar:selectTab(tab)
    console.sendMessage(text, tab)
  end)
  if not ok then g_game.talkPrivate(MessageModes.NpcTo, "NPCs", text) end
end

-- A passage or a lesson is arranged in words, like a person does it: greet, name it, agree.
local function doTalk(p, goal, words)
  local npc = { x = goal.x, y = goal.y, z = goal.z }
  if gap(p:getPosition(), npc) > SAIL_DISTANCE then
    walkTowards(p, npc)
    return
  end
  if now() - lastUse < SAIL_STEP_MS then return end
  lastUse = now()
  if sailGoal ~= goal.id then sailGoal, sailStep = goal.id, 0 end
  sailStep = sailStep % #words + 1
  if sailStep == 1 then g_game.talk(words[1]) else npcMessage(words[sailStep]) end
end

local function playerNamed(p, name)
  for _, c in ipairs(g_map.getSpectators(p:getPosition(), false)) do
    if c:isPlayer() and c:getName() == name then return c end
  end
end

local function followFriend(p, goal)
  local friend = playerNamed(p, goal.name)
  if not friend then return end
  local following = g_game.getFollowingCreature()
  if not following or following:getId() ~= friend:getId() then g_game.follow(friend) end
end

-- Trade goes through the same window a person uses: sell what she buys, then buy the list.
local function doTrade(p, goal)
  if tradeGoal ~= goal.id then
    tradeGoal, tradeGreeted = goal.id, false
  end
  if not trade then
    if now() - lastUse >= TRADE_ASK_MS then
      lastUse = now()
      -- The town's own merchants want a greeting first and then talk on the NPC channel.
      if goal.greet and not tradeGreeted then
        tradeGreeted = true
        g_game.talk("hi")
      elseif goal.greet then
        npcMessage("trade")
      else
        g_game.talk("trade")
      end
    end
    return
  end
  if not trade.money or now() - trade.last < TRADE_STEP_MS then return end
  trade.last = now()
  for _, want in ipairs(goal.buy or {}) do trade.sold[want.id] = true end -- what was just bought stays bought
  for _, offer in pairs(trade.items) do
    local id = offer[1]:getId()
    if offer[5] > 0 and (trade.goods[id] or 0) > 0 and not trade.sold[id] then
      trade.sold[id] = true
      g_game.sellItem(offer[1], trade.goods[id], true)
      return
    end
  end
  for _, want in ipairs(goal.buy or {}) do
    if not trade.bought[want.id] then
      trade.bought[want.id] = true
      local missing = want.count - p:getInventoryCount(want.id, 0)
      for _, offer in pairs(trade.items) do
        if offer[1]:getId() == want.id and offer[4] > 0 then
          local amount = math.min(missing, math.floor(trade.money / offer[4]), 100)
          if amount > 0 then
            g_game.buyItem(offer[1], amount, false, false)
            return
          end
        end
      end
    end
  end
  g_game.closeNpcTrade()
  event("trade_done", { money = trade.money })
  trade = nil
end

-- Locker, chest, first box: each opens inside the previous window, then items are moved in.
local function endDepot(stored, ok)
  for _, container in pairs(g_game.getContainers()) do g_game.close(container) end
  event("depot_done", { stored = stored, taken = depot.taken or 0, ok = ok })
  depot = nil
end

local function doDepot(p, goal)
  depot = depot or { id = goal.id, startedAt = now(), stored = 0 }
  if now() - depot.startedAt > DEPOT_GIVE_UP_MS then return endDepot(depot.stored, false) end
  if now() - lastUse < USE_MS then return end
  if not depot.bag then
    lastUse = now()
    g_game.open(p:getInventoryItem(InventorySlotBack))
    return
  end
  if not depot.box then
    useThing(p, { x = goal.x, y = goal.y, z = goal.z }, function(thing) g_game.use(thing) end)
    return
  end
  for _, want in ipairs(goal.withdraw or {}) do
    depot.taken = depot.taken or 0
    for slot = 0, depot.box:getItemsCount() - 1 do
      local item = depot.box:getItem(slot)
      local worth = item and item:getId() == PLATINUM and want.id == GOLD and 100 or 1
      if depot.taken < want.count and item and (item:getId() == want.id or worth == 100) then
        -- Coins lie in several stacks, the first may be a handful, and a hundred gold is one platinum.
        local amount = math.min(item:getCount(), math.ceil((want.count - depot.taken) / worth))
        lastUse = now()
        depot.taken = depot.taken + amount * worth
        g_game.move(item, { x = 65535, y = 64 + depot.bag:getId(), z = 0 }, amount)
        return
      end
    end
  end
  for slot = depot.bag:getItemsCount() - 1, 0, -1 do
    local item = depot.bag:getItem(slot)
    for _, id in ipairs(goal.deposit or {}) do
      if item and item:getId() == id then
        lastUse = now()
        if id == GOLD or id == PLATINUM then depot.stored = depot.stored + item:getCount() * (id == PLATINUM and 100 or 1) end
        g_game.move(item, { x = 65535, y = 64 + depot.box:getId(), z = 0 }, item:getCount())
        return
      end
    end
  end
  endDepot(depot.stored, true)
end

local function onDepotWindow(container)
  local id = container:getContainerItem():getId()
  if id >= LOCKER_MIN and id <= LOCKER_MAX or id == DEPOT_CHEST then
    local wanted = id == DEPOT_CHEST and DEPOT_BOX or DEPOT_CHEST
    for slot = 0, container:getItemsCount() - 1 do
      local item = container:getItem(slot)
      if item and item:getId() == wanted then return g_game.open(item, container) end
    end
  elseif id == DEPOT_BOX then
    depot.box = container
  else
    depot.bag = container
  end
end

local function act(p)
  local goal = orders.goal
  if goal.type ~= "follow" and g_game.isFollowing() then g_game.cancelFollow() end
  if goal.type == "goto" then
    walkTowards(p, goal)
  elseif goal.type == "floor" then
    changeFloor(p, goal)
  elseif goal.type == "door" then
    openDoor(p, goal)
  elseif goal.type == "follow" then
    followFriend(p, goal)
  elseif goal.type == "sail" then
    doTalk(p, goal, { "hi", goal.word, "yes" })
  elseif goal.type == "talk" then
    doTalk(p, goal, goal.words)
  elseif goal.type == "trade" then
    doTrade(p, goal)
  elseif goal.type == "depot" then
    doDepot(p, goal)
  elseif goal.type == "explore" or goal.type == "hunt" then
    wander(p)
  end
end

local function fight(p, hp)
  local goal = orders.goal
  local foes = hostiles(p)
  local nearest = foes[1]
  -- Attacking a person is the mind's choice; the secure mode only comes off for that.
  local enemy = orders.pvp and playerNamed(p, orders.pvp)
  if enemy then
    if not safeFightOff then
      safeFightOff = true
      g_game.setSafeFight(false)
    end
    nearest = { c = enemy, d = gap(enemy:getPosition(), p:getPosition()) }
  elseif safeFightOff then
    safeFightOff = false
    g_game.setSafeFight(true)
    if g_game.isAttacking() then g_game.cancelAttack() end
  end
  if goal.flee or hp < cfg.reflexes.fleeAt then
    if g_game.isAttacking() then g_game.cancelAttack() end
    return false
  end
  if not nearest or nearest.d > 7 or goal.avoid then return false end
  local target = g_game.getAttackingCreature()
  if not target then
    -- The server may refuse a target again and again: this counts as trying, not as a new fight.
    if chase.id ~= nearest.c:getId() then
      chase = { id = nearest.c:getId(), hp = nearest.c:getHealthPercent(), atMs = now() }
    elseif now() - chase.atMs > GIVE_UP_MS then
      ignored[chase.id] = now() + IGNORE_MS
      chase = { id = 0, hp = 0, atMs = 0 }
      return false
    end
    g_game.setFightMode(FightOffensive)
    g_game.setChaseMode((cfg.vocation == "knight" or p:getInventoryCount(ARROW, 0) == 0) and ChaseOpponent or DontChase)
    g_game.attack(nearest.c)
    return true
  end
  -- A monster behind a wall can be targeted forever; a person gives up and moves on.
  if chase.id ~= target:getId() or chase.hp ~= target:getHealthPercent() then
    chase = { id = target:getId(), hp = target:getHealthPercent(), atMs = now() }
  elseif now() - chase.atMs > GIVE_UP_MS then
    ignored[target:getId()] = now() + IGNORE_MS
    g_game.cancelAttack()
    return false
  end
  lastTargetPos = target:getPosition()
  local distance = gap(lastTargetPos, p:getPosition())
  for _, id in ipairs(orders.runes or {}) do
    if distance <= 6 and p:getInventoryCount(id, 0) > 0 then
      if now() - lastSpell >= SPELL_COOLDOWN_MS then
        lastSpell = now()
        g_game.useInventoryItemWith(id, target, 0)
      end
      return true
    end
  end
  local spell = orders.attackSpell or cfg.attackSpell
  if spell and distance <= 4 and p:getMana() >= (orders.attackMana or 12) then cast(spell) end
  return true
end

-- Corpses are opened like a person does, and only what is worth the weight is taken.
local function takeLoot()
  -- A full backpack refuses everything; a person closes the corpse and walks on.
  lootMoves = lootMoves + 1
  if lootMoves > MAX_LOOT_MOVES then
    g_game.close(corpse)
    corpse, lootAt, lootMoves = nil, nil, 0
    event("loot_stuck", {})
    return
  end
  for slot = corpse:getItemsCount() - 1, 0, -1 do
    local item = corpse:getItem(slot)
    if item and (KEEP[item:getId()] or keep[item:getId()]) and me():getFreeCapacity() >= MIN_CAP_TO_LOOT then
      g_game.move(item, BACKPACK, item:getCount())
      return
    end
  end
  g_game.close(corpse)
  corpse, lootAt, lootMoves = nil, nil, 0
end

local function loot(p)
  if corpse then
    takeLoot()
    return true
  end
  if not lootAt then return false end
  if now() > lootUntil then
    lootAt = nil
    return false
  end
  if gap(p:getPosition(), lootAt) > 1 then
    walkTowards(p, lootAt)
    return true
  end
  if now() - lastUse >= USE_MS then
    local tile = g_map.getTile(lootAt)
    local thing = tile and tile:getTopUseThing()
    if thing and thing:isContainer() then
      lastUse = now()
      g_game.open(thing)
    end
  end
  return true
end

-- Who shoots keeps away: step back from what is too close, walk up to what is out of reach.
local function keepRange(p, foes)
  local reach = RANGE[cfg.vocation]
  local nearest = foes[1]
  if not reach or not nearest or p:isAutoWalking() or now() - lastKite < KITE_MS then return end
  local here = p:getPosition()
  local target = g_game.getAttackingCreature()
  if target and gap(target:getPosition(), here) > reach then
    lastKite = now()
    walkTowards(p, target:getPosition())
    return
  end
  if nearest.d > KITE_AT then return end
  lastKite = now()
  local best, bestScore = nil, nearest.d
  for dx = -3, 3 do
    for dy = -3, 3 do
      local to = { x = here.x + dx, y = here.y + dy, z = here.z }
      local tile = g_map.getTile(to)
      if tile and tile:isWalkable() and tile:isPathable() then
        local score = 99
        for _, foe in ipairs(foes) do score = math.min(score, gap(foe.c:getPosition(), to)) end
        if score > bestScore then best, bestScore = to, score end
      end
    end
  end
  if best then p:autoWalk(best) end
end

local function flee(p)
  local foes = hostiles(p)
  local nearest = foes[1]
  if not nearest or nearest.d > 6 then return false end
  local here, from = p:getPosition(), nearest.c:getPosition()
  local dx, dy = here.x - from.x, here.y - from.y
  dx, dy = dx == 0 and 0 or dx / math.abs(dx), dy == 0 and 0 or dy / math.abs(dy)
  walkTowards(p, { x = here.x + dx * 12, y = here.y + dy * 12, z = here.z })
  return true
end

-- Private talk goes through the console like a person's: the partner's tab comes to the front and
-- the line shows up in it. The local channel takes the front back when speaking aloud.
local function openTab(name)
  local console = modules.game_console
  return pcall(function() console.addTab(name, true) end)
end

local function privateMessage(name, text)
  local console = modules.game_console
  local ok = openTab(name) and pcall(function() console.sendMessage(text, console.getTab(name)) end)
  if not ok then g_game.talkPrivate(MessageModes.PrivateTo, name, text) end
end

local function localMessage(text)
  pcall(function()
    local console = modules.game_console
    console.consoleTabBar:selectTab(console.defaultTab)
  end)
  g_game.talk(text)
end

-- Speech comes with a typing delay: an instant reply is the first thing that gives a bot away.
local function speak()
  for _, line in ipairs(orders.say or {}) do
    if not said[line.id] and (line.atMs or 0) <= os.time() * 1000 then
      said[line.id] = true
      -- Orders outlive a restart of the client; what was meant for then is not said now.
      if os.time() * 1000 - (line.atMs or 0) <= SAY_FRESH_MS then
        if line.to then privateMessage(line.to, line.text) else localMessage(line.text) end
        return
      end
    end
  end
end

local function vipList()
  local list = {}
  for _, vip in pairs(vips) do list[#list + 1] = { name = vip.name, online = vip.online } end
  return list
end

local function wornGear(p)
  local worn = {}
  for _, slot in ipairs(SLOTS) do
    local item = p:getInventoryItem(slot)
    worn[tostring(slot)] = item and item:getId() or 0
  end
  return worn
end

local function ownedGear(p)
  local have = {}
  for _, want in ipairs(orders.wear or {}) do have[tostring(want.id)] = p:getInventoryCount(want.id, 0) end
  return have
end

local function snapshot(p)
  local here = p:getPosition()
  local seen = {}
  for _, c in ipairs(g_map.getSpectators(here, false)) do
    if c ~= p then
      local at = c:getPosition()
      seen[#seen + 1] = { name = c:getName(), kind = c:isMonster() and "monster" or c:isPlayer() and "player" or "npc", hp = c:getHealthPercent(), x = at.x, y = at.y, z = at.z }
    end
  end
  local target = g_game.getAttackingCreature()
  write("state.json", json.encode({
    atMs = os.time() * 1000, online = true, name = p:getName(), level = p:getLevel(), experience = p:getExperience(),
    hp = p:getHealth(), hpMax = p:getMaxHealth(), mana = p:getMana(), manaMax = p:getMaxMana(), cap = p:getFreeCapacity(),
    x = here.x, y = here.y, z = here.z, walking = p:isAutoWalking(), target = target and target:getName() or "",
    potions = { health = owned(p, POTIONS.health), mana = owned(p, POTIONS.mana) },
    magicLevel = p:getMagicLevel(),
    gold = p:getInventoryCount(GOLD, 0) + p:getInventoryCount(PLATINUM, 0) * 100,
    vocation = cfg.vocation,
    arrows = p:getInventoryCount(ARROW, 0),
    food = p:getInventoryCount(MEAT, 0),
    vips = vipList(),
    worn = wornGear(p),
    have = ownedGear(p),
    seen = seen, goalId = orders.goal.id or 0,
  }))
end

local function readOrders()
  local text = read("orders.json")
  if not text or text == "" then return end
  local ok, parsed = pcall(json.decode, text)
  if ok and type(parsed) == "table" and type(parsed.goal) == "table" then
    orders = parsed
    keep = {}
    for _, id in ipairs(parsed.keep or {}) do keep[id] = true end
  end
end

-- A kit is a declared developer exception and the world gives it once.
local function askForKit()
  local f = io.open(cfg.controlDir .. "dev-kit.request", "wb")
  if f then
    f:write(cfg.character .. "," .. cfg.kit .. (kitRefresh and ",refresh" or ""))
    f:close()
  end
  kitAsked, kitRefresh = true, false
end

-- Wears what the character owns. The server toggles: on when in the bag, off when in hand. A bow
-- without arrows does nothing, so it goes away and fists do the work until the next shop.
local function wearGear(p)
  if now() - lastEquip < EQUIP_MS then return end
  local arrows = p:getInventoryCount(ARROW, 0)
  for _, want in ipairs(orders.wear or {}) do
    local held = p:getInventoryItem(want.slot)
    if want.id == BOW and arrows == 0 then
      if held and held:getId() == BOW then
        lastEquip = now()
        g_game.equipItemId(BOW, 0)
        return
      end
    elseif (not held or held:getId() ~= want.id) and (want.bought or p:getInventoryCount(want.id, 0) > 0) then
      -- Something better was bought: equipping swaps it with what is worn.
      lastEquip = now()
      g_game.equipItemId(want.id, 0)
      return
    end
  end
  -- Bows draw only from the quiver, and shop arrows land in the backpack.
  if cfg.vocation == "paladin" and arrows > 0 and now() - lastArrows >= ARROWS_MS then
    lastArrows = now()
    g_game.equipItemId(ARROW, 0)
  end
end

-- Friends go on the VIP list once the server has sent the current one.
local function addFriends()
  if enteredAt == 0 then
    enteredAt = now()
    -- The client starts with secure mode off, and then area spells hit bystanders.
    safeFightOff = false
    g_game.setSafeFight(true)
  end
  if vipsAdded or now() - enteredAt < VIP_DELAY_MS then return end
  vipsAdded = true
  local known = {}
  for _, vip in pairs(vips) do known[vip.name] = true end
  for _, name in ipairs(cfg.friends or {}) do
    if not known[name] then g_game.addVip(name) end
  end
end

-- People this character came to like join the list one at a time, as the mind names them.
local function hideLoginWindow()
  if loginHidden then return end
  loginHidden = true
  if EnterGame and EnterGame.hide then pcall(EnterGame.hide) end
end

local function addLikedPeople()
  if not orders.addVip or now() - lastVipAdd < VIP_ADD_MS then return end
  lastVipAdd = now()
  local known = {}
  for _, vip in pairs(vips) do known[vip.name] = true end
  for _, name in ipairs(orders.addVip) do
    if not known[name] then return g_game.addVip(name) end
  end
end

-- After a fight the server refuses a logout for a while; the icons say the same.
local function inFightLock(p)
  local states = p:getStates()
  local has = function(flag) return math.floor(states / flag) % 2 == 1 end
  return has(PlayerStates.Swords) or has(PlayerStates.PzBlock)
end

-- A party shares experience. The mind says who with; the shields tell how far it has got.
local function keepParty(p)
  local want = orders.party
  if now() - lastParty < PARTY_MS then return end
  lastParty = now()
  if not want then
    if p:getShield() ~= ShieldNone then g_game.partyLeave() end
    return
  end
  local friend = playerNamed(p, want.name)
  if not friend then return end
  local theirs = friend:getShield()
  if want.lead then
    if theirs == ShieldNone then
      g_game.partyInvite(friend:getId())
    elseif theirs == ShieldBlue then
      g_game.partyShareExperience(true)
    end
  elseif theirs == ShieldWhiteYellow then
    g_game.partyJoin(friend:getId())
  end
end

local function tick()
  tickEvent = scheduleEvent(tick, TICK_MS)
  if relogging then return end
  if not g_game.isOnline() or not me() then
    -- Kicked for idling or cut off: a person logs back in.
    if playedOnce then
      offlineAt = offlineAt or now()
      if now() - offlineAt > OFFLINE_MS then
        offlineAt = nil
        comeBack()
      end
    end
    return
  end
  offlineAt, playedOnce, comeBackTries = nil, true, 0
  local p = me()
  if now() - lastTurn > AWAKE_MS then
    lastTurn = now()
    g_game.turn(math.random(0, 3))
  end
  addFriends()
  addLikedPeople()
  hideLoginWindow()
  wearGear(p)
  keepParty(p)
  if orders.rest and orders.rest.id ~= lastRest and not inFightLock(p) then
    lastRest = orders.rest.id
    takeBreak(orders.rest.seconds)
    return
  end
  if orders.needKit and orders.needKit ~= lastKitOrder then
    lastKitOrder = orders.needKit
    kitRefresh = true
    askForKit()
  end
  if not kitAsked and cfg.kit then askForKit() end
  local ok, err = pcall(function()
    local hp = heal(p)
    readOrders()
    eat(p)
    speak()
    local fighting = fight(p, hp)
    if fighting then keepRange(p, hostiles(p)) end
    if (orders.goal.flee or hp < cfg.reflexes.fleeAt) and flee(p) then
      lastMoveAt = now()
    elseif not fighting then
      local here = p:getPosition()
      if not lastPos or here.x ~= lastPos.x or here.y ~= lastPos.y or here.z ~= lastPos.z then
        lastPos, lastMoveAt = here, now()
      elseif now() - lastMoveAt > STUCK_MS and p:isAutoWalking() then
        p:stopAutoWalk()
        lastMoveAt = now()
      end
      if not loot(p) then act(p) end
    end
    if now() - lastState >= STATE_MS then
      lastState = now()
      snapshot(p)
    end
  end)
  if not ok then event("adapter_error", { error = tostring(err):sub(1, 200) }) end
end

-- Login and return after death --------------------------------------------------------------------
local function enterWorld()
  local list = rootWidget:recursiveGetChildById("characters")
  if not list then return end
  for _, w in ipairs(list:getChildren()) do
    if w.characterName == cfg.character then
      list:focusChild(w, KeyboardFocusReason)
      CharacterList.doLogin()
      return
    end
  end
end

local function login()
  local bot = g_modules.getModule("game_bot")
  if bot and bot:isLoaded() then bot:unload() end
  EnterGame.setDefaultServer(cfg.host, cfg.port, cfg.version)
  rootWidget:recursiveGetChildById("accountNameTextEdit"):setText(cfg.email)
  rootWidget:recursiveGetChildById("accountPasswordTextEdit"):setText(cfg.password)
  EnterGame.setHttpLogin(true)
  EnterGame.doLogin()
  local function wait()
    if CharacterList.isVisible() then return enterWorld() end
    scheduleEvent(wait, 500)
  end
  wait()
end

local function relog()
  relogging = true
  local function wait()
    if g_game.isOnline() then
      g_game.forceLogout()
      return scheduleEvent(wait, 1000)
    end
    relogging = false
    vipsAdded, enteredAt = false, 0
    CharacterList.show()
    scheduleEvent(enterWorld, 1500)
  end
  scheduleEvent(wait, 3000)
end

-- The list of characters is enough most of the time; after a longer cut the whole login is repeated.
comeBack = function()
  comeBackTries = comeBackTries + 1
  vipsAdded, enteredAt = false, 0
  event("came_back", { tries = comeBackTries })
  if comeBackTries % 2 == 1 and pcall(CharacterList.show) then
    scheduleEvent(enterWorld, 1500)
  else
    login()
  end
end

-- People leave for a while and come back. Logging out in a fight is refused, so it is tried again.
takeBreak = function(seconds)
  relogging = true
  local tries = 0
  local function leave()
    if g_game.isOnline() then
      tries = tries + 1
      if tries > BREAK_TRIES then
        relogging = false -- the server said no: the break is off, the character stays in play
        return
      end
      g_game.safeLogout()
      return scheduleEvent(leave, 3000)
    end
    scheduleEvent(function()
      relogging = false
      vipsAdded, enteredAt = false, 0
      CharacterList.show()
      scheduleEvent(enterWorld, 1500)
    end, seconds * 1000)
  end
  leave()
end

-- Runs at start, before anything is written, so a mind reading the old file only meets its end.
local function rotateEvents()
  local f = io.open(dir .. "events.jsonl", "rb")
  if not f then return end
  local size = f:seek("end")
  f:close()
  if size < EVENTS_MAX_BYTES then return end
  os.remove(dir .. "events.jsonl.1")
  os.rename(dir .. "events.jsonl", dir .. "events.jsonl.1")
end

function A.init()
  local options = g_app.getStartupOptions() or ""
  dir = options:match("%-%-agent%-dir=(%S+)")
  if not dir then return end
  local text = read("login.json")
  if not text then return end
  cfg = json.decode(text)
  eventSession = tostring(os.time()) .. "-" .. tostring(math.random(100000, 999999))
  rotateEvents()
  handlers.onTalk = function(name, level, mode, message, channelId, pos)
    if not me() or name == me():getName() or mode == MessageModes.MonsterSay or mode == MessageModes.MonsterYell then return end
    local private = mode == MessageModes.PrivateFrom
    event("heard", { from = name, text = message, level = level, private = private })
    -- A person clicks over to the tab that lit up before answering.
    if private then scheduleEvent(function() openTab(name) end, math.random(800, 2200)) end
  end
  handlers.onOpenNpcTrade = function(items)
    trade = { items = items, goods = {}, sold = {}, bought = {}, last = 0 }
  end
  handlers.onPlayerGoods = function(money, goods)
    if not trade then return end
    trade.money, trade.goods = money, {}
    for _, good in pairs(goods) do
      local id = good[1]:getId()
      trade.goods[id] = (trade.goods[id] or 0) + good[2]
    end
  end
  handlers.onCloseNpcTrade = function() trade = nil end
  handlers.onAddVip = function(id, name, state)
    vips[id] = { name = name, online = state == VipState.Online }
  end
  handlers.onVipStateChange = function(id, state)
    local vip = vips[id]
    local online = state == VipState.Online
    if vip and vip.online ~= online then
      vip.online = online
      event("vip", { from = vip.name, online = online })
    end
  end
  handlers.onTextMessage = function(mode, message)
    -- Raids and other announcements: red for everyone, or white and not about this character.
    local announced = mode == MessageModes.Warning or (mode == MessageModes.Game and not message:find("^You") and not message:find("^Using"))
    event("message", { text = message, broadcast = announced, mode = mode })
    if message:find("Loot of", 1, true) and not message:find(": nothing", 1, true) and lastTargetPos then
      lootAt, lootUntil = lastTargetPos, now() + LOOT_MS
    end
  end
  handlers.onDeath = function()
    event("death", {})
    relog()
  end
  connect(g_game, handlers)
  handlers.container = { onOpen = function(container)
    if depot then onDepotWindow(container)
    elseif lootAt then corpse = container end
  end }
  connect(Container, handlers.container)
  scheduleEvent(login, 3000)
  tickEvent = scheduleEvent(tick, 4000)
end

function A.terminate()
  if handlers.onTalk then
    disconnect(Container, handlers.container)
    handlers.container = nil
    disconnect(g_game, handlers)
  end
  if tickEvent then removeEvent(tickEvent) end
end
