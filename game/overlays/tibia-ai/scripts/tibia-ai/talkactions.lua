-- Administrator test commands (group "god"). The alarm is a controlled training event, not a
-- detection of a real monster.
--   /alarm start | /alarm clear
--   /ardan status | /ardan check | /ardan patrol
TibiaAI = TibiaAI or {}
local T = TibiaAI

local alarm = TalkAction("/alarm")
function alarm.onSay(player, words, param)
	logCommand(player, words, param)
	local zoneId = T.ardanConfig.alarm.zoneId
	local ok, reason
	if param == "start" then
		ok, reason = T.ardanAlarmStart(zoneId, player:getName())
	elseif param == "clear" then
		ok, reason = T.ardanAlarmClear(zoneId, player:getName())
	else
		player:sendTextMessage(MESSAGE_ADMINISTRATOR, "Usage: /alarm start|clear")
		return true
	end
	player:sendTextMessage(MESSAGE_ADMINISTRATOR, ok and ("Training alarm " .. param) or ("Alarm " .. param .. " refused: " .. tostring(reason)))
	return true
end
alarm:separator(" ")
alarm:groupType("god")
alarm:register()

local ardan = TalkAction("/ardan")
function ardan.onSay(player, words, param)
	logCommand(player, words, param)
	if param == "check" then
		local npc = T.getArdan()
		if not npc then
			player:sendTextMessage(MESSAGE_ADMINISTRATOR, "Ardan not found")
			return true
		end
		for _, r in ipairs(T.verifyWaypoints(npc)) do
			player:sendTextMessage(MESSAGE_ADMINISTRATOR, string.format("%s %d,%d,%d reachable=%s steps=%s", r.waypoint, r.x, r.y, r.z, tostring(r.reachable), tostring(r.pathSteps)))
		end
	elseif param == "patrol" then
		local ok, reason = T.ardanStartPatrol(T.ardanConfig.defaultRoute, "admin")
		player:sendTextMessage(MESSAGE_ADMINISTRATOR, ok and "Patrol started" or ("Refused: " .. tostring(reason)))
	else
		local s = T.ardanStatus()
		local pos = s.position and string.format("%d,%d,%d", s.position.x, s.position.y, s.position.z) or "?"
		player:sendTextMessage(MESSAGE_ADMINISTRATOR, string.format("Ardan state=%s alarm=%s pos=%s moving=%s brainOnline=%s session=%s", s.state, tostring(s.alarmActive), pos, tostring(s.moving), tostring(T.bridgeIsBrainOnline()), tostring(T.worldSessionId)))
	end
	return true
end
ardan:separator(" ")
ardan:groupType("god")
ardan:register()
