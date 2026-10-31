-- Body of a player agent, running inside a real client: everything goes through the same packets a
-- person's client sends, so the server applies every rule. Reflexes (healing, fighting, fleeing,
-- walking) live here and never wait for a model. Brain sets the goal through files in --agent-dir:
--   state.json    written here every second: what this character sees and has
--   events.jsonl  appended here: speech heard, server messages, death
--   orders.json   read here: { goal = {...}, say = { { id, text } } }
TibiaAIAgent = {}
local A = TibiaAIAgent

local TICK_MS = 300
local STATE_MS = 1000
local POTIONS = { health = 266, mana = 268 }
local MEAT = 3577
local GOLD = 3031
local BACKPACK = { x = 65535, y = 3, z = 0 }
local PLATINUM = 3035
local KEEP = { [3031] = true, [3035] = true, [3043] = true, [3577] = true, [3582] = true, [3585] = true, [266] = true, [268] = true, [17512] = true }
local MIN_CAP_TO_LOOT = 10
local TRADE_STEP_MS = 700
local TRADE_ASK_MS = 6000
local DEPOT_CHEST = 3502
local DEPOT_BOX = 22797
local LOCKER_MIN, LOCKER_MAX = 3497, 3500
local DEPOT_GIVE_UP_MS = 30000
local LOOT_MS = 12000
local VIP_DELAY_MS = 5000
local ARROW = 3447
local BOW = 3350
local EQUIP_MS = 5000
local SPELL_COOLDOWN_MS = 2100
local POTION_COOLDOWN_MS = 1100
local STUCK_MS = 6000
local USE_MS = 1500
local DIG_MS = 4000
local GIVE_UP_MS = 9000
local IGNORE_MS = 25000

local dir, cfg
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
local lastUse, lastDig, lastEquip = 0, 0, 0
local ignored = {}
local trade, depot
local keep = {}
local safeFightOff = false
local chase = { id = 0, hp = 0, atMs = 0 }
local lastTargetPos, lootAt, lootUntil, corpse = nil, nil, 0, nil
local vips = {}
local vipsAdded = false
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

local function event(kind, fields)
  fields = fields or {}
  fields.kind, fields.atMs = kind, os.time() * 1000
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

local function drink(p, id)
  if now() - lastPotion < POTION_COOLDOWN_MS or p:getInventoryCount(id, 0) == 0 then return false end
  lastPotion = now()
  g_game.useInventoryItemWith(id, p, 0)
  return true
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
    if not drink(p, POTIONS.health) and p:getMana() >= (orders.healMana or 20) then cast(orders.healSpell or cfg.healSpell) end
  end
  if p:getMana() / math.max(p:getMaxMana(), 1) < r.manaAt and hp > r.healAt then drink(p, POTIONS.mana) end
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
      useThing(p, spot, function(thing) g_game.useInventoryItemWith(3457, thing, 0) end)
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
  if not trade then
    if now() - lastUse >= TRADE_ASK_MS then
      lastUse = now()
      g_game.talk("trade")
    end
    return
  end
  if not trade.money or now() - trade.last < TRADE_STEP_MS then return end
  trade.last = now()
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
      if depot.taken < want.count and item and item:getId() == want.id then
        -- Coins lie in several stacks, and the first may be a handful.
        local amount = math.min(item:getCount(), want.count - depot.taken)
        lastUse = now()
        depot.taken = depot.taken + amount
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
        depot.stored = depot.stored + item:getCount()
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
  for slot = corpse:getItemsCount() - 1, 0, -1 do
    local item = corpse:getItem(slot)
    if item and (KEEP[item:getId()] or keep[item:getId()]) and me():getFreeCapacity() >= MIN_CAP_TO_LOOT then
      g_game.move(item, BACKPACK, item:getCount())
      return
    end
  end
  g_game.close(corpse)
  corpse, lootAt = nil, nil
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
      if line.to then privateMessage(line.to, line.text) else localMessage(line.text) end
      return
    end
  end
end

local function vipList()
  local list = {}
  for _, vip in pairs(vips) do list[#list + 1] = { name = vip.name, online = vip.online } end
  return list
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
    potions = { health = p:getInventoryCount(POTIONS.health, 0), mana = p:getInventoryCount(POTIONS.mana, 0) },
    gold = p:getInventoryCount(GOLD, 0) + p:getInventoryCount(PLATINUM, 0) * 100,
    vocation = cfg.vocation,
    arrows = p:getInventoryCount(ARROW, 0),
    food = p:getInventoryCount(MEAT, 0),
    vips = vipList(),
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

-- A bow without arrows does nothing, so it goes away and fists do the work until the next shop.
local function readyWeapon(p)
  if cfg.vocation ~= "paladin" or now() - lastEquip < EQUIP_MS then return end
  local held = p:getInventoryItem(InventorySlotLeft)
  local armed = held and held:getId() == BOW
  local arrows = p:getInventoryCount(ARROW, 0)
  if (arrows == 0 and armed) or (arrows > 0 and not armed) then
    lastEquip = now()
    g_game.equipItemId(BOW, 0) -- the server toggles: on when in the bag, off when in hand
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

local function tick()
  tickEvent = scheduleEvent(tick, TICK_MS)
  if not g_game.isOnline() or not me() or relogging then return end
  local p = me()
  addFriends()
  readyWeapon(p)
  if not kitAsked and cfg.kit then askForKit() end
  local ok, err = pcall(function()
    local hp = heal(p)
    readOrders()
    eat(p)
    speak()
    local fighting = fight(p, hp)
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
    kitAsked, kitRefresh = false, true
    vipsAdded, enteredAt = false, 0
    CharacterList.show()
    scheduleEvent(enterWorld, 1500)
  end
  scheduleEvent(wait, 3000)
end

function A.init()
  local options = g_app.getStartupOptions() or ""
  dir = options:match("%-%-agent%-dir=(%S+)")
  if not dir then return end
  local text = read("login.json")
  if not text then return end
  cfg = json.decode(text)
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
    event("message", { text = message })
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
