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

	-- Definitions
	local keys = T.sortedKeys(T.agentDefs)
	check("definitions loaded", #keys >= 1)
	check("rejects missing spawn", T.validateDefinition({ npcName = "X", waypoints = { a = { x = 1, y = 1, z = 7 } }, spawn = "b" }) ~= nil)
	check("rejects route to unknown waypoint", T.validateDefinition({
		npcName = "X", waypoints = { a = { x = 1, y = 1, z = 7 } }, spawn = "a", routes = { r = { "a", "zz" } },
		behavior = { type = "patrol", defaultRoute = "r" }, greeting = { words = {}, range = 1 }, texts = { greetFallback = "" },
	}) ~= nil)
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
		check("control char rejected", reason(cmd(nil, { args = { text = "a\nb" } })) == "invalid_args")
	else
		failures[#failures + 1] = "no spawned agent for command validation"
	end

	local result = { passed = passed, failed = #failures, failures = failures }
	T.journal("selftest_result", result)
	return result
end
