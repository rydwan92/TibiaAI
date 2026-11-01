// Entry point: node --disable-warning=ExperimentalWarning apps/brain/src/main.ts
// Paths are fixed relative to the repository root; provider is "rules" (offline).
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Brain } from './brain.ts';
import { agentRegistry } from './contracts.ts';
import { Mailbox } from './mailbox.ts';
import { Memory } from './memory.ts';
import { DEFAULT_COMPRESSION, MemoryCompressor, ModelSummarizer } from './npc/compression.ts';
import { PlayerFleet, type PlayersFile } from './players/fleet.ts';
import { loadWorldFacts } from './players/knowledge.ts';
import { loadNav, tileKey, type Boat } from './players/nav.ts';
import type { Teacher } from './players/types.ts';
import { NpcCatalog } from './npc/config.ts';
import { NpcDialogueProvider } from './npc/dialogue.ts';
import { TextMemoryRetriever } from './npc/retrieval.ts';
import { DEFAULT_STORE_LIMITS, NpcMemoryStore } from './npc/store.ts';
import { writePanel } from './panel.ts';
import { CopilotModels, loadCloudAiConfig, sdkTransport } from './providers/copilot-model.ts';
import { CreditLedger } from './providers/ledger.ts';
import { loadLocalAiConfig, LocalModelClient } from './providers/local-model.ts';
import type { Provider } from './providers/provider.ts';
import { createProvider } from './providers/rules.ts';
import { rotateIfLarger } from './logrotate.ts';
import { pruneDatabase } from './retention.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const runtime = join(root, 'runtime');
const logFile = join(runtime, 'logs', 'brain.log');
const stopFile = join(runtime, 'control', 'brain-stop.request');
mkdirSync(dirname(logFile), { recursive: true });

let agents: string[];
try {
  agents = agentRegistry().keys(); // fails fast on invalid packages/contracts/agents.json
} catch (err) {
  console.error((err as Error).message);
  process.exit(2);
}

let logLines = 0;
function log(kind: string, fields: Record<string, unknown> = {}): void {
  const line = JSON.stringify({ ts: new Date().toISOString(), kind, ...fields });
  if (++logLines % 500 === 0) rotateIfLarger(logFile);
  appendFileSync(logFile, `${line}\n`);
  console.log(line);
}

const memory = new Memory(join(runtime, 'brain', 'brain.sqlite'));
const worldRules = JSON.parse(readFileSync(join(root, 'packages', 'contracts', 'npc', 'world.json'), 'utf8')) as { memoryFromMs?: number };
const npcStore = new NpcMemoryStore(memory, { ...DEFAULT_STORE_LIMITS, memoryFromMs: worldRules.memoryFromMs ?? 0 });

// Characters with a metered model of their own (ADR 0011). Off unless asked for: rules work offline.
const copilot = process.env.TIBIAAI_CLOUD_AI === '1'
  ? new CopilotModels(loadCloudAiConfig(), sdkTransport(join(runtime, 'copilot')), new CreditLedger(memory.db), join(runtime, 'control', 'ai-stop'))
  : null;
if (copilot) log('cloud_ai_on', copilot.status());
const CLOUD_ROUTE = { provider: 'copilot', model: 'gpt-6-luna', effort: 'low' };

// local-model is optional: any problem with Ollama or the policy leaves Brain on the rules provider.
const MODEL_RETRY_MS = 30_000;

const playersFile = JSON.parse(readFileSync(join(root, 'packages', 'contracts', 'players.json'), 'utf8')) as PlayersFile;
// A character may hold its days in detail for longer than the common week.
const memoryRules = { ...DEFAULT_COMPRESSION, retentionByNpc: Object.fromEntries(Object.entries(playersFile.agents).filter(([, def]) => def.memory?.detailDays).map(([key, def]) => [key, def.memory!.detailDays! * 86_400_000])) };

interface ProviderChoice { provider: Provider; compressor: MemoryCompressor | null; client: LocalModelClient | null }

async function chooseProvider(name: string): Promise<ProviderChoice> {
  if (name !== 'local-model') return { provider: createProvider(name), compressor: null, client: null };
  try {
    const client = new LocalModelClient(loadLocalAiConfig());
    await client.verifyModel();
    // Warm up in the background: the first load takes ~30 s and must not cost a player's reply.
    client.chat([{ role: 'user', content: 'ok' }], { timeoutMs: 120_000, maxTokens: 1 })
      .then((r) => log('model_warm', { model: client.cfg.model, loadMs: r.loadMs }))
      .catch((err: Error) => log('model_warmup_failed', { error: err.message }));
    const provider = new NpcDialogueProvider(client, npcStore, NpcCatalog.load(), new TextMemoryRetriever(npcStore), log);
    return { provider, compressor: new MemoryCompressor(npcStore, new ModelSummarizer(client), memoryRules), client };
  } catch (err) {
    if (copilot) {
      // With the local model off NPCs still talk and old days still get summarised, on the account's model.
      const npcClient = copilot.forDialogue(CLOUD_ROUTE, loadLocalAiConfig().maxReplyChars);
      return { provider: new NpcDialogueProvider(npcClient, npcStore, NpcCatalog.load(), new TextMemoryRetriever(npcStore), log), compressor: new MemoryCompressor(npcStore, new ModelSummarizer(npcClient), memoryRules), client: null };
    }
    log('model_unavailable_using_rules', { error: (err as Error).message });
    return { provider: createProvider('rules'), compressor: null, client: null };
  }
}

