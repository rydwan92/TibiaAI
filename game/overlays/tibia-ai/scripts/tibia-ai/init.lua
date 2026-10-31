-- Entry point of the TibiaAI overlay (the only file Canary auto-loads from scripts/tibia-ai).
-- Modules live in data-canary/tibia-ai/lib, which Canary does not scan, and are loaded here in a
-- fixed order: Canary's recursive directory scan gives no ordering guarantee.
-- Agent definitions: data-canary/tibia-ai/agents.json (copied from packages/contracts, ADR 0004).
TibiaAI = TibiaAI or {}

local base = DATA_DIRECTORY .. "/tibia-ai/lib/"
for _, module in ipairs({ "core", "registry", "movement", "controller", "guide", "tasks", "bridge", "npc_types", "startup", "control", "arena", "survey", "perception", "talkactions", "selftest" }) do
	dofile(base .. module .. ".lua")
end

TibiaAI.loadDefinitions()
TibiaAI.loadWorldConfig()
TibiaAI.loadTasks()
TibiaAI.registerNpcTypes()
