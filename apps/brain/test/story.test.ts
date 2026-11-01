// What stays of a character's life: moments, promises, the weekly line, and how each character leans.
// FAKE model and a simulated body: logic only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Memory } from '../src/memory.ts';
import { DEFAULT_COMPRESSION, MemoryCompressor, type Summarizer } from '../src/npc/compression.ts';
import { NpcMemoryStore } from '../src/npc/store.ts';
import { groundsFor, huntValue, nextGear, optionsFor } from '../src/players/choices.ts';
import { closeStrategy, pullNote, startStrategy, trialNotes } from '../src/players/drives.ts';
import { renderPanel } from '../src/panel.ts';
import { PlayerMind } from '../src/players/mind.ts';
import { addMoment, addRumor, addVow, addWeek, chronicleNotes, isNews, momentNotes, topicsOf, overdueVows, vowNotes, weekOf, weekStart, weigh, whenWords } from '../src/players/story.ts';
import type { BodyState, Experience, Place, PlayerDef, WorldFacts } from '../src/players/types.ts';
import { loadLocalAiConfig, LocalModelClient } from '../src/providers/local-model.ts';
import { tempDir } from './helpers.ts';

const DAY = 86_400_000;
const world: WorldFacts = { monsters: {}, points: [], towns: [{ name: 'Thais', temple: { x: 200, y: 200, z: 7 } }], grounds: [{ name: 'Wilcze Wzgorze', town: 'Thais', tier: 1, monsters: ['Wolf'], x: 150, y: 150, z: 7 }] };
const def: PlayerDef = { character: 'Kael', vocation: 'knight', bravery: 0.5, curiosity: 0.5, sociability: 0.5, greed: 0.5, voice: 'krotko', mischief: 0.3 };
const base: BodyState = { atMs: 0, online: true, name: 'Kael', level: 12, experience: 9000, hp: 200, hpMax: 200, mana: 90, manaMax: 90, x: 100, y: 100, z: 7, target: '', potions: { health: 5, mana: 2 }, seen: [], goalId: 0 };
const spot: Place = { id: 'h:1', name: 'Wilcze Wzgorze', why: 'hunt', doing: 'poluje na Wolf', x: 150, y: 150, z: 7, monsters: ['Wolf'], visits: 3, minutes: 30, exp: 1500, gold: 100, kills: 40, deaths: 0, lastAt: 0 };
const blank = (): Experience => ({ strategy: null, trials: [], overrides: 0, rumors: [], towns: [], lastNewAt: 0, upgrades: {}, moments: {}, vows: [], vowSeq: 0, chronicle: [], lastWeek: 0, lockedDoors: [], beliefs: [], people: {}, known: [], fear: 0.2, confidence: 0.4, boredom: 0.2, loneliness: 0.2, kills: {}, deathsBy: {}, deaths: 0, chunks: {}, floors: [], dangerAt: {}, warnings: {}, plan: '', finding: null, tipsGiven: 0, tipsHeard: 0, grudges: {}, places: {}, news: [], lessons: [], ways: {}, trades: 0, stored: 0, pvpFights: 0, helped: 0, trips: 0, modelChoices: 0, ruleChoices: 0 });
const marek = { name: 'Marek', kind: 'player' as const, hp: 100, x: 101, y: 100, z: 7 };
const fleet = new Set(['Kael', 'Sira']);
const settle = () => new Promise((r) => setTimeout(r, 40));
const START = 1_000 * DAY;
const GOSSIP_START = 700_000; // past the first quiet stretch

function setup(answer: object | Error, saved: Partial<Experience> = {}, character: Partial<PlayerDef> = {}) {
  const dir = join(tempDir(), 'kael');
  mkdirSync(dir, { recursive: true });
  const store = new NpcMemoryStore(new Memory(':memory:'));
  store.setPref('kael', 0, 'mind', JSON.stringify({ ...blank(), ...saved }), 0);
  const prompts: string[] = [];
  const reply = { value: answer };
  const fetcher = (async (_url: string, init: RequestInit) => {
    prompts.push(String(init.body));
    if (reply.value instanceof Error) throw reply.value;
    return new Response(JSON.stringify({ message: { content: JSON.stringify(reply.value) }, eval_count: 5, prompt_eval_count: 50 }));
  }) as unknown as typeof fetch;
  let clock = START;
  const mind = new PlayerMind('kael', { ...def, ...character }, dir, { ...world, identity: 'in_character' }, store, new LocalModelClient(loadLocalAiConfig(), fetcher), 0.35, () => clock);
  return {
    store, mind, prompts, reply,
    body: (over: Partial<BodyState> = {}) => writeFileSync(join(dir, 'state.json'), JSON.stringify({ ...base, atMs: clock, ...over })),
    event: (e: object) => appendFileSync(join(dir, 'events.jsonl'), `${JSON.stringify({ atMs: clock, ...e })}\n`),
    orders: () => JSON.parse(readFileSync(join(dir, 'orders.json'), 'utf8')),
    diary: () => readFileSync(join(dir, 'diary.log'), 'utf8'),
    advance: (ms: number) => { clock += ms; },
    saved: () => {
      clock += 40_000; // characters write down what they know at their next report
      writeFileSync(join(dir, 'state.json'), JSON.stringify({ ...base, atMs: clock }));
      mind.tick(fleet, () => false);
      return JSON.parse(store.prefs('kael', 0).mind) as Experience;
    },
    force: (wanted: object) => writeFileSync(join(dir, 'force.json'), JSON.stringify(wanted)),
  };
}

/** A few minutes of play: a tick spent on one thing leaves the next one for another. */
async function play(h: ReturnType<typeof setup>, times: number, over: Partial<BodyState> = {}): Promise<void> {
  for (let i = 0; i < times; i++) {
    h.advance(200_000);
    h.body(over);
    h.mind.tick(fleet, () => true);
    await settle();
  }
}

