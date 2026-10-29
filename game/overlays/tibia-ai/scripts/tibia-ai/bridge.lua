-- Mailbox bridge Lua <-> Brain (ADR 0002). Small JSON files in runtime/mailbox, no network and
-- no shell. Lua cannot list directories, so files use contiguous per-session sequence numbers:
--   events/evt-<session>-<seq>.json    written by Lua (tmp + rename)
--   commands/cmd-<session>-<seq>.json  written by Brain; Lua opens the next expected seq only
--   results/res-<session>-<seq>.json   written by Lua
--   world.json                         Lua status (session, next command seq, agent state)
--   brain-heartbeat.json               Brain liveness + last processed event seq
-- Limits: 16 KiB per file, max 10 commands per poll (500 ms), max 100 unacknowledged events.
TibiaAI = TibiaAI or {}
local T = TibiaAI

local MAX_FILE_BYTES = 16384
local MAX_COMMANDS_PER_POLL = 10
local MAX_EVENT_BACKLOG = 100
local MAX_TTL_MS = 10000
local HEARTBEAT_STALE_MS = 5000 -- 3 s watchdog + 1 s clock resolution on each side
local ALLOWED_ACTIONS = { say = true, patrol = true, move_to = true, stop = true }

T.bridge = T.bridge or {
	enabled = false,
	eventSeq = 0,
	resultSeq = 0,
	nextCommandSeq = 1,
	brainAtMs = 0,
	brainAckSeq = 0,
	results = {}, -- commandId -> result payload (dedup within the world session)
	resultOrder = {},
	pollCount = 0,
	droppedEvents = 0,
}
local B = T.bridge

local function mailboxPath(sub, name)
	return T.paths.mailbox .. sub .. name
end

function T.bridgeInit()
	local ok = T.writeFileAtomic(mailboxPath("events/", ".probe"), "probe", true)
	if ok then
		os.remove(mailboxPath("events/", ".probe"))
	end
	B.enabled = ok and true or false
	T.journal("bridge_init", { enabled = B.enabled, mailbox = T.paths.mailbox })
end

function T.bridgeIsBrainOnline()
	return B.enabled and (T.nowMs() - B.brainAtMs) <= HEARTBEAT_STALE_MS
end

local function envelope(kind, payload, correlationId)
	local id = T.uuid()
	return {
		schemaVersion = 1,
		messageId = id,
		kind = kind,
		worldSessionId = T.worldSessionId,
		agentKey = T.ardanConfig.agentKey,
		createdAtMs = T.nowMs(),
		correlationId = correlationId or id,
		payload = payload,
	}
end

-- Returns the event messageId (used as correlationId by Brain replies) or nil when not written.
function T.bridgeEmit(eventType, fields)
	local payload = { type = eventType }
	for k, v in pairs(fields or {}) do
		payload[k] = v
	end
	T.journal("event", { agentKey = T.ardanConfig.agentKey, eventType = eventType, payload = payload })
	if not B.enabled then
		return nil
	end
	if B.eventSeq - B.brainAckSeq >= MAX_EVENT_BACKLOG then
		B.droppedEvents = B.droppedEvents + 1
		T.journal("event_dropped_backpressure", { eventType = eventType, backlog = B.eventSeq - B.brainAckSeq })
		return nil
	end
	B.eventSeq = B.eventSeq + 1
	local msg = envelope("event", payload)
	msg.sequence = B.eventSeq
	local name = string.format("evt-%s-%08d.json", T.worldSessionId, B.eventSeq)
	local ok, err = T.writeFileAtomic(mailboxPath("events/", name), T.json.encode(msg), false)
	if not ok then
		T.journal("bridge_write_failed", { file = name, error = tostring(err) })
		return nil
	end
	return msg.messageId
end

local function writeResult(cmdEnvelope, payload)
	B.resultSeq = B.resultSeq + 1
	local msg = envelope("result", payload, cmdEnvelope and cmdEnvelope.correlationId)
	local name = string.format("res-%s-%08d.json", T.worldSessionId, B.resultSeq)
	T.writeFileAtomic(mailboxPath("results/", name), T.json.encode(msg), false)
	T.journal("command_result", { commandId = payload.commandId, status = payload.status, reasonCode = payload.reasonCode })
