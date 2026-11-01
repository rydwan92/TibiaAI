-- World events on request: a raid from the datapack started by the owner (scripts\event.ps1). The same
-- raids also start by themselves at their own odds. What follows is the datapack's script, not ours.
local T = TibiaAI

T.registerControl("raid.request", function(arg)
	local raid = Raid.registry[arg]
	if not raid then
		return T.journal("world_event", { ok = false, raid = arg, reason = "unknown raid" })
	end
	T.journal("world_event", { ok = raid:tryStart(true) and true or false, raid = arg })
end)