const person = (over = {}) => ({ met: 3, together: 1, helped: 0, fights: 0, opinion: 2, lastAt: START - 8 * DAY, ...over });

test('moments stay few and the big ones outlast the small', () => {
  const e = blank();
  addMoment(e, 'Marek', 'Uratowal mnie przed Cyclopsem', 9, 0);
  for (let i = 0; i < 12; i++) addMoment(e, 'Marek', `drobiazg ${i}`, 2, i * DAY);
  addMoment(e, 'Marek', 'drobiazg 11', 2, 12 * DAY);
  assert.equal(e.moments.Marek.length, 8);
  assert.ok(e.moments.Marek.some((m) => m.text.includes('Cyclopsem')));
  assert.equal(e.moments.Marek.filter((m) => m.text === 'drobiazg 11').length, 1, 'the same thing is one memory');
  assert.match(momentNotes(e, 'Marek', 13 * DAY), /13 dni temu: Uratowal/);
});

test('time reads like a person says it', () => {
  assert.equal(whenWords(0, 3_600_000), 'przed chwila');
  assert.equal(whenWords(0, 5 * 3_600_000), '5 godz. temu');
  assert.equal(whenWords(0, 1.5 * DAY), 'wczoraj');
  assert.equal(whenWords(0, 8 * DAY), '8 dni temu');
  assert.equal(whenWords(0, 21 * DAY), '3 tyg. temu');
});

test('a promise is one entry, breaks after two weeks and names its side', () => {
  const e = blank();
  const made = addVow(e, { who: 'me', person: 'Marek', text: 'pomoge ci na wilkach', atMs: 0 })!;
  assert.equal(addVow(e, { who: 'me', person: 'Marek', text: 'pomoge ci na wilkach', atMs: 1 }), null);
  addVow(e, { who: 'them', person: 'Sira', text: 'odda mi 100 zlota', atMs: 10 * DAY });
  assert.match(vowNotes(e, 11 * DAY), new RegExp(`${made.id}\\. obiecales Marek: pomoge`));
  assert.match(vowNotes(e, 11 * DAY), /Sira obiecal tobie: odda/);
  assert.doesNotMatch(vowNotes(e, 11 * DAY, 'Sira'), /Marek/);
  assert.deepEqual(overdueVows(e, 13 * DAY), []);
  assert.deepEqual(overdueVows(e, 15 * DAY).map((v) => v.person), ['Marek']);
  assert.equal(e.vows.length, 1);
});

test('characters lean differently on the same event', () => {
  assert.equal(weigh({ fights: 1.4 }, 'fights', 5), 7);
  assert.equal(weigh({ fights: 0.7 }, 'fights', 5), 4);
  assert.equal(weigh(undefined, 'fights', 5), 5);
  assert.equal(weigh({ danger: 2 }, 'danger', 9), 10);
  assert.equal(weigh({ fights: 2 }, undefined, 5), 5);
});

test('weeks start on Monday and each has one line', () => {
  const monday = Date.UTC(2026, 10, 2);
  assert.equal(weekOf(monday), weekOf(monday + 6.9 * DAY));
  assert.equal(weekOf(monday), weekOf(monday - 1) + 1);
  assert.equal(weekStart(weekOf(monday)), monday);
  const e = blank();
  addWeek(e, 5, 'pierwsza wersja');
  addWeek(e, 5, 'poprawiona');
  assert.equal(e.chronicle.length, 1);
  assert.match(chronicleNotes(e, 3), /poprawiona/);
});

test('someone known returns after days: the character writes first, from what they lived through', async () => {
  const h = setup({ say: 'o marek, pamietasz wilki? chodz na wzgorze' }, { people: { Marek: person() }, moments: { Marek: [{ atMs: START - 8 * DAY, text: 'Wyprawa z Marek: Wilcze Wzgorze, 12 zabitych, 400 exp', weight: 6 }] }, places: { 'h:1': spot } });
  h.body({ seen: [marek] });
  h.mind.tick(fleet, () => true);
  await settle();
  assert.match(h.diary(), /spotkanie po 8 dni temu: Marek \[historia: 1\] -> o marek/);
  const prompt = h.prompts.find((p) => p.includes('WASZA WSPOLNA HISTORIA'))!;
  assert.match(prompt, /8 dni temu: Wyprawa z Marek: Wilcze Wzgorze, 12 zabitych/);
  h.advance(10_000);
  h.mind.tick(fleet, () => false);
  assert.ok(h.orders().say.some((l: { text: string; to?: string }) => l.text.includes('pamietasz wilki') && !l.to), 'said aloud, he stands right there');
});

test('a short absence is no reunion, and bad blood gets no warm hello without a model', async () => {
  const soon = setup({ say: 'x' }, { people: { Marek: person({ lastAt: START - 3_600_000 }) } });
  soon.body({ seen: [marek] });
  soon.mind.tick(fleet, () => false);
  await settle();
  assert.doesNotMatch(soon.diary(), /spotkanie po/);
  const enemy = setup({ say: 'x' }, { people: { Marek: person({ opinion: -3 }) } });
  enemy.body({ seen: [marek] });
  enemy.mind.tick(fleet, () => false);
  await settle();
  assert.match(enemy.diary(), /spotkanie po .*\(bez slowa\)/);
  const friend = setup({ say: 'x' }, { people: { Marek: person() } });
  friend.body({ seen: [marek] });
  friend.mind.tick(fleet, () => false);
  await settle();
  assert.match(friend.diary(), /-> siema Marek, dawno cie nie bylo/);
});

