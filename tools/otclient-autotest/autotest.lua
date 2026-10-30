-- Real-client smoke test: runs inside OTClient and drives the same code paths as a person:
-- login form -> HTTP login -> character list -> game server -> walk -> speech -> logout -> relogin.
-- Results are logged as "[AUTOTEST] ..." lines in otclient.log; scripts\client-autotest.ps1 reads them.
TibiaAIAutotest = {}
local T = TibiaAIAutotest

local cfg
local handlers = {}
local stepTimeout

local function log(fmt, ...)
  g_logger.info("[AUTOTEST] " .. string.format(fmt, ...))
end
T.log = log

local function result(name, ok, detail)
  log("%s %s %s", ok and "PASS" or "FAIL", name, detail or "")
end
T.result = result

local function finish()
  log("DONE")
  scheduleEvent(function() g_app.exit() end, 500)
end
T.finish = finish

-- Ask the server-side scenario controller for something (runtime/control, like scripts/*.ps1).
function T.request(name, arg)
  local f = io.open(cfg.controlDir .. name, "wb")
  if f then
    f:write(arg or "")
    f:close()
  end
  log("request %s %s", name, arg or "")
end

local function poll(cond, timeoutMs, onOk, onTimeout)
  local deadline = g_clock.millis() + timeoutMs
  local function check()
    local ok, value = pcall(cond)
    if ok and value then return onOk(value) end
    if g_clock.millis() > deadline then return onTimeout() end
    scheduleEvent(check, 200)
  end
  check()
end
T.poll = poll

local function posText(p) return p and string.format("%d,%d,%d", p.x, p.y, p.z) or "?" end
T.posText = posText

local function distance(a, b)
  if a.z ~= b.z then return 999 end
  return math.max(math.abs(a.x - b.x), math.abs(a.y - b.y))
end

local function creatureNamed(name)
  local player = g_game.getLocalPlayer()
  for _, c in ipairs(g_map.getSpectators(player:getPosition(), false)) do
    if c:getName():lower() == name:lower() then return c end
  end
end

-- Step 1: fill the login form exactly like a user and press Login.
local function stepLogin()
  -- OTClient's bundled bot (mods/game_bot) can walk, heal and retarget on its own; results must
  -- come from this script only. It loads late, so unload it here rather than in init.
  local bot = g_modules.getModule("game_bot")
  log("game_bot: found=%s loaded=%s", tostring(bot ~= nil), tostring(bot and bot:isLoaded()))
  if bot and bot:isLoaded() then
    bot:unload()
    log("game_bot after unload: loaded=%s", tostring(bot:isLoaded()))
  end
  log("login form: server=%s port=%d version=%d", cfg.host, cfg.port, cfg.version)
  local ok, err = pcall(function()
    EnterGame.setDefaultServer(cfg.host, cfg.port, cfg.version)
    -- EnterGame.setAccountName/setPassword expect encrypted settings values; type into the fields.
    rootWidget:recursiveGetChildById('accountNameTextEdit'):setText(cfg.email)
    rootWidget:recursiveGetChildById('accountPasswordTextEdit'):setText(cfg.password)
    EnterGame.setHttpLogin(true)
    local failed, succeeded = EnterGame.loginFailed, EnterGame.loginSuccess
    EnterGame.loginFailed = function(id, msg, code)
      log("loginFailed: %s (%s)", tostring(msg), tostring(code))
      return failed(id, msg, code)
    end
    EnterGame.loginSuccess = function(id, ...)
      log("loginSuccess (request %s, expected %s)", tostring(id), tostring(G.requestId))
      local res = { pcall(succeeded, id, ...) }
      if not res[1] then log("loginSuccess handler error: %s", tostring(res[2])) end
    end
    log("form state: account length %d, version box %s", #rootWidget:recursiveGetChildById('accountNameTextEdit'):getText(),
      tostring(rootWidget:recursiveGetChildById('clientComboBox'):getText()))
    EnterGame.doLogin()
  end)
  if not ok then log("login step error: %s", tostring(err)) end
  poll(function() return CharacterList.isVisible() end, 20000, T.stepSelectCharacter, function()
    result("http_login", false, "character list did not appear")
    finish()
  end)
end

function T.stepSelectCharacter()
  result("http_login", true, "character list visible")
  local list = rootWidget:recursiveGetChildById("characters")
  local chosen
  for _, w in ipairs(list:getChildren()) do
    if w.characterName == cfg.character then chosen = w end
  end
  if not chosen then
    result("character_select", false, "no " .. cfg.character)
    return finish()
  end
  list:focusChild(chosen, KeyboardFocusReason)
  result("character_select", true, cfg.character .. " world=" .. tostring(chosen.worldHost) .. ":" .. tostring(chosen.worldPort))
  CharacterList.doLogin()
  poll(function() return g_game.isOnline() and g_game.getLocalPlayer() and g_game.getLocalPlayer():getPosition().x > 0 end, 20000,
    T.stepInWorld, function()
      result("enter_world", false, "not online after 20 s")
      finish()
    end)
end

function T.stepInWorld()
  local p = g_game.getLocalPlayer()
  if T.relogin then
    result("relogin", true, "pos " .. posText(p:getPosition()))
    return scheduleEvent(function() g_game.safeLogout(); finish() end, 1000)
  end
  result("enter_world", true, string.format("%s pos %s hp %d/%d", p:getName(), posText(p:getPosition()), p:getHealth(), p:getMaxHealth()))
  local first = { combat = T.combatStart, conversation = T.stepRoute }
  scheduleEvent(first[cfg.scenario] or T.stepWalkOnce, 1500)
end

-- Step 2: a plain keyboard-style step, trying each direction until the server accepts one.
function T.stepWalkOnce()
  local p = g_game.getLocalPlayer()
  local dirs = { South, West, North, East }
  local i = 0
  local start = p:getPosition()
  local function try()
    i = i + 1
    if i > #dirs then
      result("walk", false, "no direction moved from " .. posText(start))
      return T.stepRoute()
    end
    g_game.walk(dirs[i])
    scheduleEvent(function()
      local now = g_game.getLocalPlayer():getPosition()
      if now.x ~= start.x or now.y ~= start.y then
        result("walk", true, posText(start) .. " -> " .. posText(now))
        T.stepRoute()
      else
        try()
      end
    end, 900)
  end
  try()
end

-- Step 3: walk the configured waypoints with the client's own autowalk.
function T.stepRoute()
  local idx = 0
  local afterRoute = cfg.scenario == "conversation" and T.conversationTalk or T.stepGreet
  local function nextLeg()
    idx = idx + 1
    local target = cfg.route[idx]
    if not target then
      result("route", true, "reached " .. posText(g_game.getLocalPlayer():getPosition()))
      return afterRoute()
    end
    local deadline = g_clock.millis() + 30000
    local function walkLeg()
      local p = g_game.getLocalPlayer()
      if distance(p:getPosition(), target) <= 1 then return nextLeg() end
      if g_clock.millis() > deadline then
        result("route", false, "stuck at " .. posText(p:getPosition()) .. " towards " .. posText(target))
        return afterRoute()
      end
      if not p:isAutoWalking() then p:autoWalk(target) end
      scheduleEvent(walkLeg, 400)
    end
    walkLeg()
  end
  nextLeg()
end

-- Step 4: wait until the NPC is in greeting range, say the word and capture the reply.
function T.stepGreet()
  poll(function()
    local c = creatureNamed(cfg.npc)
    return c and distance(c:getPosition(), g_game.getLocalPlayer():getPosition()) <= cfg.greetRange and c
  end, 40000, function(c)
    result("npc_visible", true, string.format("%s at %s outfit %d", c:getName(), posText(c:getPosition()), c:getOutfit().type))
    T.heard = {}
    g_app.doScreenshot("tibiaai_autotest.png")
    g_game.talk(cfg.greeting)
    poll(function() return #T.heard > 0 end, 8000, function()
      result("npc_reply", true, T.heard[1])
      T.stepObserve()
    end, function()
      result("npc_reply", false, "no reply in 8 s")
      T.stepObserve()
    end)
  end, function()
    result("npc_visible", false, cfg.npc .. " not in range; spectators: " .. tostring(#g_map.getSpectators(g_game.getLocalPlayer():getPosition(), false)))
    T.stepObserve()
  end)
end

-- Step 5: collect any further speech for a while (rumors, alarm text), then log out and back in.
function T.stepObserve()
  scheduleEvent(function()
    for i, line in ipairs(T.heard or {}) do log("heard[%d] %s", i, line) end
    T.relogin = true
    g_game.safeLogout()
    poll(function() return not g_game.isOnline() end, 15000, function()
      scheduleEvent(function()
        CharacterList.show()
        poll(function() return CharacterList.isVisible() end, 5000, T.stepSelectCharacter, function()
          result("relogin", false, "character list not shown")
          finish()
        end)
      end, 1500)
    end, function()
      result("logout", false, "still online")
      finish()
    end)
  end, cfg.observeMs)
end

-- Logs every game action with its Lua caller and, while T.exclusive is set, drops actions that do
-- not come from this test (mouse or keyboard in the open window), so results stay reproducible.
local function traceActions()
  local seen = {}
  for _, name in ipairs({ "walk", "talk", "useInventoryItemWith", "useInventoryItem", "useWith", "use", "setFightMode", "setChaseMode", "attack", "follow", "cancelAttack" }) do
    local original = g_game[name]
    if original then
      g_game[name] = function(...)
        local where = debug.traceback("", 2):gsub("%s+", " "):sub(1, 220)
        local key = name .. where
        local ours = where:find("tibiaai_autotest", 1, true) ~= nil
        if not seen[key] then
          seen[key] = true
          log("action %s%s from%s", name, (T.exclusive and not ours) and " BLOCKED" or "", where)
        end
        if T.exclusive and not ours then return end
        return original(...)
      end
    end
  end
end

function T.init()
  cfg = dofile("config")
  T.cfg = cfg
  traceActions()
  handlers.onTalk = function(name, level, mode, text, channelId, pos)
    if T.heard and name:lower() == cfg.npc:lower() then
      T.heard[#T.heard + 1] = text
      log("talk %s: %s", name, text)
    end
  end
  handlers.onTextMessage = function(mode, text)
    if T.messages then T.messages[#T.messages + 1] = text end
  end
  handlers.onDeath = function(deathType, penalty)
    T.dead = true
    log("death message: type %s penalty %s", tostring(deathType), tostring(penalty))
  end
  handlers.onLoginError = function(msg) log("login error: %s", tostring(msg)) end
  handlers.onConnectionError = function(msg, code) log("connection error: %s (%s)", tostring(msg), tostring(code)) end
  connect(g_game, handlers)
  stepTimeout = scheduleEvent(function()
    log("timeout: test exceeded %d s", cfg.timeoutSec)
    finish()
  end, cfg.timeoutSec * 1000)
  scheduleEvent(stepLogin, 3000)
end

function T.terminate()
  if handlers.onTalk then disconnect(g_game, handlers) end
  if stepTimeout then removeEvent(stepTimeout) end
end