let choice: ProviderChoice;
try {
  choice = await chooseProvider(process.env.TIBIAAI_BRAIN_PROVIDER ?? 'rules');
} catch (err) {
  console.error((err as Error).message);
  process.exit(2);
}
let { provider, compressor } = choice;
const { client: modelClient } = choice;

const brain = new Brain(new Mailbox(join(runtime, 'mailbox')), memory, log, Date.now, provider, npcStore);

// Player agents: their minds live here, their bodies are clients started by scripts\player-agents.ps1.
const world = loadWorldFacts(join(root, 'packages', 'contracts', 'game-data.json'), join(runtime, 'atlas', 'atlas.json'), join(root, 'packages', 'contracts', 'hunting-grounds.json'));
const nav = loadNav(join(runtime, 'atlas'), world.points);
nav.addBoats((JSON.parse(readFileSync(join(root, 'packages', 'contracts', 'boats.json'), 'utf8')) as { boats: Boat[] }).boats);
const lockers = (JSON.parse(readFileSync(join(runtime, 'atlas', 'atlas.json'), 'utf8')) as { lockers?: { x: number; y: number; z: number }[] }).lockers ?? [];
const home = world.towns.find((t) => t.name === playersFile.home)?.temple;
const reach = home ? nav.returnableTo(home, nav.reachableFrom(home)) : null;
if (reach) {
  world.grounds = world.grounds?.filter((g) => reach.has(tileKey(g.x, g.y, g.z)));
  world.towns = world.towns.filter((t) => reach.has(tileKey(t.temple.x, t.temple.y, t.temple.z)));
  world.depots = lockers.flatMap((locker) => {
    const side = [[0, 1], [0, -1], [1, 0], [-1, 0]].map(([dx, dy]) => ({ x: locker.x + dx, y: locker.y + dy, z: locker.z })).find((p) => reach.has(tileKey(p.x, p.y, p.z)));
    return side ? [{ ...side, locker }] : [];
  });
}
const agentsFile = JSON.parse(readFileSync(join(root, 'packages', 'contracts', 'agents.json'), 'utf8')) as { agents: Record<string, { npcName: string; spawn: string; waypoints: Record<string, { x: number; y: number; z: number }> }> };
const npcAt = (key: string) => ({ name: agentsFile.agents[key].npcName, ...agentsFile.agents[key].waypoints[agentsFile.agents[key].spawn] });
const standBeside = (npc: { name: string; x: number; y: number; z: number }) => {
  // An NPC stands on its own tile, and a shop serves from a few tiles away.
  const beside = [[0, 1], [1, 0], [-1, 0], [0, -1], [1, 1], [-1, 1], [1, -1], [-1, -1], [0, 2], [2, 0], [-2, 0], [0, -2]]
    .map(([dx, dy]) => ({ x: npc.x + dx, y: npc.y + dy, z: npc.z })).find((p) => nav.walkable(p.x, p.y, p.z));
  return { ...npc, ...beside };
};
world.npcs = Object.keys(agentsFile.agents).map((key) => standBeside(npcAt(key))); // an NPC's own tile cannot be walked onto
world.merchant = standBeside(npcAt(playersFile.merchant));
world.supplies = playersFile.supplies;
world.identity = playersFile.identity;
world.home = playersFile.home;
const shop = JSON.parse(readFileSync(join(root, 'packages', 'contracts', 'shop.json'), 'utf8')) as { bought: { id: number }[]; sold: { id: number }[] };
world.sellable = shop.bought.map((b) => b.id);
world.sold = shop.sold.map((b) => b.id);
world.potions = playersFile.potions;
const teachers = (JSON.parse(readFileSync(join(root, 'packages', 'contracts', 'teachers.json'), 'utf8')) as { teachers: Teacher[] }).teachers;
world.teachers = teachers.map((t) => ({ ...standBeside({ name: t.npc, x: t.x, y: t.y, z: t.z }), npc: t.npc, spells: t.spells })).filter((t) => !reach || reach.has(tileKey(t.x, t.y, t.z)));
world.kitSpells = (agentsFile as unknown as { arena: { kitSpells: Record<string, string[]> } }).arena.kitSpells;
const placesBlocked = join(runtime, 'atlas', 'places-blocked.json');
if (existsSync(placesBlocked)) nav.close(JSON.parse(readFileSync(placesBlocked, 'utf8')) as { x: number; y: number; z: number }[]);
const square = JSON.parse(readFileSync(join(root, 'game', 'world', 'places', 'plac-stevium.json'), 'utf8')) as { name: string; area: { x: number; y: number; z: number }; meet: { x: number; y: number } };
world.square = { name: square.name, x: square.area.x + square.meet.x, y: square.area.y + square.meet.y, z: square.area.z };
const gearFile = JSON.parse(readFileSync(join(root, 'packages', 'contracts', 'gear-shops.json'), 'utf8')) as { shops: { npc: string; x: number; y: number; z: number; items: NonNullable<typeof world.gearShop>['items'] }[]; values: typeof world.gearValues; potionShops: { name: string; x: number; y: number; z: number }[] };
const gearShop = gearFile.shops[0];
world.gearShop = { ...standBeside({ name: gearShop.npc, x: gearShop.x, y: gearShop.y, z: gearShop.z }), npc: gearShop.npc, items: gearShop.items };
world.gearValues = gearFile.values;
world.shops = gearFile.potionShops.map(standBeside).filter((shop) => !reach || reach.has(tileKey(shop.x, shop.y, shop.z)));
world.guide = JSON.parse(readFileSync(join(root, 'packages', 'contracts', 'player-guide.json'), 'utf8')) as typeof world.guide;
const INVENTORY_SLOTS: Record<string, number> = { head: 1, backpack: 3, armor: 4, right: 5, left: 6, legs: 7, feet: 8 };
const kits = (agentsFile as unknown as { arena: { kits: Record<string, { id: number; slot?: string }[]> } }).arena.kits;
world.gear = Object.fromEntries(Object.entries(kits).map(([name, items]) => [name, items.filter((i) => i.slot).map((i) => ({ id: i.id, slot: INVENTORY_SLOTS[i.slot!] }))]));
log('players_map_loaded', { grounds: world.grounds?.length ?? 0, towns: world.towns.map((t) => t.name), depots: world.depots?.length ?? 0, links: nav.linkCount, doors: nav.doorCount });
const fleet = new PlayerFleet(join(runtime, 'players'), playersFile, world, npcStore, modelClient, Date.now, nav, (key, def) => (copilot && def.model?.provider === 'copilot' ? copilot.forAgent(key, def.model) : null));
const fleetTimer = setInterval(() => {
  fleet.tick((err) => log('fleet_error', { error: err.message }));
}, 1000);
log('brain_started', { provider: provider.name, agents, pid: process.pid });

