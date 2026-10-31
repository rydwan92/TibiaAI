// Entry point: node --disable-warning=ExperimentalWarning apps/brain/src/main.ts
// Paths are fixed relative to the repository root; provider is "rules" (offline).
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Brain } from './brain.ts';
import { agentRegistry } from './contracts.ts';
import { Mailbox } from './mailbox.ts';
import { Memory } from './memory.ts';
import { MemoryCompressor, ModelSummarizer } from './npc/compression.ts';
import { PlayerFleet, type PlayersFile } from './players/fleet.ts';
import { loadWorldFacts } from './players/knowledge.ts';
import { loadNav, tileKey } from './players/nav.ts';
import { NpcCatalog } from './npc/config.ts';
import { NpcDialogueProvider } from './npc/dialogue.ts';
import { TextMemoryRetriever } from './npc/retrieval.ts';
import { NpcMemoryStore } from './npc/store.ts';
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
const npcStore = new NpcMemoryStore(memory);

// local-model is optional: any problem with Ollama or the policy leaves Brain on the rules provider.
const MODEL_RETRY_MS = 30_000;

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
    return { provider, compressor: new MemoryCompressor(npcStore, new ModelSummarizer(client)), client };
  } catch (err) {
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
const playersFile = JSON.parse(readFileSync(join(root, 'packages', 'contracts', 'players.json'), 'utf8')) as PlayersFile;
const world = loadWorldFacts(join(root, 'packages', 'contracts', 'game-data.json'), join(runtime, 'atlas', 'canary-atlas.json'), join(root, 'packages', 'contracts', 'hunting-grounds.json'));
const nav = loadNav(join(runtime, 'atlas'), world.points);
const lockers = (JSON.parse(readFileSync(join(runtime, 'atlas', 'canary-atlas.json'), 'utf8')) as { lockers?: { x: number; y: number; z: number }[] }).lockers ?? [];
const home = world.towns.find((t) => t.name === playersFile.home)?.temple;
if (home) {
  const reach = nav.returnableTo(home, nav.reachableFrom(home));
  world.grounds = world.grounds?.filter((g) => reach.has(tileKey(g.x, g.y, g.z)));
  world.towns = world.towns.filter((t) => reach.has(tileKey(t.temple.x, t.temple.y, t.temple.z)));
  world.depots = lockers.flatMap((locker) => {
    const side = [[0, 1], [0, -1], [1, 0], [-1, 0]].map(([dx, dy]) => ({ x: locker.x + dx, y: locker.y + dy, z: locker.z })).find((p) => reach.has(tileKey(p.x, p.y, p.z)));
    return side ? [{ ...side, locker }] : [];
  });
}
const agentsFile = JSON.parse(readFileSync(join(root, 'packages', 'contracts', 'agents.json'), 'utf8')) as { agents: Record<string, { npcName: string; spawn: string; waypoints: Record<string, { x: number; y: number; z: number }> }> };
const npcAt = (key: string) => ({ name: agentsFile.agents[key].npcName, ...agentsFile.agents[key].waypoints[agentsFile.agents[key].spawn] });
world.npcs = Object.keys(agentsFile.agents).map(npcAt);
const standBeside = (npc: { name: string; x: number; y: number; z: number }) => {
  // An NPC stands on its own tile, and a shop serves from a few tiles away.
  const beside = [[0, 1], [1, 0], [-1, 0], [0, -1], [1, 1], [-1, 1], [1, -1], [-1, -1], [0, 2], [2, 0], [-2, 0], [0, -2]]
    .map(([dx, dy]) => ({ x: npc.x + dx, y: npc.y + dy, z: npc.z })).find((p) => nav.walkable(p.x, p.y, p.z));
  return { ...npc, ...beside };
};
world.merchant = standBeside(npcAt(playersFile.merchant));
world.supplies = playersFile.supplies;
world.identity = playersFile.identity;
const shop = JSON.parse(readFileSync(join(root, 'packages', 'contracts', 'shop.json'), 'utf8')) as { bought: { id: number }[] };
world.sellable = shop.bought.map((b) => b.id);
log('players_map_loaded', { grounds: world.grounds?.length ?? 0, towns: world.towns.map((t) => t.name), depots: world.depots?.length ?? 0, links: nav.linkCount, doors: nav.doorCount });
const fleet = new PlayerFleet(join(runtime, 'players'), playersFile, world, npcStore, modelClient, Date.now, nav);
const fleetTimer = setInterval(() => {
  try {
    fleet.tick();
  } catch (err) {
    log('fleet_error', { error: (err as Error).message });
  }
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
    writeFileSync(`${statusFile}.tmp`, JSON.stringify({ atMs: Date.now(), pid: process.pid, provider: provider.name, ...provider.status?.() }));
    renameSync(`${statusFile}.tmp`, statusFile);
  } catch (err) {
    log('ai_status_error', { error: (err as Error).message });
  }
}, 2000);

function shutdown(reason: string): void {
  clearInterval(timer);
  clearInterval(maintenance);
  clearInterval(statusTimer);
  clearInterval(fleetTimer);
  memory.close();
  log('brain_stopped', { reason });
  process.exit(0);
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
