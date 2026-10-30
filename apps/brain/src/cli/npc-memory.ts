// Read-only view of one NPC's memory: node apps/brain/src/cli/npc-memory.ts <npc> [playerGuid]
// Shows what the NPC holds and where each item came from. Never writes to the database.
import { DatabaseSync } from 'node:sqlite';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const [npc, guidArg] = process.argv.slice(2);
if (!npc) {
  console.error('usage: npc-memory.ts <npc> [playerGuid]');
  process.exit(2);
}
const guid = guidArg === undefined ? null : Number(guidArg);
const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
const db = new DatabaseSync(join(root, 'runtime', 'brain', 'brain.sqlite'), { readOnly: true });

const when = (ms: number) => new Date(ms).toISOString().slice(0, 16).replace('T', ' ');
const forPlayer = guid === null ? '' : 'AND player_guid = ?';
const args = guid === null ? [npc] : [npc, guid];

console.log(`RELACJE ${npc}`);
for (const r of db.prepare(`SELECT * FROM npc_relationships WHERE npc_key = ? ${forPlayer} ORDER BY last_seen_ms DESC`).all(...args) as Record<string, any>[]) {
  console.log(`  guid ${r.player_guid} ${r.last_name}: rozmow ${r.interactions}, znajomosc ${r.familiarity}, zaufanie ${r.trust}, ostatnio ${when(r.last_seen_ms)}`);
}
console.log('FAKTY (twierdzenia graczy)');
for (const f of db.prepare(`SELECT * FROM npc_player_facts WHERE npc_key = ? ${forPlayer}`).all(...args) as Record<string, any>[]) {
  console.log(`  guid ${f.player_guid} ${f.fact_key} = ${f.value} [${f.certainty}]`);
}
console.log('ZOBOWIAZANIA');
for (const c of db.prepare(`SELECT * FROM npc_commitments WHERE npc_key = ? ${forPlayer} ORDER BY created_at_ms DESC`).all(...args) as Record<string, any>[]) {
  console.log(`  guid ${c.player_guid} ${c.who}: ${c.text} [${c.status}]`);
}
console.log('ZDARZENIA (ostatnie 15)');
const events = db.prepare(`SELECT * FROM npc_events WHERE npc_key = ? ${guid === null ? '' : 'AND (subject_guid = ? OR visibility = \'public\')'} ORDER BY real_at_ms DESC, id DESC LIMIT 15`).all(...args) as Record<string, any>[];
for (const e of events.reverse()) {
  console.log(`  ${when(e.real_at_ms)} [${e.kind}/${e.source}/${e.certainty}/${e.visibility}] ${e.actor_name}: ${e.text}`);
}
console.log('WSPOMNIENIA');
for (const m of db.prepare(`SELECT * FROM npc_memories WHERE npc_key = ? ${guid === null ? '' : 'AND (subject_guid = ? OR visibility = \'public\')'} ORDER BY to_ms DESC LIMIT 15`).all(...args) as Record<string, any>[]) {
  console.log(`  ${when(m.from_ms)}..${when(m.to_ms)} [${m.certainty}/${m.visibility}, waga ${m.importance}] ${m.summary}`);
}
db.close();
