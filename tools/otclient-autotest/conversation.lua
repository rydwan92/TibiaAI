-- Conversation scenario, driven through the real client: walk to the NPC, say each configured line
-- the way a person types it, wait for the NPC's answer and check the last answer. The checks read
-- only what the client received from the server.
local T = TibiaAIAutotest

local function me() return g_game.getLocalPlayer() end

local function npcCreature()
  for _, c in ipairs(g_map.getSpectators(me():getPosition(), false)) do
    if T.isNamed(c:getName(), T.cfg.npc) then return c end
  end
end

local function gap(a, b)
  if a.z ~= b.z then return 999 end
  return math.max(math.abs(a.x - b.x), math.abs(a.y - b.y))
end

local function finishConversation()
  for i, line in ipairs(T.heard or {}) do T.log("heard[%d] %s", i, line) end
  g_game.safeLogout()
  T.poll(function() return not g_game.isOnline() end, 15000, T.finish, function()
    T.result("logout", false, "still online")
    T.finish()
  end)
end

local function checkLast(reply)
  local text = reply:lower()
  for _, word in ipairs(T.cfg.expect) do
    T.result("expect_" .. word, text:find(word, 1, true) ~= nil, reply)
  end
  for _, word in ipairs(T.cfg.forbid) do
    T.result("forbid_" .. word, text:find(word, 1, true) == nil, reply)
  end
end

local function heardAny(words)
  for _, line in ipairs(T.heard) do
    for _, word in ipairs(words) do
      if line:lower():find(word, 1, true) then return line end
    end
  end
end

-- Walks after the NPC with the client's own autowalk, trying the tiles next to it.
local function followStep()
  local c, p = npcCreature(), me()
  if not c or p:isAutoWalking() or gap(c:getPosition(), p:getPosition()) <= 1 then return end
  local at = c:getPosition()
  for _, d in ipairs({ { 0, 1 }, { 1, 0 }, { -1, 0 }, { 0, -1 } }) do
    if p:autoWalk({ x = at.x + d[1], y = at.y + d[2], z = at.z }) then return end
  end
end

-- After the last line the test acts out one way a walk with a guide can go, then waits until the
-- NPC says it is over. The real outcome is read from the engine's journal by client-autotest.ps1.
local function walkPhase()
  local cfg = T.cfg
  local startedAt = g_clock.millis()
  local acted = false
  T.heard = {}
  local function step()
    local elapsed = g_clock.millis() - startedAt
    if heardAny(cfg.walkEnd) then
      T.result("walk_end", true, heardAny(cfg.walkEnd))
      return scheduleEvent(finishConversation, 1500)
    end
    if elapsed > cfg.walkSeconds * 1000 then
      T.result("walk_end", false, "no closing line after " .. cfg.walkSeconds .. " s at " .. T.posText(me():getPosition()))
      return finishConversation()
    end
    if cfg.walk ~= "stay" and not (acted and cfg.walk == "logout") then followStep() end
    if not acted and elapsed > 6000 then
      if cfg.walk == "cancel" then
        acted = true
        T.log("say[cancel] %s", cfg.cancelLine)
        g_game.talk(cfg.cancelLine)
      elseif cfg.walk == "alarm" then
        acted = true
        T.request("alarm-start.request", "thais_gate")
      elseif cfg.walk == "logout" then
        T.log("logging out in the middle of the walk")
        g_game.safeLogout()
        return T.poll(function() return not g_game.isOnline() end, 15000, T.finish, T.finish)
      end
    end
    scheduleEvent(step, 700)
  end
  step()
end

local function sayLines()
  local idx = 0
  local function nextLine()
    idx = idx + 1
    local line = T.cfg.lines[idx]
    if not line then
      if T.cfg.walk ~= "" then return walkPhase() end
      return finishConversation()
    end
    T.heard = {}
    local sentAt = g_clock.millis()
    T.log("say[%d] %s", idx, line)
    g_game.talk(line)
    T.poll(function() return #T.heard > 0 end, 20000, function()
      T.result("reply_" .. idx, true, string.format("%d ms: %s", g_clock.millis() - sentAt, T.heard[1]))
      if idx == #T.cfg.lines then checkLast(T.heard[1]) end
      if idx == 1 and T.cfg.waitFile ~= "" then
        -- A second client: hold until the other player's walk has really started.
        T.log("waiting for %s", T.cfg.waitFile)
        return T.poll(function()
          local f = io.open(T.cfg.waitFile, "rb")
          if f then f:close() end
          return f ~= nil
        end, 60000, nextLine, nextLine)
      end
      -- A long reply takes two chat lines, 3.3 s apart; the next line must not race the second one.
      scheduleEvent(nextLine, 4200)
    end, function()
      T.result("reply_" .. idx, false, "no reply in 20 s to: " .. line)
      finishConversation()
    end)
  end
  nextLine()
end

function T.conversationTalk()
  T.exclusive = true -- input from the open window must not add speech or steps to this test
  if T.cfg.resetTask ~= "" then T.request("dev-reset-task.request", T.cfg.character .. "," .. T.cfg.resetTask) end
  local deadline = g_clock.millis() + 45000
  local function approach()
    local c = npcCreature()
    local p = me()
    if c and gap(c:getPosition(), p:getPosition()) <= T.cfg.greetRange - 1 then
      T.result("npc_near", true, string.format("%s at %s", c:getName(), T.posText(c:getPosition())))
      if T.cfg.incident ~= "" then
        -- Next to the speaker, on the far side from the stall, so only NPCs nearby can see it.
        local at = p:getPosition()
        T.request("incident.request", string.format("%s,%d,%d,%d", T.cfg.incident, at.x - 3, at.y, at.z))
        return scheduleEvent(sayLines, 2500)
      end
      return sayLines()
    end
    if g_clock.millis() > deadline then
      T.result("npc_near", false, T.cfg.npc .. (c and " out of reach" or " not visible") .. " from " .. T.posText(p:getPosition()))
      return finishConversation()
    end
    if c and not p:isAutoWalking() then
      local at = c:getPosition()
      p:autoWalk({ x = at.x, y = at.y + 1, z = at.z })
    end
    scheduleEvent(approach, 600)
  end
  approach()
end