test('a friend logging in after days gets a private word', async () => {
  const h = setup({ say: 'wrociles, ide na wilki, chcesz?' }, { people: { Marek: person() } });
  h.body();
  h.mind.tick(fleet, () => false);
  await settle();
  h.advance(1000);
  h.event({ kind: 'vip', from: 'Marek', online: true });
  h.body();
  h.mind.tick(fleet, () => true);
  await settle();
  h.advance(10_000);
  h.mind.tick(fleet, () => false);
  assert.ok(h.orders().say.some((l: { text: string; to?: string }) => l.text.includes('wrociles') && l.to === 'Marek'));
});

test('a promise made in talk is kept in mind, reaches the next decision and can be kept by arriving', async () => {
  const h = setup({ say: 'jasne, jutro ci pomoge', promise: 'pomoge Markowi na Wilcze Wzgorze', their_promise: '', note: 'Marek to informatyk z Krakowa' }, {});
  h.body({ seen: [marek] });
  h.event({ kind: 'heard', from: 'Marek', text: 'Kael pomozesz mi jutro?', level: 8 });
  h.mind.tick(fleet, () => true);
  await settle();
  assert.match(h.diary(), /obiecalem: pomoge Markowi/);
  h.reply.value = { choice: 'town', thought: 'x', plan: 'y', say: '' };
  await play(h, 4);
  const decision = h.prompts.filter((p) => p.includes('MOZLIWOSCI')).at(-1)!;
  assert.match(decision, /OBIETNICE/);
  assert.match(decision, /vow_1: dotrzymaj slowa danego Marek/, 'a promise with a place is something to do, not just to know');
  const e = h.saved();
  assert.deepEqual(e.vows[0].place, { name: 'Wilcze Wzgorze', x: 150, y: 150, z: 7 });
  assert.ok(e.moments.Marek.some((m) => m.text.includes('informatyk')));
});

test('a promise broken by time stays as a memory and costs trust', async () => {
  const h = setup({ say: '' }, { people: { Marek: person({ lastAt: START - DAY, opinion: 2 }) }, vows: [{ id: 1, who: 'them', person: 'Marek', text: 'odda mi zloto', atMs: START - 15 * DAY }], vowSeq: 1 });
  h.body();
  h.mind.tick(fleet, () => false);
  await settle();
  h.advance(40_000);
  h.body();
  h.mind.tick(fleet, () => false);
  const e = h.saved();
  assert.equal(e.vows.length, 0);
  assert.equal(e.people.Marek.opinion, 1);
  assert.ok(e.moments.Marek.some((m) => /nie dotrzymal slowa/.test(m.text)));
});

test('a person talked into a trip is led to a real place, and a trip leaves numbers behind', async () => {
  const h = setup({ say: 'dobra, chodz za mna', lead_to: 'p1' }, { places: { 'h:1': spot } });
  h.body({ seen: [marek] });
  h.event({ kind: 'heard', from: 'Marek', text: 'Kael zabierz mnie na exp', level: 8 });
  h.mind.tick(fleet, () => true);
  await settle();
  assert.match(h.diary(), /prowadze Marek: Wilcze Wzgorze/);
  h.reply.value = { say: 'to tyle', follow: 'stop_following' };
  h.advance(5000);
  h.body({ seen: [marek], experience: 9300 });
  h.mind.tick(fleet, () => false);
  h.advance(5000);
  h.event({ kind: 'heard', from: 'Marek', text: 'dzieki, koncze', level: 8 });
  h.body({ seen: [marek], experience: 9300 });
  h.mind.tick(fleet, () => true);
  await settle();
  const e = h.saved();
  assert.equal(e.people.Marek.together, 1);
  assert.ok(e.moments.Marek.some((m) => m.text.startsWith('Wyprawa z Marek: Wilcze Wzgorze')));
});

test('a model cannot lead anyone to a place the character does not know', async () => {
  const h = setup({ say: 'chodz', lead_to: 'p7' }, { places: { 'h:1': spot } });
  h.body({ seen: [marek] });
  h.event({ kind: 'heard', from: 'Marek', text: 'Kael gdzie idziemy?', level: 8 });
  h.mind.tick(fleet, () => true);
  await settle();
  assert.doesNotMatch(h.diary(), /prowadze/);
});

test('liked people join the friends list; the fleet and the helper stay out of it', async () => {
  const h = setup({ say: '' }, { people: { Marek: person({ lastAt: START }), Obcy: person({ lastAt: START, opinion: 0, together: 0 }), Sira: person({ lastAt: START }) } });
  h.body();
  h.mind.tick(fleet, () => false);
  await settle();
  assert.deepEqual(h.orders().addVip, ['Marek']);
});

test('a friend gets a joke, not a fight: it is offered only when both are healthy', () => {
  const friendNear = { ...base, vips: [{ name: 'Sira', online: true }], mischief: 0.3, seen: [{ ...marek, name: 'Sira', hp: 90 }] };
  const options = (over: object) => optionsFor({ ...friendNear, ...over }, world, blank()).map((o) => o.id);
  assert.ok(options({}).includes('prank_sira'));
  assert.ok(!options({}).includes('attack_sira'), 'no real attack on a friend without a reason');
  assert.ok(!options({ mischief: 0 }).includes('prank_sira'));
  assert.ok(!options({ hp: 100 }).includes('prank_sira'));
  assert.ok(!options({ seen: [{ ...marek, name: 'Sira', hp: 40 }] }).includes('prank_sira'));
});

test('a joke stops as soon as it stops being funny', async () => {
  const h = setup({ say: '' });
  const sira = (hp: number) => ({ seen: [{ ...marek, name: 'Sira', hp }] });
  h.force({ prank: 'Sira' });
  h.body(sira(95));
  h.mind.tick(fleet, () => false);
  assert.equal(h.orders().pvp, 'Sira');
  assert.match(h.diary(), /zaczepiam dla zartu: Sira/);
  h.advance(2000);
  h.body(sira(45));
  h.mind.tick(fleet, () => false);
  assert.equal(h.orders().pvp, undefined, 'the attack is called off');
  assert.match(h.diary(), /koniec zartu z Sira/);
  const e = h.saved();
  assert.equal(e.pvpFights, 1);
  assert.ok(e.moments.Sira.some((m) => m.text.includes('dla zartu')));
});