end

local function rememberResult(commandId, payload)
	if not B.results[commandId] then
		B.resultOrder[#B.resultOrder + 1] = commandId
		if #B.resultOrder > 200 then
			B.results[table.remove(B.resultOrder, 1)] = nil
		end
	end
	B.results[commandId] = payload
end

-- Validation ------------------------------------------------------------------------------------
local function validateArgs(action, args)
	if type(args) ~= "table" then
		return false
	end
	local allowedKeys = { say = { text = true }, patrol = { routeId = true }, move_to = { waypointId = true }, stop = {} }
	for k in pairs(args) do
		if not allowedKeys[action][k] then
			return false
		end
	end
	local cfg = T.ardanConfig
	if action == "say" then
		return type(args.text) == "string" and #args.text >= 1 and #args.text <= 200 and not args.text:find("%c")
	elseif action == "patrol" then
		return type(args.routeId) == "string" and cfg.routes[args.routeId] ~= nil
	elseif action == "move_to" then
		return type(args.waypointId) == "string" and cfg.waypoints[args.waypointId] ~= nil
	end
	return true
end

-- Returns (ok, status, reasonCode) where status is used when ok == false.
local function validateCommand(msg)
	if type(msg) ~= "table" or msg.schemaVersion ~= 1 or msg.kind ~= "command" then
		return false, "rejected", "invalid_envelope"
	end
	local p = msg.payload
	if type(p) ~= "table" or type(p.commandId) ~= "string" or not p.commandId:match("^[%w%-_]+$") or #p.commandId > 64 then
		return false, "rejected", "invalid_command"
	end
	if msg.worldSessionId ~= T.worldSessionId then
		return false, "rejected", "stale_session"
	end
	if msg.agentKey ~= T.ardanConfig.agentKey then
		return false, "rejected", "unknown_agent"
	end
	if type(msg.correlationId) ~= "string" or type(msg.createdAtMs) ~= "number" or type(p.expiresAtMs) ~= "number" then
		return false, "rejected", "invalid_envelope"
	end
	if p.expiresAtMs - msg.createdAtMs > MAX_TTL_MS then
		return false, "rejected", "ttl_too_long"
	end
	if p.expiresAtMs < T.nowMs() then
		return false, "expired", "ttl_expired"
	end
	if type(p.planRevision) ~= "number" or p.planRevision % 1 ~= 0 or p.planRevision < 0 then
		return false, "rejected", "invalid_plan_revision"
	end
	if not ALLOWED_ACTIONS[p.action] then
		return false, "rejected", "unknown_action"
	end
	if not validateArgs(p.action, p.args or {}) then
		return false, "rejected", "invalid_args"
	end
	-- planRevision orders movement plans (patrol/move_to/stop); speech is not a plan.
	local A = T.ardan
	if p.action ~= "say" and p.planRevision < A.planRevision then
		return false, "rejected", "stale_plan"
	end
	return true
end

local function handleCommand(raw, fileName)
	local commandId = nil
	if #raw > MAX_FILE_BYTES then
		os.rename(mailboxPath("commands/", fileName), mailboxPath("quarantine/", fileName))
		return writeResult(nil, { commandId = "unknown", status = "rejected", reasonCode = "too_large" })
	end
	local msg, err = T.json.decode(raw)
	if not msg then
		os.rename(mailboxPath("commands/", fileName), mailboxPath("quarantine/", fileName))
		return writeResult(nil, { commandId = "unknown", status = "rejected", reasonCode = "invalid_json", detail = err })
	end
	os.rename(mailboxPath("commands/", fileName), mailboxPath("processed/", fileName))
	if type(msg.payload) == "table" and type(msg.payload.commandId) == "string" then
		commandId = msg.payload.commandId
	end

	if commandId and B.results[commandId] and msg.worldSessionId == T.worldSessionId then
		local previous = {}
		for k, v in pairs(B.results[commandId]) do
			previous[k] = v
		end
		previous.duplicate = true
		return writeResult(msg, previous)
	end

	local ok, status, reason = validateCommand(msg)
	if not ok then
		local payload = { commandId = commandId or "unknown", status = status, reasonCode = reason, completedAtMs = T.nowMs() }
		if commandId and reason ~= "stale_session" then
			rememberResult(commandId, payload)
		end
		return writeResult(msg, payload)
	end

	local p = msg.payload
	if p.action ~= "say" and p.planRevision > T.ardan.planRevision then
		T.ardan.planRevision = p.planRevision -- newer movement plan cancels older ones
	end
	T.journal("command_accepted", { commandId = p.commandId, action = p.action, planRevision = p.planRevision, correlationId = msg.correlationId })
	T.ardanExecute({ action = p.action, args = p.args or {}, correlationId = msg.correlationId }, function(st, rc, position)
		local payload = { commandId = p.commandId, status = st, reasonCode = rc, actualPosition = position }
		if st ~= "accepted" then
			payload.completedAtMs = T.nowMs()
		end
		rememberResult(p.commandId, payload)
		writeResult(msg, payload)
	end)
end

local function readHeartbeat()
	local raw = T.readFile(T.paths.mailbox .. "brain-heartbeat.json", MAX_FILE_BYTES)
	if not raw then
		return
	end
	local hb = T.json.decode(raw)
	if type(hb) == "table" and type(hb.atMs) == "number" then
		B.brainAtMs = hb.atMs
		if hb.worldSessionId == T.worldSessionId and type(hb.lastEventSeq) == "number" then
			B.brainAckSeq = hb.lastEventSeq
		end
	end
end

local function writeWorldStatus()
	local status = {
		worldSessionId = T.worldSessionId,
		startedAtMs = T.worldStartedAtMs,
		atMs = T.nowMs(),
		nextCommandSeq = B.nextCommandSeq,
		lastEventSeq = B.eventSeq,
		lastResultSeq = B.resultSeq,
		droppedEvents = B.droppedEvents,
		brainOnline = T.bridgeIsBrainOnline(),
		agent = T.ardanStatus(),
	}
	T.writeFileAtomic(T.paths.mailbox .. "world.json", T.json.encode(status), true)
end

function T.bridgePoll()
	if not B.enabled or not T.worldSessionId then
		return
	end
	B.pollCount = B.pollCount + 1
	for _ = 1, MAX_COMMANDS_PER_POLL do
		local fileName = string.format("cmd-%s-%08d.json", T.worldSessionId, B.nextCommandSeq)
		local raw = T.readFile(mailboxPath("commands/", fileName), MAX_FILE_BYTES)
		if not raw then
			break
		end
		B.nextCommandSeq = B.nextCommandSeq + 1
		local ok, err = pcall(handleCommand, raw, fileName)
		if not ok then
			T.journal("bridge_command_error", { file = fileName, error = tostring(err) })
		end
	end
	if B.pollCount % 4 == 0 then
		readHeartbeat()
		writeWorldStatus()
	end
end

local poll = GlobalEvent("TibiaAIBridgePoll")
function poll.onThink(interval)
	T.bridgePoll()
	return true
end
poll:interval(500)
poll:register()

-- Local administrator controls through runtime/control/*.request (written by scripts\*.ps1):
--   shutdown.request    graceful shutdown (world save)      <- scripts\stop.ps1
--   alarm-start.request training alarm start                <- scripts\alarm.ps1 start
--   alarm-clear.request training alarm clear                <- scripts\alarm.ps1 clear
local function takeRequest(name)
	local path = T.paths.control .. name
	local f = io.open(path, "r")
	if not f then
		return false
	end
	f:close()
	os.remove(path)
	return true
end

local control = GlobalEvent("TibiaAIControl")
function control.onThink(interval)
	if takeRequest("shutdown.request") then
		T.journal("shutdown_requested", { source = "control_file" })
		Game.setGameState(GAME_STATE_SHUTDOWN)
		return true
	end
	if takeRequest("alarm-start.request") then
		local ok, reason = T.ardanAlarmStart(T.ardanConfig.alarm.zoneId, "admin-console")
		T.journal("admin_alarm_request", { action = "start", ok = ok, reason = reason })
	end
	if takeRequest("alarm-clear.request") then
		local ok, reason = T.ardanAlarmClear(T.ardanConfig.alarm.zoneId, "admin-console")
		T.journal("admin_alarm_request", { action = "clear", ok = ok, reason = reason })
	end
	return true
end
control:interval(1000)
control:register()
