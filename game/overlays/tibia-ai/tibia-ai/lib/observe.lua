-- Watching how a person plays, only for characters whose owner agreed (observation.json, empty by
-- default). What is kept: where they are, what they kill, how they die and level. Never what they say.
-- One file per character, so that deleting someone's data is deleting one file.
local T = TibiaAI

T.observed = {}

local function fileOf(name)
	return "../logs/observe-" .. name:gsub("%W", "_") .. ".jsonl"
end

local function note(player, kind, fields)
	local entry = { atMs = T.nowMs(), kind = kind, level = player:getLevel() }
	local pos = player:getPosition()
	entry.x, entry.y, entry.z = pos.x, pos.y, pos.z
	for k, v in pairs(fields or {}) do
		entry[k] = v
	end
	local ok, line = pcall(T.json.encode, entry)
	local f = ok and io.open(fileOf(player:getName()), "a")
	if f then
		f:write(line, "\n")
		f:close()
	end
end

function T.loadObservation()
	local raw = T.readFile(DATA_DIRECTORY .. "/tibia-ai/observation.json", 64 * 1024)
	local doc = raw and T.json.decode(raw)
	if type(doc) ~= "table" then
		return
	end
	T.observeEveryMs = (doc.sampleSeconds or 10) * 1000
	for _, name in ipairs(doc.consented or {}) do
		T.observed[name] = true
	end
end

local login = CreatureEvent("TibiaAIObserveLogin")
function login.onLogin(player)
	if T.observed[player:getName()] then
		player:registerEvent("TibiaAIObserveKill")
		player:registerEvent("TibiaAIObserveDeath")
		player:registerEvent("TibiaAIObserveAdvance")
		note(player, "login")
	end
	return true
end
login:register()

local logout = CreatureEvent("TibiaAIObserveLogout")
function logout.onLogout(player)
	if T.observed[player:getName()] then
		note(player, "logout")
	end
	return true
end
logout:register()

local kill = CreatureEvent("TibiaAIObserveKill")
function kill.onKill(player, target)
	note(player, "kill", { target = target:getName(), byPlayer = target:isPlayer() })
	return true
end
kill:register()

local death = CreatureEvent("TibiaAIObserveDeath")
function death.onDeath(player, corpse, killer)
	note(player, "death", { killer = killer and killer:getName() or "" })
	return true
end
death:register()

local advance = CreatureEvent("TibiaAIObserveAdvance")
function advance.onAdvance(player, skill, oldLevel, newLevel)
	if skill == SKILL_LEVEL then
		note(player, "level", { from = oldLevel, to = newLevel })
	end
	return true
end
advance:register()

local sample = GlobalEvent("TibiaAIObserveSample")
function sample.onThink()
	for name in pairs(T.observed) do
		local player = Player(name)
		if player then
			local target = player:getTarget()
			note(player, "sample", { hp = player:getHealth(), hpMax = player:getMaxHealth(), target = target and target:getName() or "" })
		end
	end
	return true
end
sample:interval(10000)
sample:register()