test('a joke also ends on time, and a real fight lasts longer', async () => {
  const h = setup({ say: '' });
  h.force({ prank: 'Sira' });
  const near = { seen: [{ ...marek, name: 'Sira', hp: 95 }] };
  h.body(near);
  h.mind.tick(fleet, () => false);
  h.advance(13_000);
  h.body(near);
  h.mind.tick(fleet, () => false);
  assert.equal(h.orders().pvp, undefined);
});

test('compression waits longer for a character who holds days in detail', async () => {
  const store = new NpcMemoryStore(new Memory(':memory:'));
  for (const npcKey of ['ravn', 'kael']) {
    store.addEvent({ eventKey: `${npcKey}:old`, npcKey, kind: 'witnessed', subjectGuid: null, actorName: 'ty', text: `Stary dzien ${npcKey}`, source: 'witnessed', certainty: 'confirmed', visibility: 'public', importance: 5, worldSessionId: 'players', realAtMs: START - 9 * DAY });
  }
  const summarizer: Summarizer = { summarize: async () => ({ summary: 'Streszczenie tamtego dnia z zycia.', importance: 5 }) };
  const report = await new MemoryCompressor(store, summarizer, { ...DEFAULT_COMPRESSION, retentionByNpc: { ravn: 14 * DAY } }, () => START).run();
  assert.equal(report.compressed, 1);
  assert.equal(store.visibleEvents('ravn', 0, 5).length, 1, 'Ravn still has it in detail');
  assert.equal(store.visibleEvents('kael', 0, 5).length, 0);
  assert.equal(store.visibleMemories('kael', 0, 5).length, 1);
});

test('compression leaves moments and promises alone', async () => {
  const h = setup({ say: '' }, { vows: [{ id: 1, who: 'me', person: 'Marek', text: 'pomoge ci', atMs: START }], vowSeq: 1, moments: { Marek: [{ atMs: START - 30 * DAY, text: 'Wyprawa', weight: 6 }] } });
  const summarizer: Summarizer = { summarize: async () => ({ summary: 'Streszczenie tamtego dnia z zycia.', importance: 5 }) };
  await new MemoryCompressor(h.store, summarizer, DEFAULT_COMPRESSION, () => START + 60 * DAY).run();
  const e = h.saved();
  assert.equal(e.vows.length, 1);
  assert.equal(e.moments.Marek.length, 1);
});

test('once a week the character writes its own line, and later decisions read it', async () => {
  const h = setup({ text: 'Ten tydzien to wilki z Kaelem i smierc od Cyclopsa.' });
  h.body();
  h.mind.tick(fleet, () => false);
  await settle();
  h.store.addEvent({ eventKey: 'k:1', npcKey: 'kael', kind: 'witnessed', subjectGuid: null, actorName: 'ty', text: 'Zginalem przez: Cyclops.', source: 'witnessed', certainty: 'confirmed', visibility: 'public', importance: 9, worldSessionId: 'players', realAtMs: START + 1000 });
  h.advance(8 * DAY);
  await play(h, 3); // the beliefs come first, the week after them
  assert.match(h.diary(), /tydzien w skrocie: Ten tydzien/);
  assert.equal(h.saved().chronicle.length, 1);
  h.reply.value = { choice: 'town', thought: 'x', plan: 'y', say: '' };
  await play(h, 4);
  assert.ok(h.prompts.filter((p) => p.includes('MOZLIWOSCI')).at(-1)!.includes('TWOJA HISTORIA'));
});

test('the toolbox page shows a character, escapes what people typed and never touches private notes', () => {
  const memory = new Memory(':memory:');
  const store = new NpcMemoryStore(memory);
  const hostile = '<script>alert(1)</script>';
  store.setPref('kael', 0, 'mind', JSON.stringify({ ...blank(), plan: 'na wilki', beliefs: [hostile], moments: { Marek: [{ atMs: START, text: 'Wyprawa z Marek', weight: 6 }] }, people: { Marek: person() } }), START);
  memory.db.prepare(`INSERT INTO assistant_notes (owner, text, created_at_ms, done) VALUES ('Marek', 'tajna notatka', 1, 0)`).run();
  const page = renderPanel(tempDir(), memory.db, { kael: def, notka: { ...def, character: 'Notka', role: 'assistant' } }, START + DAY, 1000);
  assert.match(page, /na wilki/);
  assert.match(page, /wczoraj: Wyprawa z Marek/);
  assert.ok(page.includes('&lt;script&gt;'));
  assert.ok(!page.includes(hostile));
  assert.ok(!page.includes('tajna notatka'));
  assert.ok(!page.includes('<h3>Notka'), 'the helper is not a character');
});

const shelf = { npc: 'Sam', x: 120, y: 100, z: 7, items: [
  { id: 1, name: 'soldier helmet', price: 110, slot: 1, value: 5, level: 0, weight: 32 },
  { id: 2, name: 'steel helmet', price: 580, slot: 1, value: 6, level: 0, weight: 46 },
  { id: 3, name: 'scale armor', price: 260, slot: 4, value: 9, level: 0, weight: 105 },
  { id: 4, name: 'dwarven shield', price: 500, slot: 5, value: 26, level: 0, weight: 100 },
  { id: 5, name: 'knight armor', price: 150, slot: 4, value: 12, level: 40, weight: 120 },
] };
const values = { 10: { slot: 1, value: 3 }, 11: { slot: 4, value: 8 }, 12: { slot: 5, value: 14 } };
const shopWorld = { ...world, gearShop: shelf, gearValues: values };
const worn = { 1: 10, 4: 11, 5: 12 };

