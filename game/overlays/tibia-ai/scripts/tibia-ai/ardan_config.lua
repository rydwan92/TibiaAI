-- Ardan configuration: spawn, allowlisted waypoints and routes (data-canary map, town Montag).
-- Every waypoint is checked at startup by TibiaAI.verifyWaypoints (tile + engine pathfinding from
-- the spawn); results go to the journal as waypoint_check. Brain may only reference these ids.
TibiaAI = TibiaAI or {}

TibiaAI.ardanConfig = {
	agentKey = "ardan",
	npcName = "Ardan",
	spawn = { x = 5010, y = 5003, z = 7 },
	-- Chosen from the engine scan logged at startup (2026-10-29): '.' tiles away from stairs ('^').
	waypoints = {
		temple_south = { x = 5010, y = 5003, z = 7 },
		square_west = { x = 5006, y = 5005, z = 7 },
		square_east = { x = 5016, y = 5005, z = 7 },
		road_south = { x = 5010, y = 5009, z = 7 },
		gate_watch = { x = 5019, y = 5012, z = 7 },
		-- Deliberately unreachable (solid wall tile) to test movement timeout/failure.
		test_unreachable = { x = 5005, y = 4994, z = 7 },
	},
	routes = {
		montag_square = { "temple_south", "square_west", "road_south", "square_east" },
	},
	defaultRoute = "montag_square",
	alarm = { zoneId = "montag_gate", watchWaypoint = "gate_watch", rewarnSeconds = 20 },
	greetWords = { "hi", "hello", "hey", "witaj", "czesc", "siema", "dzien dobry" },
	greetRange = 4,
	greetCooldownSeconds = 8,
	talkPauseTicks = 4, -- think ticks (1 s each) Ardan stands still after a greeting
	brainReplyTicks = 2, -- wait this long for a Brain "say" before the local fallback greeting
	moveTimeoutTicks = 8, -- ticks without progress before a move fails (never teleports)
	retryAfterTicks = 5,
	waypointPauseTicks = 2,
	pathSearchDistance = 30,
	sayCooldownSeconds = 3,
}
