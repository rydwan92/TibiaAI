// Entry point: node --disable-warning=ExperimentalWarning apps/brain/src/main.ts
// Paths are fixed relative to the repository root; provider is "rules" (offline).
import { appendFileSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Brain } from './brain.ts';
import { agentRegistry } from './contracts.ts';
import { Mailbox } from './mailbox.ts';
import { Memory } from './memory.ts';
import { MemoryCompressor, ModelSummarizer } from './npc/compression.ts';
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
interface ProviderChoice { provider: Provider; compressor: MemoryCompressor | null }

async function chooseProvider(name: string): Promise<ProviderChoice> {
  if (name !== 'local-model') return { provider: createProvider(name), compressor: null };
  try {
    const client = new LocalModelClient(loadLocalAiConfig());
    await client.verifyModel();
    // Warm up in the background: the first load takes ~30 s and must not cost a player's reply.
    client.chat([{ role: 'user', content: 'ok' }], { timeoutMs: 120_000, maxTokens: 1 })
      .then((r) => log('model_warm', { model: client.cfg.model, loadMs: r.loadMs }))
      .catch((err: Error) => log('model_warmup_failed', { error: err.message }));
    const provider = new NpcDialogueProvider(client, npcStore, NpcCatalog.load(), new TextMemoryRetriever(npcStore), log);
    return { provider, compressor: new MemoryCompressor(npcStore, new ModelSummarizer(client)) };
  } catch (err) {
    log('model_unavailable_using_rules', { error: (err as Error).message });
    return { provider: createProvider('rules'), compressor: null };
  }
}

let choice: ProviderChoice;
try {
  choice = await chooseProvider(process.env.TIBIAAI_BRAIN_PROVIDER ?? 'rules');
} catch (err) {
  console.error((err as Error).message);
  process.exit(2);
}
const { provider, compressor } = choice;

const brain = new Brain(new Mailbox(join(runtime, 'mailbox')), memory, log, Date.now, provider, npcStore);
log('brain_started', { provider: provider.name, agents, pid: process.pid });

// Compression, retention and memory statistics run apart from conversations and never block the loop.
const COMPRESS_WHEN_IDLE_MS = 60_000;
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

function shutdown(reason: string): void {
  clearInterval(timer);
  clearInterval(maintenance);
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