test('armour is bought for protection per coin, keeping money for potions and within its level', () => {
  assert.equal(nextGear({ ...base, gold: 300, worn }, shopWorld)?.name, 'soldier helmet');
  assert.equal(nextGear({ ...base, gold: 150, worn: { ...worn, 1: 0 } }, shopWorld), null, 'nothing left for potions');
  assert.equal(nextGear({ ...base, gold: 300, cap: 25, worn }, shopWorld), null, 'the server refuses what cannot be carried');
  assert.equal(nextGear({ ...base, gold: 5000, worn: { 1: 2, 4: 11, 5: 12 } }, { ...shopWorld, gearValues: { ...values, 2: { slot: 1, value: 6 }, 12: { slot: 5, value: 26 } } })?.name, 'scale armor', 'the helmet is already better');
  assert.equal(nextGear({ ...base, gold: 5000, worn: { 1: 2, 4: 3, 5: 4 } }, { ...shopWorld, gearValues: { 2: { slot: 1, value: 6 }, 3: { slot: 4, value: 9 }, 4: { slot: 5, value: 26 } } }), null, 'the best there is');
  assert.equal(nextGear({ ...base, gold: 5000, worn: { 1: 10, 4: 11, 5: 3350 } }, { ...shopWorld, gearValues: { 10: { slot: 1, value: 6 }, 11: { slot: 4, value: 9 } } }), null, 'no shield in place of a bow');
});

test('a purchase walks to the merchant, greets, buys, and the new piece goes on; lost gear falls back', async () => {
  const h = setup({ choice: 'gear_1', thought: 'lepszy helm', plan: 'p', say: '' }, {}, { kit: 'novice' });
  (h.mind as unknown as { world: WorldFacts }).world.gearShop = shelf;
  (h.mind as unknown as { world: WorldFacts }).world.gearValues = values;
  (h.mind as unknown as { world: WorldFacts }).world.gear = { novice: [{ id: 10, slot: 1 }, { id: 11, slot: 4 }] };
  h.body({ gold: 400, worn, have: { 10: 1, 11: 1 }, x: 119 });
  h.mind.tick(fleet, () => true);
  await settle();
  assert.match(h.diary(), /gear_1: /);
  h.force({ route: { x: 119, y: 100, z: 7 } });
  const mind = h.mind as unknown as { errand: string; buying: object; startErrand: (s: BodyState) => void };
  mind.errand = 'shop';
  mind.buying = shelf.items[0];
  mind.startErrand({ ...base, gold: 400 });
  assert.equal(h.orders().goal.type, 'trade');
  assert.equal(h.orders().goal.greet, true);
  assert.deepEqual(h.orders().goal.buy, [{ id: 1, count: 1 }]);
  h.event({ kind: 'message', text: 'Bought 1x soldier helmet for 110 gold coin.' });
  h.event({ kind: 'trade_done', money: 290 });
  h.advance(1000);
  h.body({ gold: 290, worn, have: { 1: 1, 10: 1, 11: 1 } });
  h.mind.tick(fleet, () => false);
  await settle();
  h.mind.tick(fleet, () => false);
  assert.ok(h.orders().wear.some((w: { id: number; slot: number }) => w.id === 1 && w.slot === 1), 'the body is told to wear it');
  assert.match(h.diary(), /kupione: soldier helmet/);
  h.body({ gold: 290, worn: { ...worn, 1: 1 }, have: { 1: 1, 11: 1 } });
  h.mind.tick(fleet, () => false);
  await settle();
  assert.ok(h.orders().wear.some((w: { id: number }) => w.id === 1), 'worn, so it stays');
  h.body({ gold: 290, worn: { ...worn, 1: 0 }, have: { 10: 0, 11: 1 } });
  h.mind.tick(fleet, () => false);
  await settle();
  h.advance(61_000);
  h.body({ gold: 290, worn: { ...worn, 1: 0 }, have: { 10: 0, 11: 1 } });
  h.mind.tick(fleet, () => false);
  await settle();
  assert.ok(h.orders().wear.some((w: { id: number; slot: number }) => w.id === 10 && w.slot === 1), 'without it, the old plan again');
});

const far = { name: 'Carlin', temple: { x: 300, y: 300, z: 7 } };

test('a character that saw nothing new for long goes on a journey, if it can pay for it', async () => {
  const h = setup(new Error('model down'), { towns: ['Thais'], lastNewAt: START - DAY, confidence: 0.4 });
  (h.mind as unknown as { world: WorldFacts }).world.towns = [world.towns[0], far];
  (h.mind as unknown as { nav: unknown }).nav = { route: () => [{ x: 300, y: 300, z: 7 }], walkable: () => true, nearestWalkable: () => null, linkTarget: () => null };
  h.body({ gold: 500, x: 195, y: 195 });
  h.mind.tick(fleet, () => true);
  await settle();
  assert.match(h.diary(), /travel_carlin: ile mozna w jednym miejscu/);
});

test('without the money for the boat nobody sets off', async () => {
  const h = setup({ choice: 'town', thought: 'wracam', plan: 'p', say: '' }, { towns: ['Thais'], lastNewAt: START - DAY });
  (h.mind as unknown as { world: WorldFacts }).world.towns = [world.towns[0], far];
  (h.mind as unknown as { nav: unknown }).nav = { route: () => [{ x: 300, y: 300, z: 7 }], walkable: () => true, nearestWalkable: () => null, linkTarget: () => null };
  h.body({ gold: 50, x: 195, y: 195 });
  h.mind.tick(fleet, () => true);
  await settle();
  assert.doesNotMatch(h.diary(), /travel_/);
});

