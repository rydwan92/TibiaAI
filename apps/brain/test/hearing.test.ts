import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Brain } from '../src/brain.ts';
import { parseEvent } from '../src/contracts.ts';
import { Mailbox } from '../src/mailbox.ts';
import { Memory } from '../src/memory.ts';
import type { Provider } from '../src/providers/provider.ts';
import { makeEvent, tempDir, writeEvent, writeWorld } from './helpers.ts';

const heard = (text = 'ALARM! Cwiczenia przy bramie.') =>
  ({ type: 'agent_heard' as const, speakerKey: 'ardan', text, yelled: true, distance: 10 });

function commands(root: string) {
  return readdirSync(join(root, 'commands')).filter((f) => f.endsWith('.json')).sort()
    .map((f) => JSON.parse(readFileSync(join(root, 'commands', f), 'utf8')));
}

test('agent_heard contract', () => {
  assert.ok(parseEvent(makeEvent('s1', heard(), { agentKey: 'mira' })).ok);
  assert.equal(parseEvent(makeEvent('s1', heard(), { agentKey: 'ardan' })).ok, false, 'an agent cannot hear itself');
  assert.equal(parseEvent(makeEvent('s1', { ...heard(), speakerKey: 'ghost' }, { agentKey: 'mira' })).ok, false);
  assert.equal(parseEvent(makeEvent('s1', { ...heard(), yelled: 'yes' } as any, { agentKey: 'mira' })).ok, false);
});

test('heard speech is remembered with provenance and never answered', () => {
  const dir = tempDir();
  const mb = new Mailbox(join(dir, 'mailbox'));
  const memory = new Memory(join(dir, 'brain.sqlite'));
  const brain = new Brain(mb, memory, () => {});
  writeWorld(mb.root, 'sessH');
  brain.tick();
  writeEvent(mb.root, makeEvent('sessH', heard(), { agentKey: 'mira' }));
  brain.tick();
  assert.equal(commands(mb.root).length, 0);
  const h = memory.latestHeard('mira', 0);
  assert.equal(h?.speakerKey, 'ardan');
  assert.equal(h?.yelled, true);
  assert.equal(memory.latestHeard('ardan', 0), undefined, 'only the listener remembers');
});

test('greeting passes on a fresh rumor after the reply', () => {
  const dir = tempDir();
  const mb = new Mailbox(join(dir, 'mailbox'));
  let now = Date.now();
  const brain = new Brain(mb, new Memory(join(dir, 'brain.sqlite')), () => {}, () => now);
  writeWorld(mb.root, 'sessR');
  brain.tick();
  writeEvent(mb.root, makeEvent('sessR', heard('Alarm odwolany. Wracam na patrol.'), { agentKey: 'mira', createdAtMs: now - 120_000 }));
  brain.tick(); // old event: stored (stale), still provenance memory
  const greet = makeEvent('sessR', { type: 'player_greeted', playerGuid: 5, playerName: 'Knight Sample', text: 'hi' }, { agentKey: 'mira', createdAtMs: now });
  writeEvent(mb.root, greet);
  brain.tick();
  now += 4000;
  brain.tick();
  const texts = commands(mb.root).map((c) => c.payload.args.text);
  assert.equal(texts.length, 2);
  assert.match(texts[0], /Jestem Mira/);
  assert.equal(texts[1], 'Slyszalam, jak Ardan mowil 2 min temu: "Alarm odwolany. Wracam na patrol."');
  assert.ok(commands(mb.root).every((c) => c.correlationId === greet.messageId));
});

test('loop guard blocks speech intents for agent_heard from any provider', () => {
  const dir = tempDir();
  const mb = new Mailbox(join(dir, 'mailbox'));
  const logged: string[] = [];
  const chatty: Provider = { name: 'chatty', decide: () => [{ action: 'say', text: 'Tak, Ardan!', delayMs: 0 }] };
  const brain = new Brain(mb, new Memory(join(dir, 'brain.sqlite')), (k) => { logged.push(k); }, Date.now, chatty);
  writeWorld(mb.root, 'sessL');
  brain.tick();
  writeEvent(mb.root, makeEvent('sessL', heard(), { agentKey: 'mira' }));
  brain.tick();
  assert.equal(commands(mb.root).length, 0);
  assert.ok(logged.includes('intents_blocked_loop_guard'));
});

test('migrations from v1 keep data and copy the database first', () => {
  const dir = tempDir();
  const file = join(dir, 'brain.sqlite');
  const m = new Memory(file);
  m.recordEncounter('ardan', 1, 'A', 'e1', 's', 1);
  // Simulate a v1 database: undo everything the later migrations added.
  const npcTables = m.db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'npc\\_%' ESCAPE '\\'").all() as { name: string }[];
  for (const t of npcTables) m.db.exec(`DROP TABLE ${t.name}`);
  m.db.exec("DROP TABLE assistant_notes; DROP TABLE model_usage; DROP TABLE heard_statements; ALTER TABLE commands DROP COLUMN plan_json; ALTER TABLE commands DROP COLUMN plan_applied; DELETE FROM schema_migrations WHERE version >= 2;");
  m.close();
  const upgraded = new Memory(file);
  assert.equal(upgraded.encounterStats('ardan', 1).count, 1);
  upgraded.recordHeard('e2', 'mira', 'ardan', 'x', false, 3, 's', 2);
  assert.equal(upgraded.latestHeard('mira', 0)?.text, 'x');
  assert.ok(readdirSync(dir).some((f) => f.startsWith('brain.sqlite.bak-v1-')), 'backup before migration');
  assert.equal(upgraded.pendingPlan('none', 'completed'), null, 'v3 columns exist');
});
