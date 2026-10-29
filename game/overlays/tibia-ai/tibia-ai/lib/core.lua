-- TibiaAI core: shared table, JSON codec, journal, file and text helpers.
-- Loaded first by scripts/tibia-ai/init.lua. Lua API checked against Canary v3.6.1 (fe0f932):
-- logger.*, io/os (luaL_openlibs), DATA_DIRECTORY (data/core.lua).

TibiaAI = TibiaAI or {}
local T = TibiaAI

-- The server process runs with cwd = runtime/server, so runtime/* is one level up.
T.paths = {
	journal = "../logs/world-journal.jsonl",
	mailbox = "../mailbox/",
	control = "../control/",
	agents = DATA_DIRECTORY .. "/tibia-ai/agents.json",
}

-- "{name} said {n}" + { name = "A", n = 2 } -> "A said 2". Unknown placeholders stay as-is.
function T.format(template, vars)
	return (tostring(template or ""):gsub("{(%w+)}", function(k)
		local v = vars and vars[k]
		return v ~= nil and tostring(v) or "{" .. k .. "}"
	end))
end

T.worldSessionId = T.worldSessionId or nil

function T.nowMs()
	-- os.time() has 1 s resolution; good enough for TTL/heartbeat checks, not for latency metrics.
	return os.time() * 1000
end

function T.isoNow()
	return os.date("!%Y-%m-%dT%H:%M:%SZ")
end

function T.randomHex(n)
	local out = {}
	for i = 1, n do
		out[i] = string.format("%x", math.random(0, 15))
	end
	return table.concat(out)
end

function T.uuid()
	local h = T.randomHex(32)
	return string.format("%s-%s-4%s-a%s-%s", h:sub(1, 8), h:sub(9, 12), h:sub(14, 16), h:sub(18, 20), h:sub(21, 32))
end

-- JSON ------------------------------------------------------------------------------------------
local json = {}
T.json = json

local escapes = { ['"'] = '\\"', ["\\"] = "\\\\", ["\b"] = "\\b", ["\f"] = "\\f", ["\n"] = "\\n", ["\r"] = "\\r", ["\t"] = "\\t" }

local function encodeString(s)
	return '"' .. s:gsub('[%c"\\]', function(c)
		return escapes[c] or string.format("\\u%04x", c:byte())
	end) .. '"'
end

local function isArray(t)
	local n = 0
	for k in pairs(t) do
		if type(k) ~= "number" or k < 1 or k % 1 ~= 0 then
			return false
		end
		n = n + 1
	end
	return n == #t
end

function json.encode(v, depth)
	depth = depth or 0
	if depth > 10 then
		error("json.encode: too deep")
	end
	local tv = type(v)
	if tv == "nil" then
		return "null"
	elseif tv == "boolean" then
		return v and "true" or "false"
	elseif tv == "number" then
		if v ~= v or v == math.huge or v == -math.huge then
			error("json.encode: invalid number")
		end
		if v % 1 == 0 then
			return string.format("%.0f", v)
		end
		return string.format("%.14g", v)
	elseif tv == "string" then
		return encodeString(v)
	elseif tv == "table" then
		local parts = {}
		if next(v) ~= nil and isArray(v) then
			for i = 1, #v do
				parts[i] = json.encode(v[i], depth + 1)
			end
			return "[" .. table.concat(parts, ",") .. "]"
		end
		local keys = {}
		for k in pairs(v) do
			keys[#keys + 1] = tostring(k)
		end
		table.sort(keys)
		for i, k in ipairs(keys) do
			parts[i] = encodeString(k) .. ":" .. json.encode(v[k], depth + 1)
		end
		return "{" .. table.concat(parts, ",") .. "}"
	end
	error("json.encode: unsupported type " .. tv)
end

-- Strict decoder for small messages. Returns value or nil, errorMessage.
local function decodeError(pos, msg)
	error({ pos = pos, msg = msg })
end

local function skipWs(s, i)
	local _, e = s:find("^[ \t\r\n]*", i)
	return e + 1
end

local function utf8char(cp)
	if cp < 0x80 then
		return string.char(cp)
	elseif cp < 0x800 then
		return string.char(0xC0 + math.floor(cp / 0x40), 0x80 + cp % 0x40)
	end
	return string.char(0xE0 + math.floor(cp / 0x1000), 0x80 + math.floor(cp / 0x40) % 0x40, 0x80 + cp % 0x40)
end

local decodeValue

local function decodeStringAt(s, i)
	local buf = {}
	local j = i + 1
	while true do
		local c = s:sub(j, j)
		if c == "" then
			decodeError(j, "unterminated string")
		elseif c == '"' then
			return table.concat(buf), j + 1
		elseif c == "\\" then
			local e = s:sub(j + 1, j + 1)
			local map = { ['"'] = '"', ["\\"] = "\\", ["/"] = "/", b = "\b", f = "\f", n = "\n", r = "\r", t = "\t" }
			if map[e] then
				buf[#buf + 1] = map[e]
				j = j + 2
			elseif e == "u" then
				local hex = s:sub(j + 2, j + 5)
				if not hex:match("^%x%x%x%x$") then
					decodeError(j, "bad unicode escape")
				end
				buf[#buf + 1] = utf8char(tonumber(hex, 16))
				j = j + 6
			else
				decodeError(j, "bad escape")
			end
		elseif c:byte() < 0x20 then
			decodeError(j, "control character in string")
		else
			buf[#buf + 1] = c
			j = j + 1
		end
	end
end

decodeValue = function(s, i, depth)
	if depth > 10 then
		decodeError(i, "too deep")
	end
	i = skipWs(s, i)
	local c = s:sub(i, i)
	if c == "{" then
		local obj = {}
		i = skipWs(s, i + 1)
		if s:sub(i, i) == "}" then
			return obj, i + 1
		end
		while true do
			if s:sub(i, i) ~= '"' then
				decodeError(i, "expected key")
			end
			local key
			key, i = decodeStringAt(s, i)
			i = skipWs(s, i)
			if s:sub(i, i) ~= ":" then
				decodeError(i, "expected ':'")
			end
			obj[key], i = decodeValue(s, i + 1, depth + 1)
			i = skipWs(s, i)
			local d = s:sub(i, i)
			if d == "}" then
				return obj, i + 1
			elseif d ~= "," then
				decodeError(i, "expected ',' or '}'")
			end
			i = skipWs(s, i + 1)
		end
	elseif c == "[" then
		local arr = {}
		i = skipWs(s, i + 1)
		if s:sub(i, i) == "]" then
			return arr, i + 1
		end
		while true do
			arr[#arr + 1], i = decodeValue(s, i, depth + 1)
			i = skipWs(s, i)
			local d = s:sub(i, i)
			if d == "]" then
				return arr, i + 1
			elseif d ~= "," then
				decodeError(i, "expected ',' or ']'")
			end
			i = i + 1
		end
	elseif c == '"' then
		return decodeStringAt(s, i)
	elseif s:sub(i, i + 3) == "true" then
		return true, i + 4
	elseif s:sub(i, i + 4) == "false" then
		return false, i + 5
	elseif s:sub(i, i + 3) == "null" then
		return nil, i + 4
	end
	local num = s:match("^-?%d+%.?%d*[eE]?[-+]?%d*", i)
	if num and num ~= "" and tonumber(num) then
		return tonumber(num), i + #num
	end
	decodeError(i, "unexpected character")
end

function json.decode(s)
	if type(s) ~= "string" then
		return nil, "not a string"
	end
	local ok, res, pos = pcall(decodeValue, s, 1, 0)
	if not ok then
		return nil, type(res) == "table" and (res.msg .. " at " .. res.pos) or tostring(res)
	end
	if skipWs(s, pos) <= #s then
		return nil, "trailing data"
	end
	return res
end

-- Journal: one JSON object per line in runtime/logs/world-journal.jsonl ---------------------------
function T.journal(kind, fields)
	local entry = { ts = T.isoNow(), worldSessionId = T.worldSessionId, kind = kind }
	for k, v in pairs(fields or {}) do
		entry[k] = v
	end
	local ok, line = pcall(json.encode, entry)
	if not ok then
		logger.warn("[TibiaAI] journal encode failed: {}", tostring(line))
		return
	end
	local f = io.open(T.paths.journal, "a")
	if f then
		f:write(line, "\n")
		f:close()
	end
	logger.info("[TibiaAI] {}", line)
end

-- Atomic-ish file write: tmp file + rename in the same directory (NTFS). Windows rename refuses an
-- existing target, so replace=true removes it first (short window; readers must tolerate absence).
function T.writeFileAtomic(path, content, replace)
	local tmp = path .. ".tmp"
	local f, err = io.open(tmp, "wb")
	if not f then
		return false, err
	end
	f:write(content)
	f:close()
	if replace then
		os.remove(path)
	end
	local ok, rerr = os.rename(tmp, path)
	if not ok then
		os.remove(tmp)
		return false, rerr
	end
	return true
end

function T.readFile(path, maxBytes)
	local f = io.open(path, "rb")
	if not f then
		return nil
	end
	local data = f:read(maxBytes + 1) or ""
	f:close()
	return data
end

function T.posTable(pos)
	return { x = pos.x, y = pos.y, z = pos.z }
end

function T.samePos(a, b)
	return a.x == b.x and a.y == b.y and a.z == b.z
end

function T.distance(a, b)
	if a.z ~= b.z then
		return math.huge
	end
	return math.max(math.abs(a.x - b.x), math.abs(a.y - b.y))
end