test('reaching a new town is remembered, told and calms the itch', async () => {
  const h = setup({ say: '' }, { towns: ['Thais'], lastNewAt: START - DAY });
  (h.mind as unknown as { world: WorldFacts }).world.towns = [world.towns[0], far];
  h.body({ x: 200, y: 200, vips: [{ name: 'Marek', online: true }] });
  h.mind.tick(fleet, () => false);
  await settle();
  assert.doesNotMatch(h.diary(), /NOWE MIASTO/);
  h.advance(1000);
  h.body({ x: 298, y: 300, vips: [{ name: 'Marek', online: true }] });
  h.mind.tick(fleet, () => false);
  await settle();
  assert.match(h.diary(), /NOWE MIASTO: Carlin \(2 z 2\)/);
  h.advance(10_000);
  h.mind.tick(fleet, () => false);
  assert.ok(h.orders().say.some((l: { text: string; to?: string }) => l.text.includes('Carlin') && l.to === 'Marek'));
  assert.deepEqual(h.saved().towns, ['Thais', 'Carlin']);
});

test('someone broke earns first instead of walking to a shop with nothing', async () => {
  const h = setup(new Error('model down'), {});
  h.body({ gold: 0, potions: { health: 0, mana: 0 }, seen: [{ ...marek, name: 'Rat', kind: 'monster' }] });
  h.mind.tick(fleet, () => false);
  await settle();
  assert.match(h.diary(), /fight: nie mam za co kupic/);
});

test('a character sees its own pace and which towns it has not seen', async () => {
  const h = setup({ choice: 'town', thought: 'x', plan: 'y', say: '' }, { towns: ['Thais'] });
  h.body({ experience: 9000 });
  h.mind.tick(fleet, () => false);
  await settle();
  h.advance(700_000);
  h.body({ experience: 9700 });
  h.mind.tick(fleet, () => true);
  await settle();
  const decision = h.prompts.filter((p) => p.includes('MOZLIWOSCI')).at(-1)!;
  assert.match(decision, /TWOJE TEMPO: 3600 exp na godzine/);
  assert.match(decision, /SWIAT: byles w Thais/);
});

test('hearsay stays hearsay, fades after a day and ordinary chat is not news', () => {
  const e = blank();
  e.news = ['wbilem poziom 13'];
  addRumor(e, { text: 'Kael zginal na Cyclopsie', from: 'Sira', atMs: 0 });
  addRumor(e, { text: 'Kael zginal na Cyclopsie', from: 'Ravn', atMs: 1 });
  assert.equal(e.rumors.length, 1);
  assert.deepEqual(topicsOf(e, 1000), ['sam przezyles: wbilem poziom 13', 'slyszales od Sira, nie widziales tego sam: Kael zginal na Cyclopsie']);
  assert.deepEqual(topicsOf(e, 2 * DAY), ['sam przezyles: wbilem poziom 13']);
  assert.ok(isNews('Ravn napadl mnie pod Thais'));
  assert.ok(!isNews('siema, co tam?'));
});

test('with someone around a character brings up what happened, out loud and with the name of a person', async () => {
  const h = setup({ say: 'Marek slyszales, ze Kael zginal na Cyclopsie?' }, { rumors: [{ text: 'Kael zginal na Cyclopsie', from: 'Sira', atMs: START }], people: { Marek: person({ lastAt: START }) } });
  h.advance(GOSSIP_START);
  h.body({ seen: [marek] });
  h.mind.tick(fleet, () => true);
  await settle();
  h.mind.tick(fleet, () => true);
  await settle();
  assert.match(h.diary(), /zagaduje: Marek slyszales/);
  assert.ok(h.prompts.some((p) => p.includes('O CZYM MOZESZ POGADAC') && p.includes('slyszales od Sira')));
  h.advance(10_000);
  h.mind.tick(fleet, () => false);
  assert.ok(h.orders().say.some((l: { text: string; to?: string }) => l.text.includes('Cyclopsie') && !l.to), 'aloud, never private');
});

test('alone or in a fight nobody gossips, and a tight budget means no model call for it', async () => {
  const alone = setup({ say: 'x' }, { rumors: [{ text: 'smok w Thais', from: 'Sira', atMs: START }] });
  alone.advance(GOSSIP_START);
  alone.body();
  alone.mind.tick(fleet, () => false);
  await settle();
  assert.doesNotMatch(alone.diary(), /zagaduje/);
  const busy = setup({ say: 'x' }, { rumors: [{ text: 'smok w Thais', from: 'Sira', atMs: START }], people: { Marek: person({ lastAt: START }) } });
  busy.advance(GOSSIP_START);
  busy.body({ seen: [marek], target: 'Rat' });
  busy.mind.tick(fleet, () => true);
  await settle();
  assert.doesNotMatch(busy.diary(), /zagaduje/);
});

test('side by side friends talk aloud: a private line from one beside you gets no answer, a person always does', async () => {
  const h = setup({ say: 'hej' }, {});
  h.body({ seen: [{ ...marek, name: 'Sira' }] });
  h.event({ kind: 'heard', from: 'Sira', text: 'Kael co tam', level: 8, private: true });
  h.mind.tick(fleet, () => true);
  await settle();
  assert.doesNotMatch(h.diary(), /Sira: Kael co tam ->/);
  h.advance(10_000);
  h.event({ kind: 'heard', from: 'Marek', text: 'Kael co tam', level: 8, private: true });
  h.body();
  h.mind.tick(fleet, () => true);
  await settle();
  h.mind.tick(fleet, () => true);
  await settle();
  assert.match(h.diary(), /Marek: Kael co tam -> hej/);
});

test('a person asking what is new hears about it, hearsay marked in the prompt', async () => {
  const h = setup({ say: 'podobno Kael zginal' }, { rumors: [{ text: 'Kael zginal na Cyclopsie', from: 'Sira', atMs: START }] });
  h.body({ seen: [marek] });
  h.event({ kind: 'heard', from: 'Marek', text: 'Kael co nowego?', level: 8 });
  h.mind.tick(fleet, () => true);
  await settle();
  h.mind.tick(fleet, () => true);
  await settle();
  assert.ok(h.prompts.some((p) => p.includes('CO SLYCHAC W SWIECIE') && p.includes('slyszales od Sira')));
});

