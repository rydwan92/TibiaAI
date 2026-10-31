-- Errands (skill "tasks", packages/contracts/tasks.json). The engine owns them: the state lives in
-- the character's storage, so it survives restarts and cannot be set by speech, and a step applies
-- all its effects or none. Its lines are fixed: a model can neither hand out an item nor gold, and
-- a player must understand what to do next.
local T = TibiaAI

T.taskDefs = T.taskDefs or {}

function T.loadTasks()
	local raw = T.readFile(DATA_DIRECTORY .. "/tibia-ai/tasks.json", 256 * 1024)
	local doc = raw and T.json.decode(raw)
	T.taskDefs = type(doc) == "table" and doc.tasks or {}
	if type(doc) ~= "table" then
		T.journal("task_definitions_missing", {})
	end
end

-- Task states of one player, sent with their speech: Brain picks the step from the engine's state,
-- never from what the player claims to have done.
function T.taskStates(player)
	local states = {}
	for id, task in pairs(T.taskDefs) do
		states[id] = math.max(player:getStorageValue(task.storage), 0)
	end
	return states
end

local function stepFor(task, agentKey, state)
	for _, step in ipairs(task.steps) do
		if step.at == agentKey and step.from == state then
			return step
		end
	end
	return nil
end

-- What is wrong with this step for this player, or nil when it can run.
local function refusal(task, agent, player, state, stepId)
	local step = stepFor(task, agent.key, state)
	if step and step.id == stepId then
		if step.takeItem and player:getItemCount(step.takeItem.id) < step.takeItem.count then
			return "item_missing"
		end
		return nil, step
	end
	return state >= task.steps[#task.steps].to and "already_done" or "in_progress"
end

-- Applies a step. Giving an item comes first because it alone can fail: nothing else has happened yet.
local function apply(step, player)
	if step.giveItem and not player:addItem(step.giveItem.id, step.giveItem.count, false) then
		return false
	end
	if step.takeItem then
		player:removeItem(step.takeItem.id, step.takeItem.count)
	end
	if step.money then
		player:addMoney(step.money)
		player:sendTextMessage(MESSAGE_EVENT_ADVANCE, string.format("Otrzymujesz %d zlota.", step.money))
	end
	if step.notice then
		player:sendTextMessage(MESSAGE_EVENT_ADVANCE, step.notice)
	end
	return true
end

function T.taskStep(agent, npc, playerGuid, taskId, stepId, text, commandId)
	local task = T.taskDefs[taskId]
	if not task or not T.agentHasSkill(T.agentDef(agent), "tasks") then
		return false, "task_not_allowed"
	end
	local player = T.playerByGuid(playerGuid)
	local def = T.agentDef(agent)
	if not player or T.distance(player:getPosition(), npc:getPosition()) > (def.hearing and def.hearing.range or def.greeting.range) then
		return false, "addressee_gone"
	end
	local name = player:getName()
	local state = math.max(player:getStorageValue(task.storage), 0)
	local refused, step = refusal(task, agent, player, state, stepId)
	if not refused and not apply(step, player) then
		refused = "no_capacity"
	end
	if refused then
		T.agentSay(agent, npc, T.format(task.refused[refused] or "", { name = name }), false, "rules")
		T.journal("task_refused", { agentKey = agent.key, playerGuid = playerGuid, taskId = taskId, state = state, reason = refused })
		return false, refused
	end
	player:setStorageValue(task.storage, step.to)
	T.journal("task_step_done", { agentKey = agent.key, playerGuid = playerGuid, taskId = taskId, stepId = step.id, from = step.from, to = step.to, money = step.money or 0, commandId = commandId })
	T.bridgeEmit(agent.key, "task_step_done", { playerGuid = playerGuid, playerName = name, taskId = taskId, stepId = step.id, state = step.to })
	T.agentSay(agent, npc, text ~= "" and text or T.format(step.say, { name = name }), false, "brain", { commandId = commandId })
	return true
end
