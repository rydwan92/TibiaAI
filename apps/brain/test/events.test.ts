// Reliable reading of a body's event file (iteration 0018): every record acts exactly once.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { appendFileSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Memory } from '../src/memory.ts';
import { NpcMemoryStore } from '../src/npc/store.ts';
import { PlayerMind } from '../src/players/mind.ts';
import type { BodyState, PlayerDef, WorldFacts } from '../src/players/types.ts';
import { tempDir } from './helpers.ts';

const world: WorldFacts = { monsters: {}, points: [], towns: [] };
const def: PlayerDef = { character: 'Kael', vocation: 'knight', bravery: 0.5, curiosity: 0.5, sociability: 0, greed: 0.5, voice: 'krotko' };
const base: BodyState = { atMs: 0, online: true, name: 'Kael', level: 8, experience: 4200, hp: 185, hpMax: 185, mana: 90, manaMax: 90, x: 100, y: 100, z: 7, target: '', potions: { health: 5, mana: 2 }, seen: [], goalId: 0 };
const names = new Set(['Kael']);
const loot = (name: string, extra: object = {}) => `${JSON.stringify({ kind: 'message', atMs: 1_000_000, text: `Loot of a ${name}: nothing.`, ...extra })}\n`;

function world_(memory = new Memory(':memory:')) {
  const dir = join(tempDir(), 'kael');
  mkdirSync(dir, { recursive: true });
  const file = join(dir, 'events.jsonl');
  writeFileSync(file, '');
  let clock = 1_000_000;
  const store = new NpcMemoryStore(memory);
  const start = () => new PlayerMind('kael', def, dir, world, store, null, 0.35, () => clock);
  const mind = start();
  const tick = async (m: PlayerMind = mind) => {
    writeFileSync(join(dir, 'state.json'), JSON.stringify({ ...base, atMs: clock }));
    m.tick(names, () => false);
    await new Promise((r) => setTimeout(r, 2));
  };
  const kills = () => {
    let total = 0;
    for (const line of readFileSync(join(dir, 'diary.log'), 'utf8').split('\n')) if (line.includes('zabilem:')) total++;
    return total;
  };
  const advance = (ms: number) => { clock += ms; };
  return { dir, file, mind, start, tick, kills, advance };
}

test('a record written in two parts acts once, when it is whole', async () => {
  const w = world_();
  await w.tick();
  const line = loot('wolf');
  appendFileSync(w.file, line.slice(0, 20));
  await w.tick();
  assert.equal(w.kills(), 0, 'half a record does nothing yet');
  appendFileSync(w.file, line.slice(20));
  await w.tick();
  assert.equal(w.kills(), 1);
});

test('a character cut between writes survives', async () => {
  const w = world_();
  await w.tick();
  const bytes = Buffer.from(loot('żaba'));
  const middle = bytes.indexOf(0xc5) + 1; // inside "ż"
  appendFileSync(w.file, bytes.subarray(0, middle));
  await w.tick();
  appendFileSync(w.file, bytes.subarray(middle));
  await w.tick();
  assert.match(readFileSync(join(w.dir, 'diary.log'), 'utf8'), /zabilem: żaba/);
});

test('an unfinished last record does not cost the ones before it, and one bad line does not stop the next', async () => {
  const w = world_();
  await w.tick();
  appendFileSync(w.file, `${loot('wolf')}{broken json\n${loot('rat')}{"kind":"mess`);
  await w.tick();
  assert.equal(w.kills(), 2);
  appendFileSync(w.file, `age","atMs":1000000,"text":"Loot of a bat: nothing."}\n`);
  await w.tick();
  assert.equal(w.kills(), 3);
});

test('a truncated file is read from its start', async () => {
  const w = world_();
  await w.tick();
  appendFileSync(w.file, `${loot('wolf')}${loot('rat')}${loot('bat')}`);
  await w.tick();
  assert.equal(w.kills(), 3);
  writeFileSync(w.file, loot('spider'));
  await w.tick();
  assert.equal(w.kills(), 4, 'a shorter file is a new file');
});

test('a replaced file longer than the old position is still a new file', async () => {
  const w = world_();
  await w.tick();
  appendFileSync(w.file, loot('wolf', { session: 'one', seq: 1 }));
  await w.tick();
  writeFileSync(w.file, [1, 2, 3, 4].map((seq) => loot('rat', { session: 'two', seq })).join(''));
  await w.tick();
  assert.equal(w.kills(), 5, 'all of the new session');
});

test('a rotated file gives up its unread end first', async () => {
  const w = world_();
  await w.tick();
  appendFileSync(w.file, loot('wolf', { session: 'one', seq: 1 }));
  await w.tick();
  appendFileSync(w.file, loot('rat', { session: 'one', seq: 2 }));
  renameSync(w.file, `${w.file}.1`);
  writeFileSync(w.file, loot('bat', { session: 'two', seq: 1 }));
  await w.tick();
  assert.equal(w.kills(), 3, 'nothing was lost at the change');
});

test('a restarted mind goes on from where it saved, with its state: nothing twice, nothing lost', async () => {
  const memory = new Memory(':memory:');
  const w = world_(memory);
  await w.tick();
  appendFileSync(w.file, `${loot('wolf', { session: 'one', seq: 1 })}`);
  await w.tick();
  w.advance(31_000); // metrics interval saves mind and position together
  await w.tick();
  appendFileSync(w.file, loot('rat', { session: 'one', seq: 2 })); // written while the mind is down
  const after = w.start();
  w.advance(1000);
  await w.tick(after);
  w.advance(31_000);
  await w.tick(after);
  const saved = (JSON.parse(new NpcMemoryStore(memory).prefs('kael', 0).mind) as { kills: Record<string, number> }).kills;
  assert.equal(saved.wolf, 1, 'the old kill counts once');
  assert.equal(saved.rat, 1, 'the one written during the outage arrives');
});

test('a record read again after a crash counts on the restored state and is not told twice', async () => {
  const memory = new Memory(':memory:');
  const w = world_(memory);
  await w.tick();
  w.advance(31_000);
  await w.tick(); // saved here
  appendFileSync(w.file, loot('wolf', { session: 'one', seq: 1, atMs: 1_031_000 }));
  await w.tick(); // applied, not yet saved
  const before = w.kills();
  w.advance(10_000);
  const after = w.start(); // the crash: back to the saved state and position
  await w.tick(after);
  w.advance(31_000);
  await w.tick(after);
  assert.equal(w.kills(), before, 'one line in the diary');
  assert.equal((JSON.parse(new NpcMemoryStore(memory).prefs('kael', 0).mind) as { kills: Record<string, number> }).kills.wolf, 1, 'one kill in the counters');
});

test('the same record twice in one session acts once', async () => {
  const w = world_();
  await w.tick();
  const line = loot('wolf', { session: 'one', seq: 7 });
  appendFileSync(w.file, line + line);
  await w.tick();
  assert.equal(w.kills(), 1);
});

test('reading is bounded and an endless line cannot hold the reader back', async () => {
  const w = world_();
  await w.tick();
  appendFileSync(w.file, `{"kind":"message","text":"${'x'.repeat(2_000_000)}\n${loot('wolf')}`);
  for (let i = 0; i < 40 && w.kills() === 0; i++) await w.tick();
  assert.equal(w.kills(), 1);
});