test('what the server announces to everyone becomes something to talk about', async () => {
  const h = setup({ say: '' }, {});
  h.body();
  h.event({ kind: 'message', text: "Today's boosted creature: Blood Beast." });
  h.event({ kind: 'message', text: 'Orcs are attacking Thais!', broadcast: true });
  h.event({ kind: 'message', text: 'You are full.' });
  h.event({ kind: 'message', text: 'Server is saving the game in 4 minute(s). Please logout.', broadcast: true });
  h.mind.tick(fleet, () => false);
  await settle();
  const e = h.saved();
  assert.deepEqual(e.rumors.map((r) => r.from), ['serwer', 'serwer']);
  assert.ok(e.rumors.some((r) => r.text.includes('Orcs')));
});

test('a refused purchase is not a purchase, and the character stops asking for a while', async () => {
  const h = setup({ say: '' }, {}, { kit: 'novice' });
  (h.mind as unknown as { world: WorldFacts }).world.gear = { novice: [{ id: 10, slot: 1 }] };
  const mind = h.mind as unknown as { errand: string; buying: object };
  h.body({ gold: 400, worn, have: { 10: 1 } });
  h.mind.tick(fleet, () => false);
  await settle();
  mind.errand = 'shop';
  mind.buying = shelf.items[0];
  h.event({ kind: 'message', text: 'Bought 0x soldier helmet for 0 gold coin.' });
  h.event({ kind: 'trade_done', money: 400 });
  h.advance(1000);
  h.body({ gold: 400, worn, have: { 10: 1 } });
  h.mind.tick(fleet, () => false);
  await settle();
  assert.match(h.diary(), /sklep odmowil: soldier helmet/);
  assert.doesNotMatch(h.diary(), /kupione/);
  assert.deepEqual(h.saved().upgrades, {});
});

test('spare weapons and replaced armour go to the depot, what is in hand stays', () => {
  const h = setup({ say: '' }, { upgrades: { 1: 1 } }, { kit: 'novice' });
  (h.mind as unknown as { world: WorldFacts }).world.gear = { novice: [{ id: 10, slot: 1 }, { id: 11, slot: 4 }] };
  const notNeeded = (h.mind as unknown as { notNeeded: (s: BodyState) => number[] }).notNeeded.bind(h.mind);
  assert.deepEqual(notNeeded({ ...base, worn: { 1: 1, 4: 11, 6: 7774 } }), [3327, 10]);
});

test('an archer with no arrows and no money gets the declared kit, a self reliant one does not', async () => {
  const stuck = { vocation: 'paladin', gold: 0, arrows: 0, worn: {} };
  const h = setup({ say: '' });
  h.body(stuck);
  h.mind.tick(fleet, () => false);
  await settle();
  assert.equal(h.orders().needKit, 1);
  const own = setup({ say: '' }, {}, { selfReliant: true });
  own.body(stuck);
  own.mind.tick(fleet, () => false);
  await settle();
  assert.equal(own.orders().needKit, undefined);
});

test('money that could buy real protection does not stay in the purse', async () => {
  const h = setup(new Error('model down'), { towns: ['Thais'] });
  (h.mind as unknown as { world: WorldFacts }).world.gearShop = shelf;
  (h.mind as unknown as { world: WorldFacts }).world.gearValues = values;
  h.body({ gold: 900, worn, x: 150, y: 150 });
  h.mind.tick(fleet, () => true);
  await settle();
  assert.match(h.diary(), /gear_[0-9]: /);
});

const bestiary = { Rat: { health: 20, experience: 5, peakDamage: 8, attacks: [], weakTo: [], hostile: true }, Cyclops: { health: 260, experience: 150, peakDamage: 105, attacks: [], weakTo: [], hostile: true }, Dragon: { health: 1000, experience: 700, peakDamage: 170, attacks: [], weakTo: [], hostile: true } };
const land = (name: string, monster: string, x: number) => ({ name, town: 'Thais', tier: 1, monsters: [monster], x, y: 100, z: 7 });

test('a stronger character is pointed at stronger monsters, not at the nearest rats', () => {
  const facts = { ...world, monsters: bestiary, grounds: [land('szczury', 'Rat', 130), land('cyklopy', 'Cyclops', 200), land('smoki', 'Dragon', 260)] };
  const at = (level: number, hpMax: number) => groundsFor({ ...base, level, hpMax }, facts, blank()).map((g) => g.name);
  assert.deepEqual(at(8, 185), ['szczury'], 'a young knight stays alive');
  assert.equal(at(20, 400)[0], 'cyklopy');
  assert.equal(at(60, 800)[0], 'smoki');
  assert.ok(huntValue(land('x', 'Dragon', 0), { ...base, level: 60, hpMax: 800 }, facts).perHour > huntValue(land('y', 'Rat', 0), { ...base, level: 60, hpMax: 800 }, facts).perHour * 10);
});

test('what pulls a character comes from its nature and its situation, and trouble is named', () => {
  const greedy = { ...def, greed: 1, bravery: 0.1, curiosity: 0.1, sociability: 0.1 };
  const e = { ...blank(), boredom: 0, fear: 0, loneliness: 0 };
  assert.match(pullNote(greedy, e, { money: 10, perHour: null, bestPerHour: 0, troubles: 0 }), /chcesz zarobic/);
  const curious = { ...def, curiosity: 1, greed: 0.1 };
  assert.match(pullNote(curious, { ...e, boredom: 1 }, { money: 10, perHour: null, bestPerHour: 0, troubles: 0 }), /ciagnie cie w nowe miejsca/);
  assert.match(pullNote(def, e, { money: 10, perHour: 100, bestPerHour: 1000, troubles: 4 }), /wolniej niz potrafisz.*zmienic podejscie/);
});

