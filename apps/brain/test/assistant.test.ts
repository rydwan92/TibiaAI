// The personal helper: notes stay with their owner, commands work without a model.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Memory } from '../src/memory.ts';
import { NpcMemoryStore } from '../src/npc/store.ts';
import { AssistantMind, NoteStore, pendingLines } from '../src/players/assistant.ts';
import type { PlayerDef } from '../src/players/types.ts';
import type { ModelClient } from '../src/providers/local-model.ts';
import { tempDir } from './helpers.ts';

const def: PlayerDef = { character: 'Notka', vocation: 'knight', role: 'assistant', bravery: 0.5, curiosity: 0.5, sociability: 0.5, greed: 0.5, voice: 'krotko' };

function helper(client: ModelClient | null = null) {
  const dir = join(tempDir(), 'notka');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'events.jsonl'), '');
  const store = new NpcMemoryStore(new Memory(':memory:'));
  const notes = new NoteStore(store.db);
  let clock = 5_000_000;
  const start = () => new AssistantMind('notka', def, dir, notes, store, client, () => clock);
  const mind = start();
  mind.tick();
  const send = async (from: string, text: string, isPrivate = true, m = mind) => {
    appendFileSync(join(dir, 'events.jsonl'), `${JSON.stringify({ kind: 'heard', from, text, level: 8, private: isPrivate, atMs: clock })}\n`);
    m.tick();
    await new Promise((r) => setTimeout(r, 5));
  };
  return { dir, store, notes, mind, send, start, lines: () => pendingLines(dir).map((l) => `${l.to}> ${l.text}`).join('\n'), advance: (ms: number) => { clock += ms; } };
}

test('a first message explains what the helper is and where words go', async () => {
  const h = helper();
  await h.send('Marek', 'pomoc');
  assert.match(h.lines(), /pomocnik AI/);
  assert.match(h.lines(), /w chmurze/);
});

test('notes are saved, listed and removed without a model', async () => {
  const h = helper();
  await h.send('Marek', 'zapisz kupic mleko');
  await h.send('Marek', 'moje notatki');
  assert.match(h.lines(), /Marek> \d+: kupic mleko/);
  const id = h.notes.list('Marek', 5)[0].id;
  await h.send('Marek', `usun ${id}`);
  assert.deepEqual(h.notes.list('Marek', 5), []);
});

test('a note belongs to its owner', async () => {
  const h = helper();
  await h.send('Marek', 'zapisz pin do telefonu 1234');
  const id = h.notes.list('Marek', 5)[0].id;
  await h.send('Obcy', `usun ${id}`);
  assert.equal(h.notes.list('Marek', 5).length, 1, 'nobody removes what is not theirs');
  await h.send('Obcy', 'moje notatki');
  assert.doesNotMatch(h.lines(), /Obcy> .*1234/);
});

test('a model sees only the notes of the person asking', async () => {
  const prompts: string[] = [];
  const client: ModelClient = {
    available: () => true,
    chat: async (m) => { prompts.push(m.map((x) => x.content).join('\n')); return { text: '{"say":"masz mleko na liscie"}', totalMs: 1, evalCount: 1, promptCount: 1, evalMs: 1, loadMs: 0 }; },
  };
  const h = helper(client);
  await h.send('Marek', 'zapisz kupic mleko');
  await h.send('Obcy', 'zapisz tajny plan');
  await h.send('Marek', 'co mam kupic?');
  assert.match(prompts[0], /kupic mleko/);
  assert.doesNotMatch(prompts[0], /tajny plan/);
  assert.match(h.lines(), /Marek> masz mleko na liscie/);
});

test('nothing said to the helper reaches the memory of the world', async () => {
  const h = helper();
  await h.send('Marek', 'zapisz moja tajemnica');
  const events = h.store.db.prepare('SELECT COUNT(*) AS n FROM npc_events').get() as { n: number };
  assert.equal(events.n, 0);
});

test('the words on the local chat are not its business', async () => {
  const h = helper();
  await h.send('Marek', 'zapisz cos', false);
  assert.deepEqual(h.notes.list('Marek', 5), []);
});

test('a reminder comes once and at its time', async () => {
  const h = helper();
  await h.send('Marek', 'przypomnij za 10 min wyjac pranie');
  assert.doesNotMatch(h.lines(), /przypominam/);
  h.advance(601_000);
  h.mind.tick();
  assert.match(h.lines(), /Marek> przypominam: wyjac pranie/);
  const count = () => (readFileSync(join(h.dir, 'orders.json'), 'utf8').match(/przypominam/g) ?? []).length;
  h.mind.tick();
  assert.equal(count(), 1);
});

test('notes survive a restart and work without a model budget', async () => {
  const client: ModelClient = { available: () => false, chat: async () => { throw new Error('not reached'); } };
  const h = helper(client);
  await h.send('Marek', 'zapisz wazna rzecz');
  const again = h.start();
  await h.send('Marek', 'lista', true, again);
  assert.match(h.lines(), /wazna rzecz/);
  await h.send('Marek', 'jaka jest stolica?', true, again);
  assert.match(h.lines(), /moge tylko pilnowac notatek/);
});

test('a question waits for a free model instead of being refused', async () => {
  let busy = true;
  let asked = 0;
  const client: ModelClient = {
    available: () => !busy,
    busyForNow: () => busy,
    chat: async () => { asked++; return { text: '{"say":"juz odpowiadam"}', totalMs: 1, evalCount: 1, promptCount: 1, evalMs: 1, loadMs: 0 }; },
  };
  const h = helper(client);
  await h.send('Marek', 'ile to 2+2?');
  assert.equal(asked, 0);
  assert.doesNotMatch(h.lines(), /moge tylko/);
  busy = false;
  h.mind.tick();
  await new Promise((r) => setTimeout(r, 5));
  assert.equal(asked, 1);
  assert.match(h.lines(), /juz odpowiadam/);
});

test('other characters do not start a conversation with the helper', async () => {
  const h = helper();
  appendFileSync(join(h.dir, 'events.jsonl'), `${JSON.stringify({ kind: 'heard', from: 'Sira', text: 'zapisz cos', level: 8, private: true, atMs: 5_000_000 })}\n`);
  h.mind.tick(new Set(['Sira']));
  assert.deepEqual(h.notes.list('Sira', 5), []);
});
