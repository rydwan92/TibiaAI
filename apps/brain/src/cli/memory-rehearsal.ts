// Rehearsal of memory compression on a COPY of the real database, with the clock moved forward, so
// the first real pass holds no surprises. The live database is only read. Credits go to the real ledger.
//   node --disable-warning=ExperimentalWarning apps/brain/src/cli/memory-rehearsal.ts [--days 9] [--passes 6]
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Memory } from '../memory.ts';
import { DEFAULT_COMPRESSION, MemoryCompressor, ModelSummarizer } from '../npc/compression.ts';
import { NpcMemoryStore } from '../npc/store.ts';
import { CopilotModels, loadCloudAiConfig, sdkTransport } from '../providers/copilot-model.ts';
import { CreditLedger } from '../providers/ledger.ts';
import { loadLocalAiConfig } from '../providers/local-model.ts';

const DAY_MS = 86_400_000;
const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
const argument = (name: string, fallback: number) => {
  const at = process.argv.indexOf(name);
  return at > 0 ? Number(process.argv[at + 1]) : fallback;
};
const days = argument('--days', 9);
const passes = argument('--passes', 6);
const live = join(root, 'runtime', 'brain', 'brain.sqlite');
const stamp = new Date().toISOString().replace(/[-:]/g, '').slice(0, 15).replace('T', '-');
const copyFile = join(root, 'runtime', 'evidence', `memory-rehearsal-${stamp}.sqlite`);
mkdirSync(dirname(copyFile), { recursive: true });

const source = new Memory(live);
source.db.exec(`VACUUM INTO '${copyFile.replace(/'/g, "''")}'`);
const ledger = new CreditLedger(source.db);
const models = new CopilotModels(loadCloudAiConfig(), sdkTransport(join(root, 'runtime', 'copilot')), ledger, join(root, 'runtime', 'control', 'ai-stop'));
const client = models.forDialogue({ provider: 'copilot', model: 'gpt-6-luna', effort: 'low' }, loadLocalAiConfig().maxReplyChars);

const copy = new Memory(copyFile);
const store = new NpcMemoryStore(copy);
const count = (table: string) => (copy.db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n;
const before = { events: count('npc_events'), memories: count('npc_memories'), mind: store.prefs('luna', 0).mind };
const spentBefore = ledger.spentSince(0);
const now = () => Date.now() + days * DAY_MS;
const compressor = new MemoryCompressor(store, new ModelSummarizer(client), { ...DEFAULT_COMPRESSION, retentionByNpc: { ravn: 14 * DAY_MS } }, now);
const reports = [];
for (let i = 0; i < passes; i++) reports.push(await compressor.run());

const rows = copy.db.prepare('SELECT npc_key, summary, importance, certainty, participants_json FROM npc_memories ORDER BY npc_key, importance DESC').all() as { npc_key: string; summary: string; importance: number; certainty: string; participants_json: string }[];
const result = {
  days, before: { events: before.events, memories: before.memories }, after: { events: count('npc_events'), memories: count('npc_memories') },
  mindUntouched: store.prefs('luna', 0).mind === before.mind, compressed: reports.reduce((n, r) => n + r.compressed, 0), failed: reports.reduce((n, r) => n + r.failed, 0),
  deletedEvents: reports.reduce((n, r) => n + r.deletedEvents, 0), credits: Number((ledger.spentSince(0) - spentBefore).toFixed(3)), memories: rows,
};
await models.stop();
copy.close();
source.close();
for (const suffix of ['', '-wal', '-shm']) rmSync(`${copyFile}${suffix}`, { force: true }); // chat of real people does not stay in evidence files
const out = join(root, 'runtime', 'evidence', `memory-rehearsal-${stamp}.json`);
writeFileSync(out, JSON.stringify(result, null, 2));
console.log(JSON.stringify({ ...result, memories: undefined }));
for (const r of rows.slice(0, 12)) console.log(`${r.npc_key} [${r.importance}, ${r.certainty}] ${r.summary}`);
console.log(out);
