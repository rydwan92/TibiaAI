-- In-engine self test of the Lua side (JSON codec, templates, definition validation, command
-- validation). Runs inside Canary's LuaJIT, triggered by runtime/control/selftest.request
-- (scripts/selftest.ps1). Result: journal entry "selftest_result".
local T = TibiaAI

function T.runSelftest()
	local passed, failures = 0, {}
	local function check(name, cond)
		if cond then
			passed = passed + 1
		else
			failures[#failures + 1] = name
		end
	end

	-- JSON
	local obj = { a = 1, b = "x\"y\n", c = { true, false }, d = { e = 1793311404000 } }
	local back = T.json.decode(T.json.encode(obj))
	check("json roundtrip", back and back.a == 1 and back.b == "x\"y\n" and back.c[2] == false and back.d.e == 1793311404000)
	check("json unicode escape", T.json.decode('"\\u0041\\u00f3"') == "A\195\179")
	check("json rejects trailing data", T.json.decode('{"a":1} x') == nil)
	check("json rejects broken input", T.json.decode('{"a":') == nil)
	check("json rejects control char", T.json.decode('"a\1b"') == nil)

	-- Templates
	check("format", T.format("{name} ma {n}", { name = "Ann", n = 2 }) == "Ann ma 2")
	check("format keeps unknown", T.format("{x}", {}) == "{x}")

	-- Rotation (own scratch file in runtime/logs, removed afterwards)
	local scratch = "../logs/selftest-rotate.jsonl"
	local f = io.open(scratch, "wb")
	if f then
		f:write(string.rep("x", 100))
		f:close()
		check("no rotation under limit", T.rotateIfLarger(scratch, 1000) == nil)
		local rotated = T.rotateIfLarger(scratch, 50)
		local rf = rotated and io.open(rotated, "rb")
		check("rotation renames file", rf ~= nil and io.open(scratch, "rb") == nil)
		if rf then
			rf:close()
			os.remove(rotated)
		end
		os.remove(scratch)
	else
		failures[#failures + 1] = "cannot create rotation scratch file"
	end

	-- Measurement
	T.measure("selftest_probe", function() end)
	check("measure records calls", T.perf.stats.selftest_probe and T.perf.stats.selftest_probe.count >= 1)

	-- Definitions
	local keys = T.sortedKeys(T.agentDefs)
	check("definitions loaded", #keys >= 1)
	check("rejects missing spawn", T.validateDefinition({ npcName = "X", waypoints = { a = { x = 1, y = 1, z = 7 } }, spawn = "b" }) ~= nil)
	check("rejects route to unknown waypoint", T.validateDefinition({
		npcName = "X", waypoints = { a = { x = 1, y = 1, z = 7 } }, spawn = "a", routes = { r = { "a", "zz" } },
		behavior = { type = "patrol", defaultRoute = "r" }, greeting = { words = {}, range = 1 }, texts = { greetFallback = "" },
	}) ~= nil)
	check("rejects malformed hearing", T.validateDefinition({
		npcName = "X", waypoints = { a = { x = 1, y = 1, z = 7 } }, spawn = "a", behavior = { type = "stationary", home = "a" },
		hearing = { range = "far" }, greeting = { words = {}, range = 1 }, texts = { greetFallback = "" },
	}) == "hearing")
	check("rejects unknown behavior", T.validateDefinition({ npcName = "X", waypoints = { a = { x = 1, y = 1, z = 7 } }, spawn = "a", behavior = { type = "fight" } }) ~= nil)

	-- Command validation (needs a spawned agent and a world session)
	local key = keys[1]
	if key and T.agents[key] and T.worldSessionId then
		local now = T.nowMs()
		local function cmd(over, payloadOver)
			local m = { schemaVersion = 1, messageId = "m", kind = "command", worldSessionId = T.worldSessionId, agentKey = key, createdAtMs = now, correlationId = "c",
				payload = { commandId = "selftest-1", planRevision = T.agents[key].planRevision, expiresAtMs = now + 5000, action = "say", args = { text = "ok" } } }
			for k, v in pairs(over or {}) do
				m[k] = v
			end
			for k, v in pairs(payloadOver or {}) do
				m.payload[k] = v
			end
			return m
		end
		local function reason(m)
			local ok, _, r = T.validateCommand(m)
			return ok and "ok" or r
		end
		check("valid say", reason(cmd()) == "ok")
		check("unknown agent", reason(cmd({ agentKey = "nobody" })) == "unknown_agent")
		check("stale session", reason(cmd({ worldSessionId = "deadbeef" })) == "stale_session")
		check("unknown action", reason(cmd(nil, { action = "spawn" })) == "unknown_action")
		check("ttl too long", reason(cmd(nil, { expiresAtMs = now + 60000 })) == "ttl_too_long")
		check("expired", reason(cmd({ createdAtMs = now - 20000 }, { expiresAtMs = now - 15000 })) == "ttl_expired")
		check("raw coordinates rejected", reason(cmd(nil, { action = "move_to", args = { waypointId = "5000,5000,7" } })) == "invalid_args")
		check("extra arg rejected", reason(cmd(nil, { args = { text = "a", x = "1" } })) == "invalid_args")
		check("reply addressee accepted", reason(cmd(nil, { args = { text = "ok", toPlayerGuid = "5" } })) == "ok")
		check("bad addressee rejected", reason(cmd(nil, { args = { text = "ok", toPlayerGuid = "5; drop" } })) == "invalid_args")
		check("control char rejected", reason(cmd(nil, { args = { text = "a\nb" } })) == "invalid_args")
		check("npc named in the vocative", T.namesNpc({ npcName = "Ardan" }, "Ardanie, jak sie masz?") and T.namesNpc({ npcName = "Mira" }, "Witaj Miro"))
		check("other words do not name the npc", not T.namesNpc({ npcName = "Ardan" }, "Witaj straznika"))
		check("a name later in the sentence is not a call", not T.namesNpc({ npcName = "Brom" }, "Miro, zanioslem list do Broma"))
		check("a greeting before the name still calls", T.namesNpc({ npcName = "Brom" }, "Witaj Bromie, co slychac"))
		check("addressNames cover irregular forms", T.namesNpc({ npcName = "Tolek", addressNames = { "Tolku" } }, "Tolku, pokaz droge"))
		check("marker changes only the shown name", T.displayName({ npcName = "Ardan", marked = true }) == "Ardan [AI]" and T.displayName({ npcName = "Zwykly" }) == "Zwykly")
		check("cancel word recognised", T.guideIsCancel("stop, wystarczy!") and not T.guideIsCancel("koniec lekcji"))
		check("task definitions loaded", T.taskDefs.letter_for_brom ~= nil and #T.taskDefs.letter_for_brom.steps == 3)
		check("task step for an unknown task refused", reason(cmd(nil, { action = "task_step", args = { taskId = "nothing", stepId = "accept", toPlayerGuid = "5" } })) == "invalid_args")
		check("guide refused without the skill", reason(cmd(nil, { action = "guide_start", args = { placeId = "temple", toPlayerGuid = "5", text = "ok" } })) == "invalid_args")
	else
		failures[#failures + 1] = "no spawned agent for command validation"
	end

	local result = { passed = passed, failed = #failures, failures = failures }
	T.journal("selftest_result", result)
	return result
end
