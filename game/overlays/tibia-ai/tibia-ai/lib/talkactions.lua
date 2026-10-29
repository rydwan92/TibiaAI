-- Administrator test commands (group "god"). The alarm is a controlled training event, not a
-- detection of a real monster.
--   /alarm start [zone] | /alarm clear [zone]
--   /ai status [agent] | /ai check <agent> | /ai patrol <agent> [route] | /ai scan [radius]
local T = TibiaAI

local function words(param)
	local out = {}
	for w in (param or ""):gmatch("%S+") do
		out[#out + 1] = w
	end
	return out
end

local function zoneOf(arg)
	return arg or (T.defs.alarmZones or {})[1] or "default"
end

local alarm = TalkAction("/alarm")
function alarm.onSay(player, cmd, param)
	logCommand(player, cmd, param)
	local args = words(param)
	local zone = zoneOf(args[2])
	local reacted, reason
	if args[1] == "start" then
		reacted, reason = T.alarmStart(zone, player:getName())
	elseif args[1] == "clear" then
		reacted, reason = T.alarmClear(zone, player:getName())
	else
		player:sendTextMessage(MESSAGE_ADMINISTRATOR, "Usage: /alarm start|clear [zone]")
		return true
	end
	if #reacted > 0 then
		player:sendTextMessage(MESSAGE_ADMINISTRATOR, string.format("Training alarm %s (%s): %s", args[1], zone, table.concat(reacted, ", ")))
	else
		player:sendTextMessage(MESSAGE_ADMINISTRATOR, string.format("Alarm %s refused: %s", args[1], tostring(reason)))
	end
	return true
end
alarm:separator(" ")
alarm:groupType("god")
alarm:register()

local function statusLine(key, agent)
	local s = T.agentStatus(agent)
	local pos = s.position and string.format("%d,%d,%d", s.position.x, s.position.y, s.position.z) or "?"
	return string.format("%s state=%s alarm=%s pos=%s moving=%s", key, s.state, tostring(s.alarmActive), pos, tostring(s.moving))
end

local ai = TalkAction("/ai")
function ai.onSay(player, cmd, param)
	logCommand(player, cmd, param)
	local args = words(param)
	local sub, key = args[1] or "status", args[2]
	local agent = key and T.agents[key] or nil
	local msg = function(text)
		player:sendTextMessage(MESSAGE_ADMINISTRATOR, text)
	end
	if sub == "status" then
		msg(string.format("session=%s brainOnline=%s", tostring(T.worldSessionId), tostring(T.bridgeIsBrainOnline())))
		for _, k in ipairs(T.sortedKeys(T.agents)) do
			if not key or k == key then
				msg(statusLine(k, T.agents[k]))
			end
		end
	elseif sub == "check" and agent and T.agentNpc(agent) then
		for _, r in ipairs(T.verifyWaypoints(agent, T.agentNpc(agent))) do
			msg(string.format("%s %d,%d,%d reachable=%s steps=%s", r.waypoint, r.x, r.y, r.z, tostring(r.reachable), tostring(r.pathSteps)))
		end
	elseif sub == "patrol" and agent then
		local ok, reason = T.agentStartPatrol(agent, args[3] or T.agentDef(agent).behavior.defaultRoute, "admin")
		msg(ok and "Patrol started" or ("Refused: " .. tostring(reason)))
	elseif sub == "scan" then
		local rows = T.scanArea(T.posTable(player:getPosition()), math.min(tonumber(key) or 8, 12))
		for _, row in ipairs(rows) do
			msg(row)
		end
		T.journal("area_scan", { center = T.posTable(player:getPosition()), rows = rows })
	else
		msg("Usage: /ai status [agent] | /ai check <agent> | /ai patrol <agent> [route] | /ai scan [radius]")
	end
	return true
end
ai:separator(" ")
ai:groupType("god")
ai:register()
