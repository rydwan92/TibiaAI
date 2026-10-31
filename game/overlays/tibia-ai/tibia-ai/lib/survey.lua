-- Engine survey of the map: which tiles can really hold a creature. The map file does not say what
-- blocks, the engine does. Runs in small slices so the world never stops.
--   survey.request     runtime/atlas/survey-map.jsonl: sample of free tiles per chunk, for spawns
--   nav-survey.request runtime/atlas/nav-map.jsonl: every tile and closed door, for routes
-- Both walk the chunk list that tools/world_atlas.py wrote from the map file. Looking at a tile makes
-- the engine build it, so memory stays high until the next restart.
local T = TibiaAI

local CHUNK = 16
local CHUNKS_PER_SLICE = 40
local SLICE_MS = 100
local SAMPLE_STEP = 3
local MAX_SAMPLE = 6

local function atlasFile(name)
	return T.paths.mailbox .. "../atlas/" .. name
end

local function chunkList()
	local list = {}
	local file = io.open(atlasFile("canary-atlas.json.chunks.txt"), "rb")
	if not file then
		return list
	end
	for line in file:lines() do
		local x, y, z = line:match("(%d+),(%d+),(%d+)")
		if x then
			list[#list + 1] = { tonumber(x), tonumber(y), tonumber(z) }
		end
	end
	file:close()
	return list
end

local function freeTiles(cx, cy, z)
	local free, total = {}, 0
	for x = cx, cx + CHUNK - 1, SAMPLE_STEP do
		for y = cy, cy + CHUNK - 1, SAMPLE_STEP do
			local tile = Tile(Position(x, y, z))
			if tile and tile:getGround() and not tile:hasFlag(TILESTATE_BLOCKSOLID) and not tile:hasFlag(TILESTATE_PROTECTIONZONE)
				and not tile:hasFlag(TILESTATE_HOUSE) and not tile:hasFlag(TILESTATE_FLOORCHANGE) then
				total = total + 1
				if #free < MAX_SAMPLE then
					free[#free + 1] = { x, y }
				end
			end
		end
	end
	return free, total
end

local function spawnLine(cx, cy, z)
	local free, total = freeTiles(cx, cy, z)
	if total > 0 then
		return { x = cx, y = cy, z = z, free = free, total = total }
	end
end

local function closedDoor(tile)
	if tile:hasFlag(TILESTATE_HOUSE) then
		return false
	end
	for _, item in ipairs(tile:getItems() or {}) do
		if item:getType():isDoor() and item:getActionId() == 0 then
			return true
		end
	end
	return false
end

-- One bit per tile of what a creature can stand on. Houses and protection zones count: a player may
-- walk there. Closed doors come separately: they open on use.
local function navLine(cx, cy, z)
	local rows, doors, any = {}, {}, false
	for y = cy, cy + CHUNK - 1 do
		local hex = {}
		for x = cx, cx + CHUNK - 1, 4 do
			local nibble = 0
			for bit = 0, 3 do
				local tile = Tile(Position(x + bit, y, z))
				if tile and tile:getGround() then
					if not tile:hasFlag(TILESTATE_BLOCKSOLID) then
						nibble = nibble + 2 ^ (3 - bit)
						any = true
					elseif closedDoor(tile) then
						doors[#doors + 1] = { x + bit, y }
						any = true
					end
				end
			end
			hex[#hex + 1] = string.format("%x", nibble)
		end
		rows[#rows + 1] = table.concat(hex)
	end
	if any then
		return { x = cx, y = cy, z = z, rows = rows, doors = #doors > 0 and doors or nil }
	end
end

local function step(job)
	local lines = {}
	for _ = 1, CHUNKS_PER_SLICE do
		local chunk = job.list[job.at]
		if not chunk then
			break
		end
		job.at = job.at + 1
		local line = job.lineFor(chunk[1], chunk[2], chunk[3])
		if line then
			lines[#lines + 1] = T.json.encode(line)
		end
	end
	if #lines > 0 then
		local file = io.open(job.path, "ab")
		if file then
			file:write(table.concat(lines, "\n"), "\n")
			file:close()
		end
	end
	if job.at > #job.list then
		return T.journal(job.done, { path = job.path, chunks = #job.list })
	end
	addEvent(step, SLICE_MS, job)
end

local function start(lineFor, fileName, done)
	return function()
		local list = chunkList()
		if #list == 0 then
			return T.journal(done, { ok = false, reason = "no chunk list" })
		end
		step({ list = list, at = 1, lineFor = lineFor, path = atlasFile(fileName), done = done })
	end
end

T.registerControl("survey.request", start(spawnLine, "survey-map.jsonl", "survey_done"))
T.registerControl("nav-survey.request", start(navLine, "nav-map.jsonl", "nav_survey_done"))