test('a try is measured by the game when it ends, deaths included', () => {
  const e = blank();
  e.strategy = startStrategy('sprobuje cyklopow', { ...base, experience: 1000 }, 500, 2, 0);
  e.deaths = 3;
  closeStrategy(e, { ...base, experience: 3000 }, 900, 1_800_000);
  assert.equal(e.strategy, null);
  assert.deepEqual(e.trials, [{ text: 'sprobuje cyklopow', expPerHour: 4000, moneyPerHour: 800, deaths: 1 }]);
  assert.match(trialNotes(e), /sprobuje cyklopow: 4000 exp\/h, 800 zlota\/h, zgonow 1/);
});

test('a character reviews how it goes, and the next decisions read its try and past results', async () => {
  const h = setup({ beliefs: ['Cyklopy placa'], strategy: 'poluje na cyklopy pol godziny' }, { trials: [{ text: 'szczury', expPerHour: 300, moneyPerHour: 10, deaths: 0 }] });
  h.body();
  h.mind.tick(fleet, () => false);
  await settle();
  h.advance(1_900_000);
  await play(h, 2);
  assert.match(h.diary(), /proba: poluje na cyklopy/);
  h.reply.value = { choice: 'town', thought: 'x', plan: 'y', say: '' };
  await play(h, 3);
  const decision = h.prompts.filter((p) => p.includes('MOZLIWOSCI')).at(-1)!;
  assert.match(decision, /TWOJA OBECNA PROBA: poluje na cyklopy/);
  assert.match(decision, /szczury: 300 exp\/h/);
  assert.match(decision, /CO CIE TERAZ CIAGNIE/);
  assert.match(decision, /PORADNIK DLA TWOJEGO POZIOMU/);
});

test('a good idea the model turns down waits, then wins as a counted reflex', async () => {
  const h = setup({ choice: 'town', thought: 'wole isc', plan: 'p', say: '' }, { towns: ['Thais'] });
  (h.mind as unknown as { world: WorldFacts }).world.gearShop = shelf;
  (h.mind as unknown as { world: WorldFacts }).world.gearValues = values;
  h.body({ gold: 900, worn, x: 150, y: 150 });
  h.mind.tick(fleet, () => true);
  await settle();
  assert.doesNotMatch(h.diary(), /stac mnie/, 'the first refusal is respected');
  await play(h, 6, { gold: 900, worn, x: 150, y: 150 });
  assert.match(h.diary(), /stac mnie na lepszy sprzet/);
  assert.ok(h.saved().overrides >= 1, 'and it shows in the numbers');
});

test('a character lives where it was made: home, known land and the nearest merchant', async () => {
  const h = setup({ say: '' }, {}, { home: 'Carlin' });
  assert.deepEqual(h.saved().towns, ['Carlin']);
  const shops = { ...world, merchant: { name: 'Mira', x: 900, y: 900, z: 7 }, shops: [{ name: 'Sandra', x: 110, y: 100, z: 7 }] };
  const supply = optionsFor(base, shops, blank()).find((o) => o.id === 'supply')!;
  assert.equal(supply.goal.name, 'Sandra');
  assert.equal(supply.goal.greet, true);
});

test('a friend far away gets a private letter now and then, and may be invited', async () => {
  const h = setup({ say: 'co tam w Thais? chodz do mnie na wilki', invite: 'yes' }, { people: { Sira: person({ lastAt: START, opinion: 3 }) } });
  h.body({ vips: [{ name: 'Sira', online: true }] });
  h.advance(1_300_000);
  h.body({ vips: [{ name: 'Sira', online: true }] });
  h.mind.tick(fleet, () => true);
  await settle();
  h.mind.tick(fleet, () => true);
  await settle();
  h.advance(10_000);
  h.mind.tick(fleet, () => false);
  assert.match(h.diary(), /pisze do Sira: co tam w Thais/);
  assert.ok(h.orders().say.some((l: { text: string; to?: string }) => l.to === 'Sira' && l.text.includes('Thais')));
  assert.match(h.diary(), /pytam Sira o wspolna wyprawe/);
});

test('a far friend writing in private gets an answer', async () => {
  const h = setup({ say: 'tu spokojnie' }, {});
  h.body();
  h.event({ kind: 'heard', from: 'Sira', text: 'Kael co tam u ciebie?', level: 8, private: true });
  h.mind.tick(fleet, () => true);
  await settle();
  h.mind.tick(fleet, () => true);
  await settle();
  assert.match(h.diary(), /Sira: Kael co tam u ciebie\? -> tu spokojnie/);
});

test('a veteran puts its kit on although the client does not count the backpack, and leaves starter gear behind', async () => {
  const h = setup({ say: '' }, {}, { kit: 'vet', startLevel: 100 });
  (h.mind as unknown as { world: WorldFacts }).world.gear = { vet: [{ id: 3381, slot: 4 }, { id: 3385, slot: 1 }] };
  h.body({ worn: { 4: 3359, 1: 3354 } });
  h.mind.tick(fleet, () => false);
  await settle();
  h.mind.tick(fleet, () => false);
  assert.ok(h.orders().wear.every((w: { bought?: boolean }) => w.bought), 'the body is told to try without a count');
  const notNeeded = (h.mind as unknown as { notNeeded: (s: BodyState) => number[] }).notNeeded.bind(h.mind);
  assert.ok(notNeeded({ ...base, worn: { 4: 3381 } }).includes(3359));
});

test('a call for help from the other side of the map gets a kind word, not a march', async () => {
  const h = setup({ say: '' }, {});
  h.body();
  h.event({ kind: 'heard', from: 'Sira', text: 'pomocy, Rat mnie bije, jestem 900,900,7', level: 8, private: true });
  h.mind.tick(fleet, () => false);
  await settle();
  assert.match(h.diary(), /prosi o pomoc, ale to za daleko/);
});