// Compression, retention and memory statistics run apart from conversations and never block the loop.
const COMPRESS_WHEN_IDLE_MS = 60_000;
// A model that was down at start can still arrive; rules hold the world until it does.
const wanted = process.env.TIBIAAI_BRAIN_PROVIDER ?? 'rules';
const modelWatch = wanted === 'local-model' && !modelClient ? setInterval(() => {
  chooseProvider(wanted).then((next) => {
    if (!next.client) return;
    if (modelWatch) clearInterval(modelWatch);
    provider = next.provider;
    compressor = next.compressor;
    brain.useProvider(next.provider);
    fleet.useClient(next.client);
    log('model_recovered', { model: next.client.cfg.model });
  }).catch(() => undefined);
}, MODEL_RETRY_MS) : null;

const maintenance = setInterval(() => {
  log('memory_stats', { npcs: npcStore.stats() });
  try {
    const removed = pruneDatabase(memory.db, Date.now(), brain.currentWorldSession);
    if (Object.values(removed).some((n) => n > 0)) log('database_pruned', removed);
  } catch (err) {
    log('database_prune_error', { error: (err as Error).message });
  }
  if (provider instanceof NpcDialogueProvider && provider.idleForMs() < COMPRESS_WHEN_IDLE_MS) return;
  compressor?.run().then((report) => {
    if (report.batches > 0) log('memory_compressed', { ...report });
  }).catch((err: Error) => log('memory_compression_error', { error: (err as Error).message }));
}, 10 * 60_000);

// What the AI is doing right now, for scripts\ai-status.ps1. Only read by that view.
const statusFile = join(runtime, 'brain', 'ai-status.json');
const statusTimer = setInterval(() => {
  try {
    writeFileSync(`${statusFile}.tmp`, JSON.stringify({ atMs: Date.now(), pid: process.pid, provider: provider.name, ...provider.status?.(), ...(copilot ? { cloud: copilot.status() } : {}) }));
    renameSync(`${statusFile}.tmp`, statusFile);
  } catch (err) {
    log('ai_status_error', { error: (err as Error).message });
  }
}, 2000);

// The toolbox page: a plain file, nothing listens anywhere.
const panelTimer = setInterval(() => {
  try {
    writePanel(root, memory.db, playersFile.agents, Date.now(), loadCloudAiConfig().monthlyBudgetCredits);
  } catch (err) {
    log('panel_error', { error: (err as Error).message });
  }
}, 30_000);

function shutdown(reason: string): void {
  clearInterval(timer);
  clearInterval(panelTimer);
  clearInterval(maintenance);
  clearInterval(statusTimer);
  clearInterval(fleetTimer);
  memory.close();
  log('brain_stopped', { reason });
  void (copilot?.stop() ?? Promise.resolve()).finally(() => process.exit(0));
}

const timer = setInterval(() => {
  if (existsSync(stopFile)) {
    rmSync(stopFile, { force: true });
    shutdown('control_file');
  }
  try {
    brain.tick();
  } catch (err) {
    log('brain_tick_error', { error: (err as Error).message });
  }
}, 250);

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
