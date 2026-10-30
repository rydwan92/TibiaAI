-- Conversation scenario, driven through the real client: walk to the NPC, say each configured line
-- the way a person types it, wait for the NPC's answer and check the last answer. The checks read
-- only what the client received from the server.
local T = TibiaAIAutotest

local function me() return g_game.getLocalPlayer() end

local function npcCreature()
  for _, c in ipairs(g_map.getSpectators(me():getPosition(), false)) do
    if c:getName():lower() == T.cfg.npc:lower() then return c end
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

local function sayLines()
  local idx = 0
  local function nextLine()
    idx = idx + 1
    local line = T.cfg.lines[idx]
    if not line then return finishConversation() end
    T.heard = {}
    local sentAt = g_clock.millis()
    T.log("say[%d] %s", idx, line)
    g_game.talk(line)
    T.poll(function() return #T.heard > 0 end, 20000, function()
      T.result("reply_" .. idx, true, string.format("%d ms: %s", g_clock.millis() - sentAt, T.heard[1]))
      if idx == #T.cfg.lines then checkLast(T.heard[1]) end
      scheduleEvent(nextLine, 2500)
    end, function()
      T.result("reply_" .. idx, false, "no reply in 20 s to: " .. line)
      finishConversation()
    end)
  end
  nextLine()
end

function T.conversationTalk()
  T.exclusive = true -- input from the open window must not add speech or steps to this test
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
