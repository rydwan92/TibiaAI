-- Local perception of world incidents (ADR 0008). An incident reaches only the agents that can see
-- it: same floor and within def.sight.range (default 8). There is no global event stream.
--   incident.request "cart_crash,5020,5003,7"   (scripts\incident.ps1)
local T = TibiaAI

T.worldConfig = T.worldConfig or { incidents = {} }

function T.loadWorldConfig()
	local raw = T.readFile(DATA_DIRECTORY .. "/tibia-ai/world.json", 256 * 1024)
	local doc = raw and T.json.decode(raw)
	if type(doc) == "table" then
		T.worldConfig = doc
	else
		T.journal("world_config_missing", {})
	end
end

function T.worldMinutes()
	return getWorldTime()
end

function T.reportIncident(incidentId, pos)
	local description = (T.worldConfig.incidents or {})[incidentId]
	if not description then
		return T.journal("incident", { ok = false, incidentId = incidentId, reason = "unknown_incident" })
	end
	local witnesses = {}
	for _, key in ipairs(T.sortedKeys(T.agents)) do
		local agent = T.agents[key]
		local npc = T.agentNpc(agent)
		if npc then
			local sight = (T.agentDef(agent).sight or {}).range or 8
			local d = T.distance(npc:getPosition(), pos)
			if d <= sight then
				witnesses[#witnesses + 1] = key
				T.bridgeEmit(key, "incident_observed", { incidentId = incidentId, description = description, distance = d, worldMinutes = T.worldMinutes() })
			end
		end
	end
	T.journal("incident", { ok = true, incidentId = incidentId, position = pos, witnesses = witnesses })
end

T.registerControl("incident.request", function(arg)
	local id, x, y, z = (arg or ""):match("^([%w_]+),(%d+),(%d+),(%d+)$")
	if not id then
		return T.journal("incident", { ok = false, reason = "expected id,x,y,z", arg = arg })
	end
	T.reportIncident(id, { x = tonumber(x), y = tonumber(y), z = tonumber(z) })
end)
