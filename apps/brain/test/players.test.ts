// Minds of player agents with a FAKE model and a simulated body: logic only. Real play is checked
// through scripts\player-agents.ps1 in real clients.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Memory } from '../src/memory.ts';
import { NpcMemoryStore } from '../src/npc/store.ts';
import { chooseByTemperament, groundsFor, needsSupplies, nextLesson, optionsFor, outOfSupplies, tooDangerous } from '../src/players/choices.ts';
import { knowledgeFor, lookupFacts, potionsFor, runesFor, spellsFor, suppliesFor } from '../src/players/knowledge.ts';
import { changeOpinion, personNote, personOf } from '../src/players/people.ts';
import { expPerHour, placeNotes, spotValue } from '../src/players/places.ts';
import { PlayerMind } from '../src/players/mind.ts';
import type { BodyState, Person, PlayerDef, WorldFacts } from '../src/players/types.ts';
import { NavGrid, tileKey } from '../src/players/nav.ts';
import { loadLocalAiConfig, LocalModelClient } from '../src/providers/local-model.ts';
import { tempDir } from './helpers.ts';

const world: WorldFacts = {
  monsters: {
    Rat: { health: 20, experience: 5, peakDamage: 8, attacks: ['melee'], weakTo: [], hostile: true },
    Hydra: { health: 2350, experience: 2100, peakDamage: 320, attacks: ['melee'], weakTo: ['ice'], hostile: true },
  },
  points: [{ x: 110, y: 100, z: 7, kind: 'hole', dir: 'down' }, { x: 90, y: 100, z: 7, kind: 'ladder', dir: 'up' }, { x: 500, y: 500, z: 7, kind: 'stairs', dir: 'down' }, { x: 100, y: 100, z: 8, kind: 'stairs', dir: 'up' }],
  towns: [{ name: 'Thais', temple: { x: 200, y: 200, z: 7 } }],
};
const def: PlayerDef = { character: 'Kael', vocation: 'knight', kit: 'knight', bravery: 0.5, curiosity: 0.5, sociability: 1, greed: 0.5, voice: 'krotko' };
const base: BodyState = { atMs: 0, online: true, name: 'Kael', level: 8, experience: 4200, hp: 185, hpMax: 185, mana: 90, manaMax: 90, x: 100, y: 100, z: 7, target: '', potions: { health: 5, mana: 2 }, seen: [], goalId: 0 };
const exp = { strategy: null, trials: [], overrides: 0, rumors: [], towns: [], lastNewAt: 0, upgrades: {}, moments: {}, vows: [], vowSeq: 0, chronicle: [], lastWeek: 0, lockedDoors: [], beliefs: [], people: {}, known: [], fear: 0.2, confidence: 0.4, boredom: 0.2, loneliness: 0.2, kills: {}, deathsBy: {}, deaths: 0, chunks: {}, floors: [], dangerAt: {}, warnings: {}, plan: '', finding: null, tipsGiven: 0, tipsHeard: 0, grudges: {}, places: {}, news: [], lessons: [], ways: {}, trades: 0, stored: 0, pvpFights: 0, helped: 0, trips: 0, modelChoices: 0, ruleChoices: 0 };
const rat = { name: 'Rat', kind: 'monster' as const, hp: 100, x: 101, y: 100, z: 7 };
const hydra = { ...rat, name: 'Hydra' };

function setup(answer: string | Error, seen: string[] = [], identity?: string, extra: Partial<WorldFacts> = {}, nav: NavGrid | null = null) {
  const dir = join(tempDir(), 'kael');
  mkdirSync(dir, { recursive: true });
  const store = new NpcMemoryStore(new Memory(':memory:'));
  const policy = loadLocalAiConfig();
  const fetcher = (async (_url: string, init: RequestInit) => {
    seen.push(String(init.body));
    if (answer instanceof Error) throw answer;
    return new Response(JSON.stringify({ message: { content: answer }, eval_count: 5, prompt_eval_count: 50 }));
  }) as unknown as typeof fetch;
  let clock = 1_000_000;
  const now = () => clock;
  const mind = new PlayerMind('kael', def, dir, { ...world, identity, ...extra }, store, new LocalModelClient(policy, fetcher), 0.35, now, nav);
  const body = (over: Partial<BodyState> = {}) => writeFileSync(join(dir, 'state.json'), JSON.stringify({ ...base, atMs: clock, ...over }));
  const event = (e: object) => appendFileSync(join(dir, 'events.jsonl'), `${JSON.stringify({ atMs: clock, ...e })}\n`);
  const orders = () => JSON.parse(readFileSync(join(dir, 'orders.json'), 'utf8'));
  const diary = () => readFileSync(join(dir, 'diary.log'), 'utf8');
  const advance = (ms: number) => { clock += ms; };
  return { dir, store, mind, body, event, orders, diary, advance };
}

const names = new Set(['Kael', 'Sira']);
const flush = () => new Promise((r) => setTimeout(r, 40)); // under load 10 ms was sometimes too short

test('options exist here and now: nearby floors, directions, town; nothing the map does not have', () => {
  const ids = optionsFor({ ...base, seen: [rat] }, world, exp).map((o) => o.id);
  assert.deepEqual(ids, ['fight', 'floor_down', 'floor_up', 'town', 'go_north', 'go_south']);
  const down = optionsFor(base, world, exp).find((o) => o.id === 'floor_down')!;
  assert.deepEqual({ x: down.goal.x, kind: down.goal.kind }, { x: 110, kind: 'hole' }, 'the nearest way, not one across the map');
  assert.ok(!optionsFor({ ...base, x: 1000, y: 1000 }, world, exp).some((o) => o.id.startsWith('floor')), 'no floors in reach');
  assert.ok(!optionsFor(base, world, { ...exp, chunks: { '3:2:7': 2 } }).some((o) => o.id === 'go_north'), 'wandering prefers the unknown');
});

test('a route crosses floors through real links and fails when there is no way', () => {
  const grid = new NavGrid();
  const row = 'ffff';
  for (const z of [7, 8]) grid.addChunk(96, 96, z, Array(16).fill(row));
  grid.addChunk(96, 112, 7, Array(16).fill('0000'));
  grid.addChunk(128, 96, 7, Array(16).fill(row));
  grid.addFloorLinks([{ x: 100, y: 100, z: 7, kind: 'ladder', dir: 'down' }]);
  assert.equal(grid.linkCount, 1);
  const down = grid.route({ x: 110, y: 100, z: 7 }, { x: 105, y: 105, z: 8 })!;
  assert.ok(down.some((s) => s.kind === 'ladder' && s.z === 7), JSON.stringify(down));
  assert.deepEqual(down.at(-1), { x: 105, y: 105, z: 8 });
  assert.equal(grid.route({ x: 100, y: 100, z: 7 }, { x: 130, y: 100, z: 7 }), null, 'a gap on the map');
  assert.equal(grid.walkable(96, 96, 7), true);
  assert.equal(grid.walkable(96, 112, 7), false);
});

test('a teleport links distant places, also beyond x 16384', () => {
  const grid = new NavGrid();
  grid.addChunk(96, 96, 7, Array(16).fill('ffff'));
  grid.addChunk(20000, 96, 7, Array(16).fill('ffff'));
  grid.addFloorLinks([{ x: 100, y: 100, z: 7, kind: 'teleport', dir: 'up', to: { x: 20004, y: 100, z: 7 } }]);
  const route = grid.route({ x: 97, y: 100, z: 7 }, { x: 20008, y: 100, z: 7 })!;
  assert.ok(route.some((s) => s.kind === 'teleport' && s.to?.x === 20004), JSON.stringify(route));
  assert.deepEqual(route.at(-1), { x: 20008, y: 100, z: 7 });
});

test('a one-way teleport leads to a place a character could never return from', () => {
  const grid = new NavGrid();
  grid.addChunk(96, 96, 7, Array(16).fill('ffff'));
  grid.addChunk(960, 96, 7, Array(16).fill('ffff'));
  grid.addFloorLinks([{ x: 100, y: 100, z: 7, kind: 'teleport', dir: 'up', to: { x: 964, y: 100, z: 7 } }]);
  const home = { x: 97, y: 100, z: 7 };
  const reach = grid.reachableFrom(home);
  assert.ok(reach.has(tileKey(964, 100, 7)), 'it can be reached');
  const back = grid.returnableTo(home, reach);
  assert.ok(!back.has(tileKey(964, 100, 7)), 'but not left');
  assert.ok(back.has(tileKey(105, 100, 7)));
});

test('tile keys survive coordinates above 32768, where most of the real world lies', () => {
  const grid = new NavGrid();
  grid.addChunk(32944, 32016, 6, Array(16).fill('ffff'));
  const from = { x: 32950, y: 32020, z: 6 };
  assert.deepEqual(grid.route(from, { x: 32956, y: 32021, z: 6 })?.at(-1), { x: 32956, y: 32021, z: 6 });
  assert.ok(grid.reachableFrom(from).has(tileKey(32956, 32021, 6)));
  assert.notEqual(tileKey(40000, 100, 7), tileKey(7232, 101, 7));
});

test('a passage is a paid link from beside the captain, and only for those who can pay', () => {
  const grid = new NavGrid();
  grid.addChunk(96, 96, 6, Array(16).fill('ffff'));
  grid.addChunk(20000, 96, 6, Array(16).fill('ffff'));
  grid.addBoats([{ npc: 'Captain', x: 100, y: 100, z: 6, stops: [{ word: 'venore', price: 170, to: { x: 20004, y: 100, z: 6 } }] }]);
  const route = grid.route({ x: 97, y: 100, z: 6 }, { x: 20006, y: 100, z: 6 }, undefined, 200)!;
  const sail = route.find((s) => s.kind === 'boat')!;
  assert.equal(sail.word, 'venore');
  assert.deepEqual({ x: sail.x, y: sail.y }, { x: 100, y: 100 }, 'the leg names the captain');
  assert.equal(grid.route({ x: 97, y: 100, z: 6 }, { x: 20006, y: 100, z: 6 }, undefined, 100), null, 'no money, no passage');
  const reach = grid.reachableFrom({ x: 97, y: 100, z: 6 });
  assert.ok(reach.has(tileKey(20006, 100, 6)));
  assert.ok(!grid.returnableTo({ x: 97, y: 100, z: 6 }, reach).has(tileKey(20006, 100, 6)), 'no captain sails back here');
});

test('a route does not cross stairs by accident and opens doors', () => {
  const grid = new NavGrid();
  grid.addChunk(96, 96, 7, Array(16).fill('ffff'));
  grid.addChunk(96, 96, 6, Array(16).fill('ffff'));
  grid.addFloorLinks([{ x: 104, y: 96, z: 7, kind: 'stairs', dir: 'up' }]);
  const route = grid.route({ x: 100, y: 96, z: 7 }, { x: 108, y: 96, z: 7 })!;
  assert.ok(route.every((s) => !s.kind), JSON.stringify(route));
  assert.ok(grid.route({ x: 100, y: 96, z: 7 }, { x: 104, y: 96, z: 6 })!.some((s) => s.kind === 'stairs'));
  const walled = new NavGrid();
  const row = 'f7ff'; // a wall in column 4
  walled.addChunk(96, 96, 7, Array(16).fill(row), [[100, 100]]);
  const through = walled.route({ x: 98, y: 100, z: 7 }, { x: 103, y: 100, z: 7 })!;
  assert.ok(through.some((s) => s.kind === 'door' && s.x === 100 && s.y === 100), JSON.stringify(through));
  assert.equal(walled.route({ x: 98, y: 100, z: 7 }, { x: 103, y: 100, z: 7 }, new Set([tileKey(100, 100, 7)])), null, 'a locked door is remembered');
  assert.ok(walled.reachableFrom({ x: 98, y: 100, z: 7 }).has(tileKey(103, 100, 7)));
});

test('spells and hunting grounds fit the character', () => {
  const spells = {
    'Light Healing': { words: 'exura', group: 'healing', level: 8, mana: 20, premium: false, vocations: ['sorcerer', 'knight'], needsTarget: false },
    'Great Heal': { words: 'exura gran', group: 'healing', level: 30, mana: 70, premium: false, vocations: ['sorcerer'], needsTarget: false },
    Strike: { words: 'exori min flam', group: 'attack', level: 8, mana: 6, premium: false, vocations: ['sorcerer'], needsTarget: true },
  };
  assert.equal(spellsFor({ ...def, vocation: 'sorcerer' }, 8, spells).heal?.words, 'exura');
  assert.equal(spellsFor({ ...def, vocation: 'sorcerer' }, 35, spells).heal?.words, 'exura gran');
  assert.equal(spellsFor({ ...def, vocation: 'knight' }, 8, spells).attack, undefined);
  const wide = { ...spells, Sweep: { words: 'exori', group: 'attack', level: 8, mana: 20, premium: false, vocations: ['knight'], needsTarget: false } };
  assert.equal(spellsFor({ ...def, vocation: 'knight' }, 8, wide).attack, undefined, 'an area spell would hit friends');
  const runes = {
    a: { id: 1, group: 'attack', level: 1, magicLevel: 0, needsTarget: true, vocations: ['sorcerer'] },
    b: { id: 2, group: 'attack', level: 45, magicLevel: 15, needsTarget: true, vocations: [] },
    c: { id: 3, group: 'attack', level: 1, magicLevel: 0, needsTarget: false, vocations: [] },
    d: { id: 4, group: 'attack', level: 1, magicLevel: 0, needsTarget: true, vocations: ['druid'] },
  };
  assert.deepEqual(runesFor({ ...def, vocation: 'sorcerer' }, 8, runes), [1]);
  const grounds = [{ name: 'blisko', town: 'Thais', tier: 0, monsters: ['Rat'], x: 150, y: 150, z: 7 }, { name: 'daleko', town: 'Thais', tier: 4, monsters: ['Hydra'], x: 180, y: 180, z: 12 }];
  assert.deepEqual(groundsFor(base, { ...world, grounds }, exp).map((g) => g.name), ['blisko'], 'no hydras at level 8');
  assert.equal(groundsFor({ ...base, level: 60, hpMax: 900 }, { ...world, grounds }, exp).length, 2);
});

test('knowledge names what this character can do and facts answer a named thing', () => {
  const spells = { 'Light Healing': { words: 'exura', group: 'healing', level: 8, mana: 20, premium: false, vocations: ['paladin'], needsTarget: false }, 'Great Heal': { words: 'exura gran', group: 'healing', level: 30, mana: 70, premium: false, vocations: ['paladin'], needsTarget: false } };
  const facts = { ...world, spells, vocationTips: { paladin: 'strzelasz z dystansu' } };
  const known = knowledgeFor({ ...def, vocation: 'paladin' }, base, facts);
  assert.match(known, /strzelasz z dystansu/);
  assert.match(known, /leczenie exura/);
  assert.match(known, /kolejny czar na poziomie 30: exura gran/);
  assert.deepEqual(lookupFacts('czy ktos wie jak leczy exura?', facts).length, 1);
  assert.deepEqual(lookupFacts('co slychac', facts), []);
});

test('advice reaches a mind only through words and becomes a real option', async () => {
  const ground = { name: 'na polnoc od Thais, na powierzchni', town: 'Thais', tier: 0, monsters: ['Wolf'], x: 150, y: 90, z: 7 };
  const options = optionsFor({ ...base, x: 150, y: 150 }, world, exp, [{ from: 'Sira', ground }]);
  assert.ok(options.some((o) => o.id === 'tip_1' && o.goal.type === 'route' && o.label.includes('Sira')), JSON.stringify(options.map((o) => o.id)));
  assert.ok(options.findIndex((o) => o.id === 'tip_1') < options.findIndex((o) => o.id === 'go_north'), 'a reason to go somewhere comes before wandering');
  world.grounds = [ground];
  try {
    const h = setup(JSON.stringify({ say: 'dzieki' }));
    h.body();
    h.mind.tick(new Set(['Kael', 'Sira']), () => false);
    await new Promise((r) => setTimeout(r, 10)); // the first decision finishes
    h.event({ kind: 'heard', from: 'Sira', text: 'polecam na polnoc od Thais, na powierzchni, sa tam Wolf', level: 8, private: true });
    h.mind.tick(new Set(['Kael', 'Sira']), () => true);
    await new Promise((r) => setTimeout(r, 30));
    assert.match(h.diary(), /Sira poleca: na polnoc od Thais/);
    h.event({ kind: 'heard', from: 'Ravn', text: 'uwazaj na polnoc od Thais, na powierzchni', level: 8 });
    h.mind.tick(new Set(['Kael', 'Sira']), () => false);
    assert.match(h.diary(), /Ravn ostrzega przed/);
    h.event({ kind: 'heard', from: 'Canary', text: 'na polnoc od Thais, na powierzchni', level: 0 });
    h.mind.tick(new Set(['Kael', 'Sira']), () => false);
    assert.doesNotMatch(h.diary(), /Canary/, 'an NPC is not a player giving advice');
  } finally {
    delete world.grounds;
  }
});

test('new places and towns draw a character out; loneliness brings friends to the top', () => {
  const grounds = [
    { name: 'a', town: 'Thais', tier: 0, monsters: ['Rat'], x: 120, y: 100, z: 7 },
    { name: 'b', town: 'Thais', tier: 0, monsters: ['Rat'], x: 130, y: 100, z: 7 },
    { name: 'c', town: 'Thais', tier: 0, monsters: ['Rat'], x: 140, y: 100, z: 7 },
  ];
  const been = { ...exp, chunks: { '3:3:7': 5 } }; // ground a
  assert.deepEqual(groundsFor(base, { ...world, grounds }, been).map((g) => g.name), ['b', 'c', 'a'], 'unseen first, known still possible');
  const facts = { ...world, towns: [...world.towns, { name: 'Nahag Village', temple: { x: 300, y: 300, z: 7 } }, { name: 'Thalom', temple: { x: 900, y: 900, z: 5 } }], npcs: [{ name: 'Mira', x: 105, y: 100, z: 7 }] };
  const options = optionsFor(base, facts, exp, [], ['Sira']);
  assert.ok(options.some((o) => o.id === 'travel_nahag' && o.goal.type === 'route'));
  assert.ok(options.some((o) => o.id === 'npc_mira' && o.goal.name === 'Mira'));
  assert.equal(optionsFor(base, facts, { ...exp, loneliness: 0.8 }, [], ['Sira'])[0].id, 'team_sira');
});

test('people can be fought, grudges show, and the shop and depot are real options', () => {
  const stranger = { name: 'Bob', kind: 'player' as const, hp: 100, x: 101, y: 100, z: 7 };
  const facts = { ...world, merchant: { name: 'Mira', x: 200, y: 200, z: 7 }, depots: [{ x: 110, y: 100, z: 7, locker: { x: 110, y: 99, z: 7 } }] };
  const state = { ...base, gold: 150, seen: [stranger] };
  const grudge = { ...exp, grudges: { Bob: 4 } };
  const options = optionsFor(state, facts, grudge);
  const attack = options.find((o) => o.id === 'attack_bob')!;
  assert.equal(attack.goal.type, 'pvp');
  assert.match(attack.label, /uraze: 4/);
  assert.equal(options.find((o) => o.id === 'supply')?.goal.errand, 'shop');
  assert.equal(options.find((o) => o.id === 'depot')?.goal.errand, 'depot');
  assert.ok(!optionsFor({ ...state, gold: 20 }, facts, exp).some((o) => o.id === 'depot'), 'nothing to store yet');
  const friend = { ...state, vips: [{ name: 'Bob', online: true }] };
  assert.ok(!optionsFor(friend, facts, exp).some((o) => o.id === 'attack_bob'), 'a friend needs a reason');
  assert.ok(optionsFor(friend, facts, grudge).some((o) => o.id === 'attack_bob'));
  assert.ok(optionsFor(state, facts, exp).some((o) => o.id === 'attack_bob'), 'a stranger is fair game');
  const empty = { ...base, potions: { health: 0, mana: 0 } };
  assert.equal(needsSupplies(empty), true);
  assert.equal(chooseByTemperament(def, exp, empty, optionsFor(empty, facts, exp), () => 0.45).id, 'supply', 'an empty bag decides by itself without a model');
  assert.equal(needsSupplies({ ...base, arrows: 12 }), true, 'an archer without arrows');
});

test('an attacker earns a grudge from the server line; a death leaves a lesson that shapes later choices', async () => {
  const seen: string[] = [];
  const h = setup(JSON.stringify({ lesson: 'nie wchodze tam bez mikstur', say: 'hej', choice: 'town', thought: 'x', plan: 'y' }), seen);
  const names = new Set(['Kael']);
  const settle = () => new Promise((r) => setTimeout(r, 40)); // under load 10 ms was sometimes too short
  h.body();
  h.mind.tick(names, () => false);
  await settle();
  h.event({ kind: 'message', text: 'You lose 12 hitpoints due to an attack by Bob.' });
  h.event({ kind: 'message', text: 'You lose 3 hitpoints due to an attack by a wolf.' });
  h.event({ kind: 'message', text: 'A wolf loses 21 hitpoints due to an attack by Sira.' });
  h.mind.tick(names, () => false);
  assert.match(h.diary(), /Bob mnie atakuje/);
  assert.doesNotMatch(h.diary(), /wolf mnie atakuje/, 'a monster is not a person');
  assert.doesNotMatch(h.diary(), /Sira mnie atakuje/, 'someone else fighting a wolf is not an attack on me');
  h.advance(2000);
  h.event({ kind: 'death' });
  h.body({ seen: [rat] });
  h.mind.tick(names, () => true);
  await settle();
  h.mind.tick(names, () => true);
  await settle();
  assert.match(h.diary(), /ZGINALEM: Bob/);
  assert.match(h.diary(), /lekcja: nie wchodze tam bez mikstur/);
  h.advance(200_000);
  h.body();
  h.mind.tick(names, () => true);
  await settle();
  assert.ok(seen.some((body) => body.includes('nie wchodze tam bez mikstur') && body.includes('LEKCJE')), 'the next decision reads it');
});

test('the character stays a player among players unless told otherwise', async () => {
  const seen: string[] = [];
  const h = setup(JSON.stringify({ say: 'co ty gadasz' }), seen, 'in_character');
  const names = new Set(['Kael']);
  h.body();
  h.mind.tick(names, () => false);
  await new Promise((r) => setTimeout(r, 10));
  h.event({ kind: 'heard', from: 'Sira', text: 'Kael jestes botem?', level: 8, private: true });
  h.mind.tick(names, () => true);
  await new Promise((r) => setTimeout(r, 10));
  assert.ok(seen.at(-1)!.includes('Jestes czlowiekiem'));
  assert.ok(!seen.at(-1)!.includes('nie klam'));
});

test('hunger beats plans: an archer with no arrows goes for her savings, then the shop', async () => {
  const facts = { ...world, merchant: { name: 'Mira', x: 200, y: 200, z: 7 }, depots: [{ x: 110, y: 100, z: 7, locker: { x: 110, y: 99, z: 7 } }] };
  const broke = { ...base, vocation: 'paladin', arrows: 0, gold: 0 };
  assert.equal(needsSupplies(broke), true, 'no arrows at all counts');
  assert.equal(outOfSupplies(broke), true);
  const saved = { ...exp, stored: 300 };
  assert.ok(optionsFor(broke, facts, saved).some((o) => o.id === 'withdraw' && o.goal.errand === 'withdraw'));
  assert.ok(!optionsFor(broke, facts, exp).some((o) => o.id === 'withdraw'), 'nothing to take out');
  assert.ok(!optionsFor({ ...broke, gold: 200 }, facts, saved).some((o) => o.id === 'withdraw'), 'has money on her');
  const h = setup(JSON.stringify({ choice: 'go_north', thought: 'ide', plan: 'p', say: '' }));
  h.body({ vocation: 'paladin', arrows: 0, gold: 50 });
  assert.equal(outOfSupplies({ ...base, potions: { health: 0, mana: 1 } }), true);
});

test('a character checks its own gear, buys what is gone and asks for help only when broke', async () => {
  const settle = () => new Promise((r) => setTimeout(r, 40)); // under load 10 ms was sometimes too short
  const names = new Set(['Kael']);
  const gear = { knight: [{ id: 3355, slot: 1 }, { id: 3264, slot: 6 }] };
  const dressed = { worn: { 1: 3355, 6: 3264 }, have: { 3355: 1, 3264: 1 }, gold: 500 };
  const map = new NavGrid();
  map.addChunk(96, 96, 7, Array(16).fill('ffff'));
  const h = setup(JSON.stringify({ choice: 'go_north', thought: 'x', plan: 'y', say: '' }), [], undefined, { gear, merchant: { name: 'Mira', x: 105, y: 100, z: 7 }, supplies: { knight: [{ id: 266, count: 5 }] } }, map);
  h.body(dressed);
  h.mind.tick(names, () => false);
  await settle();
  assert.deepEqual(h.orders().wear, gear.knight, 'the body learns what to wear');
  h.advance(200_000);
  h.body({ worn: { 1: 0, 6: 3264 }, have: { 3355: 0, 3264: 1 }, gold: 500 });
  h.mind.tick(names, () => false);
  await settle();
  assert.match(h.diary(), /supply: bez zapasow/, 'a missing helmet sends it shopping');
  h.advance(60_000);
  h.body({ x: 105, y: 100, worn: { 1: 0, 6: 3264 }, have: { 3355: 0, 3264: 1 }, gold: 500 });
  h.mind.tick(names, () => false);
  await settle();
  const trade = h.orders().goal;
  assert.equal(trade.type, 'trade');
  assert.deepEqual(trade.buy[0], { id: 3355, count: 1 }, 'the missing piece comes first');
  assert.equal(h.orders().needKit, undefined, 'with money it buys, it is not given');
  h.body({ worn: { 1: 0, 6: 0 }, have: { 3355: 0, 3264: 0 }, gold: 2 });
  h.mind.tick(names, () => false);
  await settle();
  assert.equal(h.orders().needKit, 1, 'broke and bare: the one remaining exception');
  const bowOff = { worn: { 1: 3355, 6: 0 }, have: { 3355: 1, 3264: 1 }, gold: 2 };
  h.advance(700_000);
  h.body(bowOff);
  h.mind.tick(names, () => false);
  assert.equal(h.orders().needKit, 1, 'a weapon in the bag is not lost');
});

test('old blocks are forgotten when they would leave no way at all', async () => {
  const map = new NavGrid();
  map.addChunk(96, 96, 7, Array(16).fill('f7ff'), [[100, 100]]);
  const h = setup(JSON.stringify({ choice: 'go_north', thought: 'x', plan: 'y', say: '' }), [], undefined, {}, map);
  const names = new Set(['Kael']);
  h.body({ x: 98, y: 100 });
  writeFileSync(join(h.dir, 'force.json'), JSON.stringify({ route: { x: 103, y: 100, z: 7 } }));
  h.mind.tick(names, () => false);
  assert.match(h.diary(), /trasa do 103,100,7/);
  h.advance(31_000);
  h.body({ x: 98, y: 100 });
  h.mind.tick(names, () => false);
  assert.match(h.diary(), /utknalem przy 100,100,7 \(door\)/);
  assert.equal((h.diary().match(/trasa do 103,100,7/g) ?? []).length, 2, 'the only door is tried again rather than giving up');
});

test('a captain who refuses ends the plan instead of holding the character on the pier', async () => {
  const map = new NavGrid();
  map.addChunk(96, 96, 6, Array(16).fill('ffff'));
  map.addChunk(20000, 96, 6, Array(16).fill('ffff'));
  map.addBoats([{ npc: 'Captain', x: 100, y: 100, z: 6, stops: [{ word: 'venore', price: 170, to: { x: 20004, y: 100, z: 6 } }] }]);
  const h = setup(JSON.stringify({ choice: 'go_north', thought: 'x', plan: 'y', say: '' }), [], undefined, {}, map);
  const names = new Set(['Kael']);
  const settle = () => new Promise((r) => setTimeout(r, 40)); // under load 10 ms was sometimes too short
  h.body({ x: 98, y: 100, z: 6, gold: 500 });
  h.mind.tick(names, () => false);
  await settle();
  writeFileSync(join(h.dir, 'force.json'), JSON.stringify({ route: { x: 20008, y: 100, z: 6 } }));
  h.mind.tick(names, () => false);
  assert.equal(h.orders().goal.type, 'sail');
  assert.equal(h.orders().goal.word, 'venore');
  h.advance(2000);
  h.event({ kind: 'heard', from: 'Captain Bluebear', level: 0, text: "I'm sorry but I don't sail there." });
  h.body({ x: 98, y: 100, z: 6, gold: 500 });
  h.mind.tick(names, () => false);
  await settle();
  assert.match(h.diary(), /kapitan nie zabral mnie do venore/, 'his word ends it at once');
  assert.notEqual(h.orders().goal.type, 'sail', 'the plan is over');
  writeFileSync(join(h.dir, 'force.json'), JSON.stringify({ route: { x: 20008, y: 100, z: 6 } }));
  h.advance(5000);
  h.body({ x: 98, y: 100, z: 6, gold: 500 });
  h.mind.tick(names, () => false);
  assert.match(h.diary(), /nie znam drogi do 20008,100,6/, 'the next plan does not count on him');
});

test('adventures become stories told aloud after shopping', async () => {
  const h = setup(JSON.stringify({ lesson: 'x', say: '', choice: 'town', thought: 'x', plan: 'y' }), []);
  const names = new Set(['Kael']);
  const settle = () => new Promise((r) => setTimeout(r, 40)); // under load 10 ms was sometimes too short
  h.body();
  h.mind.tick(names, () => false);
  await settle();
  h.body({ level: 9 });
  h.mind.tick(names, () => false);
  await settle();
  h.event({ kind: 'trade_done', money: 5 });
  h.mind.tick(names, () => false);
  await settle();
  assert.match(h.diary(), /opowiadam: wbilem wlasnie poziom 9/);
  const line = h.orders().say.at(-1);
  assert.equal(line.to, undefined, 'said aloud, not in private');
  assert.doesNotMatch(line.text, /Mira/, 'not addressed, so anyone near overhears it as a rumour');
});

test('a character remembers what paid: its best spot is offered, and a deadly one loses to a safe one', () => {
  const spot = (id: string, x: number, minutes: number, xp: number, deaths: number) => ({ id, name: id, why: 'hunt' as const, doing: 'poluje na wilki', x, y: 300, z: 7, monsters: ['Wolf'], visits: 2, minutes, exp: xp, gold: 0, kills: 9, deaths, lastAt: 1 });
  const known = { ...exp, places: { rich: spot('rich', 300, 10, 1000, 0), poor: spot('poor', 400, 10, 100, 0), deadly: spot('deadly', 500, 10, 1200, 3) } };
  const options = optionsFor({ ...base, x: 100, y: 100 }, world, known);
  assert.equal(options.find((o) => o.id === 'spot_1')?.goal.x, 300, 'the one that pays best after its deaths');
  assert.match(options.find((o) => o.id === 'spot_1')!.label, /6000 exp\/h/);
  assert.equal(expPerHour(known.places.rich), 6000);
  assert.ok(spotValue(known.places.deadly) < spotValue(known.places.rich));
  assert.ok(!optionsFor({ ...base, x: 300, y: 300 }, world, known).some((o) => o.goal.x === 300), 'not the place it stands in');
  assert.match(placeNotes(known, 2), /rich: poluje na wilki \(Wolf\), 6000 exp\/h/);
});

test('without a model a death at a ground lowers its weight, read from numbers and not from words', () => {
  const grounds = [{ name: 'a', town: 'T', tier: 0, monsters: ['Hydra'], x: 300, y: 100, z: 7 }, { name: 'b', town: 'T', tier: 0, monsters: ['Rat'], x: 310, y: 100, z: 7 }];
  const facts = { ...world, grounds };
  const after = { ...exp, deathsBy: { Hydra: 1 } };
  const strong = { ...base, hp: 1500, hpMax: 1500 };
  const options = optionsFor(strong, facts, after);
  assert.equal(options.find((o) => o.goal.x === 300)?.risk, 0.8);
  let deadly = 0;
  for (let i = 0; i < 400; i++) if (chooseByTemperament(def, after, strong, options.filter((o) => o.id.startsWith('hunt_')), Math.random).goal.x === 300) deadly++;
  assert.ok(deadly < 140, `chosen ${deadly}/400`);
});

test('runes and potions follow level and magic level, supplies with them', () => {
  const runes = { a: { id: 17512, group: 'attack', level: 1, magicLevel: 0, needsTarget: true, vocations: [] }, b: { id: 3198, group: 'attack', level: 25, magicLevel: 3, needsTarget: true, vocations: [] } };
  const mage = { ...def, vocation: 'sorcerer' };
  assert.deepEqual(runesFor(mage, 30, runes, 1), [17512], 'magic level counts, not a constant');
  assert.deepEqual(runesFor(mage, 30, runes, 5), [3198, 17512]);
  const potions = [{ id: 268, kind: 'mana' as const, level: 0, vocations: [] }, { id: 237, kind: 'mana' as const, level: 50, vocations: [] }, { id: 238, kind: 'mana' as const, level: 80, vocations: ['sorcerer'] }];
  assert.deepEqual(potionsFor(mage, 10, potions).mana, [268]);
  assert.deepEqual(potionsFor(mage, 90, potions).mana, [238, 237, 268]);
  assert.deepEqual(potionsFor(def, 90, potions).mana, [237, 268], 'a knight never gets great mana');
  const facts = { ...world, runes, potions, sold: [17512, 3198, 268, 237], supplies: { sorcerer: [{ id: 268, count: 10 }, { id: 17512, count: 20 }] } };
  assert.deepEqual(suppliesFor(mage, 60, 5, facts), [{ id: 237, count: 24 }, { id: 3198, count: 20 }]);
  assert.equal(needsSupplies({ ...base, vocation: 'sorcerer', potions: { health: 5, mana: 0 } }), true, 'a mage without mana goes shopping');
  assert.equal(needsSupplies({ ...base, vocation: 'knight', potions: { health: 5, mana: 0 } }), false);
});

test('friends online can be asked along; agents talk out loud and a chat ends', async () => {
  const friendly = { vips: [{ name: 'Sira', online: true }, { name: 'Ravn', online: false }] };
  const options = optionsFor({ ...base, ...friendly }, world, exp, [], ['Sira']);
  assert.ok(options.some((o) => o.id === 'team_sira' && o.goal.type === 'team'));
  const h = setup(JSON.stringify({ say: 'spoko' }));
  const names = new Set(['Kael', 'Sira', 'Ravn']);
  const settle = () => new Promise((r) => setTimeout(r, 40)); // under load 10 ms was sometimes too short
  h.body(friendly);
  h.mind.tick(names, () => false);
  await settle();
  h.event({ kind: 'heard', from: 'Sira', text: 'idziemy razem? gdzie jestes?', level: 8, private: true });
  h.mind.tick(names, () => true);
  await settle();
  assert.match(h.orders().say.at(-1).text, /jestem na polnoc od Thais, na powierzchni, czekam/, 'the place travels in words');
  assert.doesNotMatch(h.orders().say.at(-1).text, /\d/, 'nobody writes coordinates on a chat');
  assert.equal(h.orders().say.at(-1).to, 'Sira');
  for (let i = 0; i < 7; i++) {
    h.advance(5000);
    h.body(friendly);
    h.event({ kind: 'heard', from: 'Ravn', text: `Kael co tam ${i}`, level: 8 });
    h.mind.tick(names, () => true);
    await settle();
  }
  const answers = (h.diary().match(/Ravn: Kael co tam \d -> spoko/g) ?? []).length;
  assert.ok(answers >= 1, 'a line aloud gets an answer');
  assert.ok(answers <= 2, `a chat ends: ${answers}`);
  assert.ok(h.orders().say.filter((l: { to?: string }) => l.to === 'Ravn').length === 0, 'and it stays out loud');
  assert.match(h.diary(), /-> \(bez odpowiedzi\)/, 'the same line twice is left unsaid');
});

test('two friends asking at once do not end up following each other in circles', async () => {
  const settle = () => new Promise((r) => setTimeout(r, 40)); // under load 10 ms was sometimes too short
  const names = new Set(['Kael', 'Sira']);
  const friendly = { vips: [{ name: 'Sira', online: true }], };
  const h = setup(JSON.stringify({ say: '' }));
  h.body(friendly);
  h.mind.tick(names, () => false);
  await settle();
  writeFileSync(join(h.dir, 'force.json'), JSON.stringify({ option: 'team_sira' }));
  h.mind.tick(names, () => false);
  await settle();
  h.event({ kind: 'heard', from: 'Sira', text: 'Kael idziemy razem? gdzie jestes?', level: 8, private: true });
  h.mind.tick(names, () => false);
  await settle();
  assert.match(h.orders().say.at(-1).text, /jestem na polnoc od Thais/, 'Kael sorts before Sira, so Kael leads');
});

test('hurt with a monster at hand, a character calls an online friend with its place', async () => {
  const h = setup(JSON.stringify({ choice: 'go_north', thought: 'x', plan: 'y', say: '' }));
  const names = new Set(['Kael', 'Sira']);
  h.body({ hp: 30, vips: [{ name: 'Sira', online: true }], seen: [rat] });
  h.mind.tick(names, () => false);
  await new Promise((r) => setTimeout(r, 10));
  const call = h.orders().say.find((l: { text: string }) => l.text.startsWith('pomocy'));
  assert.equal(call.to, 'Sira');
  assert.match(call.text, /Rat mnie bije, jestem na polnoc od Thais/);
});

test('temperament shapes choices: the brave fight, the frightened go home', () => {
  const options = optionsFor({ ...base, seen: [rat] }, world, exp);
  const count = (d: PlayerDef, e: typeof exp, s: BodyState, id: string) => {
    let n = 0;
    for (let i = 0; i < 2000; i++) if (chooseByTemperament(d, e, s, optionsFor(s, world, e)).id === id) n++;
    return n;
  };
  assert.ok(options.length > 0);
  assert.ok(count({ ...def, bravery: 1 }, exp, { ...base, seen: [rat] }, 'fight') > count({ ...def, bravery: 0 }, exp, { ...base, seen: [rat] }, 'fight'));
  assert.ok(count(def, { ...exp, fear: 1 }, { ...base, hp: 40 }, 'town') > count(def, exp, base, 'town'));
});

test('a monster far above this character means running; a rat does not', () => {
  assert.equal(tooDangerous({ ...base, seen: [rat] }, world, 0.5, 0.35), null);
  assert.equal(tooDangerous({ ...base, seen: [hydra] }, world, 0.5, 0.35), 'Hydra');
  assert.equal(tooDangerous({ ...base, hpMax: 2000, seen: [hydra] }, world, 0.5, 0.35), null, 'a stronger character may stay');
});

test('the model chooses among real options, and its thought goes to the diary', async () => {
  const seen: string[] = [];
  const m = setup(JSON.stringify({ choice: 'floor_down', thought: 'ciekawe, co jest nizej', say: '' }), seen);
  m.body();
  m.mind.tick(names, () => true);
  await flush();
  assert.equal(m.orders().goal.type, 'floor');
  assert.equal(m.orders().goal.kind, 'hole');
  assert.match(m.diary(), /floor_down: ciekawe, co jest nizej/);
  assert.ok(seen[0].includes('MOZLIWOSCI'));
});

test('a choice outside the options is ignored; a dead model leaves the character playing', async () => {
  const bad = setup(JSON.stringify({ choice: 'teleport_to_treasure', thought: 'x', say: '' }));
  bad.body();
  bad.mind.tick(names, () => true);
  await flush();
  assert.notEqual(bad.orders().goal.type, 'teleport_to_treasure');
  assert.ok(['explore', 'floor', 'goto', 'hunt'].includes(bad.orders().goal.type));
  const dead = setup(new Error('fetch failed'));
  dead.body();
  dead.mind.tick(names, () => true);
  await flush();
  assert.ok(['explore', 'floor', 'goto', 'hunt'].includes(dead.orders().goal.type));
  assert.match(dead.diary(), /model milczy/);
});

test('no budget for the model: temperament decides, without a call', async () => {
  const seen: string[] = [];
  const m = setup(JSON.stringify({ choice: 'go_north', thought: 'x', say: '' }), seen);
  m.body();
  m.mind.tick(names, () => false);
  await flush();
  assert.equal(seen.length, 0);
  assert.ok(m.orders().goal.type);
});

test('death leaves a mark: more fear, less confidence, a memory with the place and the killer', async () => {
  const m = setup(JSON.stringify({ choice: 'go_north', thought: 'x', say: '' }));
  m.body({ seen: [hydra] });
  m.mind.tick(names, () => true);
  await flush();
  m.advance(1000);
  m.event({ kind: 'death' });
  m.body({ seen: [hydra] });
  m.mind.tick(names, () => false);
  await flush();
  assert.match(m.diary(), /ZGINALEM: Hydra/);
  assert.ok(m.store.visibleEvents('kael', 0, 10).some((e) => e.text.includes('Zginalem przez: Hydra') && e.importance === 9));
  const mind = JSON.parse(m.store.prefs('kael', 0).mind);
  assert.equal(mind.deaths, 1);
  assert.ok(mind.fear > 0.5);
  assert.equal(mind.deathsBy.Hydra, 1);
});

test('feelings and experience survive a restart of the mind', async () => {
  const m = setup(JSON.stringify({ choice: 'go_north', thought: 'x', say: '' }));
  m.body();
  m.mind.tick(names, () => true);
  await flush();
  m.event({ kind: 'death' });
  m.advance(1000);
  m.body();
  m.mind.tick(names, () => false);
  await flush();
  const again = new PlayerMind('kael', def, m.dir, world, m.store, null, 0.35, () => 2_000_000);
  writeFileSync(join(m.dir, 'state.json'), JSON.stringify({ ...base, atMs: 2_000_000 }));
  again.tick(names, () => false);
  await flush();
  assert.equal(JSON.parse(m.store.prefs('kael', 0).mind).deaths, 1);
});

test('a dangerous sight makes the body flee at once, without the model', async () => {
  const seen: string[] = [];
  const m = setup(JSON.stringify({ choice: 'go_north', thought: 'x', say: '' }), seen);
  m.body();
  m.mind.tick(names, () => true);
  await flush();
  const calls = seen.length;
  m.advance(1000);
  m.body({ seen: [hydra] });
  m.mind.tick(names, () => false);
  await flush();
  assert.equal(m.orders().goal.flee, true);
  assert.equal(seen.length, calls);
  assert.match(m.diary(), /uciekam przed: Hydra/);
});

test('chat: named replies come with a typing delay; NPC lines are ignored; what is heard is a rumor', async () => {
  const m = setup(JSON.stringify({ say: 'hej, tez tu expie' }));
  m.body();
  m.mind.tick(names, () => false);
  await flush();
  m.advance(10_000);
  m.event({ kind: 'heard', from: 'Sira', text: 'Kael, widziales hydre na dole?' });
  m.event({ kind: 'heard', from: 'Mira [AI]', text: 'Witaj, kochanienki' });
  m.body();
  m.mind.tick(names, () => true);
  await flush();
  const line = m.orders().say.at(-1);
  assert.equal(line.text, 'hej, tez tu expie');
  assert.ok(line.atMs > 1_010_000 + 1000, 'not instant');
  const heard = m.store.visibleEvents('kael', 0, 10).filter((e) => e.kind === 'heard');
  assert.equal(heard.length, 1);
  assert.equal(heard[0].certainty, 'rumor');
});

test('knowledge moves by speech only: one mind never reads another', () => {
  const store = new NpcMemoryStore(new Memory(':memory:'));
  store.addEvent({ eventKey: 'a', npcKey: 'kael', kind: 'witnessed', subjectGuid: null, actorName: 'ty', text: 'Zginalem przez: Hydra', source: 'witnessed', certainty: 'confirmed', visibility: 'public', importance: 9, worldSessionId: 'p', realAtMs: 1 });
  assert.equal(store.visibleEvents('sira', 0, 10).length, 0);
});

const SPELLS = {
  'Wound Cleansing': { words: 'exura ico', group: 'healing', level: 8, mana: 40, premium: false, vocations: ['knight'], needsTarget: false },
  'Bruise Bane': { words: 'exura infir ico', group: 'healing', level: 1, mana: 10, premium: false, vocations: ['knight'], needsTarget: false },
  'Find Person': { words: 'exiva', group: 'support', level: 8, mana: 20, premium: false, vocations: ['knight'], needsTarget: false },
};
const lessonOf = (spell: string, price: number, level = 1) => ({ spell, word: spell, price, level, vocations: ['knight'], premium: false });
const TEACHERS = [{ npc: 'Gregor', x: 104, y: 100, z: 7, spells: [lessonOf('wound cleansing', 0, 8), lessonOf('find person', 80, 8), lessonOf('bruise bane', 0)] }];
const school = { spells: SPELLS, teachers: TEACHERS };

test('a character casts only what it knows', () => {
  assert.equal(spellsFor(def, 8, SPELLS, new Set()).heal, undefined);
  assert.equal(spellsFor(def, 8, SPELLS, new Set(['bruise bane'])).heal?.words, 'exura infir ico');
  assert.equal(spellsFor(def, 8, SPELLS).heal?.words, 'exura ico', 'no list: the old answer for callers without state');
  assert.match(knowledgeFor(def, { ...base, known: [] }, { ...world, ...school }), /leczenie brak/);
});

test('a lesson is offered only when it can really happen', () => {
  const s = { ...base, vocation: 'knight', gold: 0, known: [] };
  assert.equal(nextLesson(s, { ...world, ...school })?.lesson.spell, 'wound cleansing');
  assert.equal(nextLesson({ ...s, known: ['wound cleansing', 'bruise bane'] }, { ...world, ...school }), null, 'nothing useful left');
  assert.equal(nextLesson({ ...s, level: 7, known: ['bruise bane'] }, { ...world, ...school }), null, 'too low a level');
  assert.equal(nextLesson({ ...s, vocation: 'paladin' }, { ...world, ...school }), null, 'not for this vocation');
  const paid = [{ ...TEACHERS[0], spells: [lessonOf('wound cleansing', 300)] }];
  assert.equal(nextLesson(s, { ...world, spells: SPELLS, teachers: paid }), null, 'too expensive');
  assert.ok(optionsFor(s, { ...world, ...school }, exp).some((o) => o.id === 'learn_woundcleansing'));
});

function lessonWorld() {
  const grid = new NavGrid();
  grid.addChunk(96, 96, 7, Array(16).fill('ffff'));
  const answer = JSON.stringify({ choice: 'learn_woundcleansing', thought: 'musze sie leczyc', plan: 'nauka', say: '' });
  const w = setup(answer, [], undefined, school, grid);
  const state = { vocation: 'knight', gold: 50 };
  w.body(state);
  w.mind.tick(names, () => true);
  return { ...w, state };
}

const atTeacher = async (w: ReturnType<typeof lessonWorld>) => {
  await flush();
  w.body({ ...w.state, x: 104, y: 100 });
  w.mind.tick(names, () => true);
  assert.deepEqual(w.orders().goal.words, ['hi', 'wound cleansing', 'yes']);
  assert.equal(w.orders().goal.type, 'talk');
};

test('a spell is known only after the server said so', async () => {
  const w = lessonWorld();
  await atTeacher(w);
  assert.equal(w.orders().healSpell, undefined, 'walking to a teacher teaches nothing');
  w.event({ kind: 'heard', from: 'Gregor', level: 0, text: 'Would you like to learn wound cleansing magic spell for free?' });
  w.body({ ...w.state, x: 104, y: 100 });
  w.mind.tick(names, () => true);
  assert.equal(w.orders().goal.type, 'talk', 'a question is not a lesson');
  w.event({ kind: 'heard', from: 'Gregor', level: 0, text: "You have learned 'wound cleansing'." });
  w.body({ ...w.state, x: 104, y: 100 });
  w.mind.tick(names, () => true);
  assert.equal(w.orders().healSpell, 'exura ico');
  assert.equal(w.orders().goal.type, 'hunt');
  assert.match(w.diary(), /umiem juz: wound cleansing/);
});

test('a teacher who refuses sends the character back to planning, without the lesson', async () => {
  const w = lessonWorld();
  await atTeacher(w);
  w.event({ kind: 'heard', from: 'Gregor', level: 0, text: 'You do not have enough money, this spell costs 300 gold.' });
  w.body({ ...w.state, x: 104, y: 100 });
  w.mind.tick(names, () => true);
  assert.equal(w.orders().goal.type, 'hunt');
  assert.equal(w.orders().healSpell, undefined);
  assert.match(w.diary(), /nauczyciel odmowil/);
  await flush();
  w.advance(150_000);
  w.body({ ...w.state, x: 104, y: 100 });
  w.mind.tick(names, () => true);
  await flush();
  assert.equal((w.diary().match(/u nauczyciela/g) ?? []).length, 1, 'no second walk right after a refusal');
});

test('a refused cast takes the spell off the list', async () => {
  const w = lessonWorld();
  await atTeacher(w);
  w.event({ kind: 'heard', from: 'Gregor', level: 0, text: "You have learned 'wound cleansing'." });
  w.body({ ...w.state, x: 104, y: 100 });
  w.mind.tick(names, () => true);
  w.event({ kind: 'message', text: 'You need to learn this spell first.' });
  w.body({ ...w.state, x: 104, y: 100 });
  w.mind.tick(names, () => true);
  assert.equal(w.orders().healSpell, undefined);
  assert.match(w.diary(), /nie znam tego czaru/);
});

test('a kit that taught spells counts as knowing them', async () => {
  const w = setup('{}', [], undefined, { ...school, kitSpells: { knight: ['Wound Cleansing'] } });
  w.body({ vocation: 'knight' });
  w.mind.tick(names, () => false);
  await flush();
  assert.equal(w.orders().healSpell, 'exura ico');
});

function brokeWorld(selfReliant: boolean) {
  const dir = join(tempDir(), 'luna');
  mkdirSync(dir, { recursive: true });
  const store = new NpcMemoryStore(new Memory(':memory:'));
  const gear = { knight: [{ id: 3264, slot: 6 }] };
  const merchant = { name: 'Mira', x: 104, y: 100, z: 7 };
  const mind = new PlayerMind('luna', { ...def, selfReliant }, dir, { ...world, gear, merchant }, store, null, 0.35, () => 1_000_000);
  writeFileSync(join(dir, 'state.json'), JSON.stringify({ ...base, atMs: 1_000_000, gold: 0, worn: {}, have: {}, seen: [rat] }));
  mind.tick(names, () => false);
  return { orders: () => JSON.parse(readFileSync(join(dir, 'orders.json'), 'utf8')), diary: () => readFileSync(join(dir, 'diary.log'), 'utf8') };
}

test('a character without money earns it: no refill from the developer and no walk to the shop', async () => {
  const w = brokeWorld(true);
  await flush();
  assert.equal(w.orders().needKit, undefined);
  assert.match(w.diary(), /fight: nie mam za co kupic/);
});

test('the developer exception stays for characters that have it', async () => {
  const w = brokeWorld(false);
  await flush();
  assert.equal(w.orders().needKit, 1);
});

test('a person is remembered after a restart, and a stranger gets no invented past', async () => {
  const dir = join(tempDir(), 'kael');
  mkdirSync(dir, { recursive: true });
  const store = new NpcMemoryStore(new Memory(':memory:'));
  const prompts: string[] = [];
  const fetcher = (async (_url: string, init: RequestInit) => {
    prompts.push(String(init.body));
    return new Response(JSON.stringify({ message: { content: '{"say":"pewnie","opinion":1}' }, eval_count: 5, prompt_eval_count: 50 }));
  }) as unknown as typeof fetch;
  const client = new LocalModelClient(loadLocalAiConfig(), fetcher);
  let clock = 2_000_000;
  const start = () => new PlayerMind('kael', { ...def, sociability: 0 }, dir, world, store, client, 0.35, () => clock);
  const talk = async (mind: PlayerMind, from: string, text: string) => {
    appendFileSync(join(dir, 'events.jsonl'), `${JSON.stringify({ kind: 'heard', from, text, level: 20, private: true, atMs: clock })}\n`);
    writeFileSync(join(dir, 'state.json'), JSON.stringify({ ...base, atMs: clock }));
    mind.tick(names, () => true);
    await flush();
    clock += 20_000;
  };
  writeFileSync(join(dir, 'events.jsonl'), '');
  const first = start();
  first.tick(names, () => false);
  store.addEvent({ eventKey: 'trip', npcKey: 'kael', kind: 'witnessed', subjectGuid: null, actorName: 'ty', text: 'Bylismy razem na wyprawie z Marek, na trolle.', source: 'witnessed', certainty: 'confirmed', visibility: 'public', importance: 8, worldSessionId: 'players', realAtMs: clock });
  await talk(first, 'Marek', 'idziemy jutro na trolle?');
  const restarted = start();
  await talk(restarted, 'Marek', 'pamietasz mnie?');
  const toMarek = prompts.filter((p) => p.includes('CO PAMIETASZ O Marek')).at(-1)!;
  assert.match(toMarek, /wyprawie z Marek/, 'the shared trip');
  assert.match(toMarek, /idziemy jutro na trolle/, 'what was said before the restart');
  await talk(restarted, 'Obcy', 'czesc');
  const toStranger = prompts.filter((p) => p.includes('CO PAMIETASZ O Obcy')).at(-1)!;
  assert.match(toStranger, /nic, nie znasz tej osoby/);
  assert.doesNotMatch(toStranger, /idziemy jutro na trolle/, 'one person does not hear what another said');
});

test('a character that knows only its home finds the rest by going there', () => {
  const near = { name: 'blisko', x: 150, y: 150, z: 7, tier: 0, monsters: ['Rat'], town: 'Thais' };
  const far = { name: 'daleko', x: 900, y: 900, z: 7, tier: 0, monsters: ['Rat'], town: 'Thais' };
  const facts = { ...world, grounds: [near, far] };
  const home = { x: 200, y: 200, z: 7 };
  assert.deepEqual(groundsFor(base, facts, exp).map((g) => g.name), ['blisko', 'daleko'], 'the old way: everything');
  assert.deepEqual(groundsFor({ ...base, knownNear: home }, facts, exp).map((g) => g.name), ['blisko']);
  const been = { ...exp, chunks: { [`${Math.floor(900 / 32)}:${Math.floor(900 / 32)}:7`]: 1 } };
  assert.deepEqual(groundsFor({ ...base, knownNear: home }, facts, been).map((g) => g.name), ['blisko', 'daleko'], 'seen with its own eyes');
});

const stranger = { name: 'Marek', kind: 'player' as const, hp: 100, x: 101, y: 100, z: 7 };

test('a fight has a reason the character can see', () => {
  const healthy = optionsFor({ ...base, seen: [stranger] }, world, exp).find((o) => o.id === 'attack_marek')!;
  assert.match(healthy.label, /dla zabawy/);
  const weak = optionsFor({ ...base, seen: [{ ...stranger, hp: 20 }] }, world, exp).find((o) => o.id === 'attack_marek')!;
  assert.match(weak.label, /latwy lup/);
  const grudge = optionsFor({ ...base, seen: [stranger] }, world, { ...exp, grudges: { Marek: 2 } }).find((o) => o.id === 'attack_marek')!;
  assert.match(grudge.label, /uraze/);
  assert.ok(!optionsFor({ ...base, seen: [stranger], sparing: ['Marek'] }, world, exp).some((o) => o.id === 'attack_marek'), 'a person just fought is left alone');
  assert.ok(!optionsFor({ ...base, seen: [stranger], vips: [{ name: 'Marek', online: true }] }, world, exp).some((o) => o.id === 'attack_marek'), 'a friend needs a reason');
});

test('mischief decides how often a fight starts without a grudge', () => {
  const s = { ...base, seen: [stranger] };
  const options = optionsFor(s, world, exp);
  const fights = (mischief: number) => {
    let n = 0;
    for (let i = 0; i < 400; i++) if (chooseByTemperament({ ...def, mischief }, exp, s, options).id === 'attack_marek') n++;
    return n;
  };
  const calm = fights(0);
  const wild = fights(1);
  assert.ok(calm < 12, `calm ${calm}`);
  assert.ok(wild > calm * 2, `wild ${wild} calm ${calm}`);
});

test('after compression a person is still there, as a memory of older days', () => {
  const store = new NpcMemoryStore(new Memory(':memory:'));
  store.db.prepare(`INSERT INTO npc_memories (npc_key, subject_guid, kind, summary, participants_json, sources_json, certainty, visibility, importance, from_ms, to_ms, process_version, created_at_ms)
    VALUES ('luna', NULL, 'episode', 'Luna i Marek zabili razem trolla.', '["Marek"]', '["witnessed"]', 'confirmed', 'public', 8, 1, 2, 1, 1)`).run();
  assert.equal(store.memoriesAbout('luna', 'marek', 2)[0].summary, 'Luna i Marek zabili razem trolla.');
  assert.deepEqual(store.memoriesAbout('luna', 'Obcy', 2), []);
  assert.deepEqual(store.memoriesAbout('haiku', 'Marek', 2), [], 'each character has its own memories');
});

test('a hunting ground shows what it pays and one that pays nothing is not offered', () => {
  const place = (name: string, monsters: string[]) => ({ name, x: 150, y: 150, z: 7, tier: 0, monsters, town: 'Thais' });
  const facts = { ...world, monsters: { ...world.monsters, Chicken: { ...world.monsters.Rat, experience: 0 } }, grounds: [place('kury', ['Chicken']), place('szczury', ['Rat', 'Chicken'])] };
  assert.deepEqual(groundsFor(base, facts, exp).map((g) => g.name), ['szczury']);
  assert.match(optionsFor(base, facts, exp).find((o) => o.id === 'hunt_1')!.label, /Rat 5 exp, Chicken 0 exp/);
});

test('a place that gave no experience is not worth going back to', () => {
  const place = { id: 'h:a', monsters: ['Dog'], why: 'hunt' as const, name: 'psy', doing: 'poluje na Dog', x: 500, y: 500, z: 7, visits: 1, minutes: 5, exp: 0, gold: 0, kills: 10, deaths: 0, lastAt: 1 };
  assert.ok(!optionsFor(base, world, { ...exp, places: { a: place } }).some((o) => o.id.startsWith('spot_')));
  assert.ok(optionsFor(base, world, { ...exp, places: { a: { ...place, exp: 100 } } }).some((o) => o.id === 'spot_1'));
});

test('a friend who said no is not asked again right away', async () => {
  const w = setup(JSON.stringify({ choice: 'team_sira', thought: 'razem raznej', plan: 'razem', say: '' }));
  w.body({ vips: [{ name: 'Sira', online: true }] });
  w.mind.tick(names, () => true);
  await flush();
  w.advance(5000);
  w.event({ kind: 'heard', from: 'Sira', level: 20, private: true, text: 'teraz sam, moze pozniej' });
  w.body({ vips: [{ name: 'Sira', online: true }] });
  w.mind.tick(names, () => true);
  await flush();
  assert.equal((w.diary().match(/pytam Sira/g) ?? []).length, 1);
});

test('a character without healing goes to learn it, whatever the model felt like', async () => {
  const grid = new NavGrid();
  grid.addChunk(96, 96, 7, Array(16).fill('ffff'));
  const w = setup(JSON.stringify({ choice: 'fight', thought: 'bije dalej', plan: 'exp', say: '' }), [], undefined, school, grid);
  w.body({ vocation: 'knight', gold: 50, seen: [rat] });
  w.mind.tick(names, () => true);
  await flush();
  assert.match(w.diary(), /learn_woundcleansing: najpierw nauka leczenia/);
});

test('a full bag sends a character to the shop', async () => {
  const grid = new NavGrid();
  grid.addChunk(96, 96, 7, Array(16).fill('ffff'));
  const w = setup(JSON.stringify({ choice: 'fight', thought: 'bije dalej', plan: 'exp', say: '' }), [], undefined, { merchant: { name: 'Mira', x: 104, y: 100, z: 7 } }, grid);
  w.event({ kind: 'loot_stuck' });
  w.body({ vocation: 'knight', gold: 50, seen: [rat] });
  w.mind.tick(names, () => true);
  await flush();
  assert.match(w.diary(), /supply: plecak pelny/);
});

test('a fight shows what it pays', () => {
  assert.match(optionsFor({ ...base, seen: [rat] }, world, exp).find((o) => o.id === 'fight')!.label, /Rat 5 exp/);
});

test('a friend is found through the mark on the map, a place in words is enough to talk about', async () => {
  const grid = new NavGrid();
  grid.addChunk(96, 96, 7, Array(16).fill('ffff'));
  const w = setup(JSON.stringify({ choice: 'team_sira', thought: 'razem', plan: 'razem', say: '' }), [], undefined, {}, grid);
  w.mind.useMapMarks((name) => (name === 'Sira' ? { x: 106, y: 100, z: 7 } : null));
  w.body({ vips: [{ name: 'Sira', online: true }] });
  w.mind.tick(names, () => true);
  await flush();
  w.advance(5000);
  w.event({ kind: 'heard', from: 'Sira', level: 8, private: true, text: 'jasne, jestem na polnoc od Thais, na powierzchni, czekam' });
  w.body({ vips: [{ name: 'Sira', online: true }] });
  w.mind.tick(names, () => true);
  assert.match(w.diary(), /ide do Sira na 106,100,7/);
});

async function inviteWorld(answer: string) {
  const dir = join(tempDir(), 'luna');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'events.jsonl'), '');
  const store = new NpcMemoryStore(new Memory(':memory:'));
  const prompts: string[] = [];
  const client = {
    available: () => true,
    chat: async (messages: { content: string }[]) => {
      prompts.push(messages.map((m) => m.content).join('\n'));
      return { text: answer, totalMs: 1, evalCount: 1, promptCount: 1, evalMs: 1, loadMs: 0 };
    },
  };
  let clock = 3_000_000;
  const mind = new PlayerMind('luna', { ...def, character: 'Luna' }, dir, world, store, client, 0.35, () => clock);
  writeFileSync(join(dir, 'state.json'), JSON.stringify({ ...base, name: 'Luna', atMs: clock }));
  mind.tick(new Set(['Luna', 'Sira']), () => false);
  await flush();
  clock += 5000;
  appendFileSync(join(dir, 'events.jsonl'), `${JSON.stringify({ kind: 'heard', from: 'Sira', text: 'Luna idziemy razem? gdzie jestes?', level: 8, private: true, atMs: clock })}\n`);
  writeFileSync(join(dir, 'state.json'), JSON.stringify({ ...base, name: 'Luna', atMs: clock }));
  mind.tick(new Set(['Luna', 'Sira']), () => false);
  return { prompts, orders: () => JSON.parse(readFileSync(join(dir, 'orders.json'), 'utf8')) };
}

test('an invitation is the character\'s own decision', async () => {
  const yes = await inviteWorld('{"accept":"yes","say":"no dobra, chodz"}');
  await flush();
  assert.match(yes.prompts[0], /proponuje wspolne polowanie/);
  assert.match(yes.orders().say.at(-1).text, /no dobra, chodz, jestem .*czekam/);
  const no = await inviteWorld('{"accept":"no","say":"dzis wole sam"}');
  await flush();
  assert.match(no.orders().say.at(-1).text, /dzis wole sam, moze pozniej/, 'the other side must understand a refusal');
  assert.doesNotMatch(no.orders().say.at(-1).text, /czekam/);
});

test('one character forgives quickly, another carries a grudge', async () => {
  const grudgeAfter = async (forgives: number) => {
    const dir = join(tempDir(), 'kael');
    mkdirSync(dir, { recursive: true });
    const store = new NpcMemoryStore(new Memory(':memory:'));
    store.setPref('kael', 0, 'mind', JSON.stringify({ grudges: { Marek: 3 } }), 1);
    let clock = 4_000_000;
    const mind = new PlayerMind('kael', { ...def, forgives }, dir, world, store, null, 0.35, () => clock);
    for (let i = 0; i < 300; i++) {
      writeFileSync(join(dir, 'state.json'), JSON.stringify({ ...base, atMs: clock }));
      mind.tick(names, () => false);
      await new Promise((r) => setImmediate(r));
      clock += 1000;
    }
    return (JSON.parse(store.prefs('kael', 0).mind) as { grudges: Record<string, number> }).grudges.Marek ?? 0;
  };
  const stubborn = await grudgeAfter(0.05);
  const gentle = await grudgeAfter(0.9);
  assert.ok(stubborn > 2.8, `stubborn ${stubborn}`);
  assert.ok(gentle < 2, `gentle ${gentle}`);
});

test('an opinion of a person grows out of what happened', () => {
  const e = { ...exp, people: {} as Record<string, Person> };
  assert.equal(personNote(e, 'Marek'), '');
  const marek = personOf(e, 'Marek', 1);
  marek.met = 3;
  marek.together = 2;
  changeOpinion(marek, 2);
  assert.equal(personNote(e, 'Marek'), 'Marek: lubisz go (spotkan 3, wspolnych wypraw 2).');
  marek.fights = 1;
  changeOpinion(marek, -9);
  assert.match(personNote(e, 'Marek'), /nie znosisz go.*walk miedzy wami 1/);
  assert.equal(marek.opinion, -5, 'bounded');
  for (let i = 0; i < 60; i++) personOf(e, `Obcy${i}`, i);
  assert.ok(Object.keys(e.people).length <= 40, 'the list does not grow without end');
  assert.ok(e.people.Marek, 'a strong feeling outlives a passing stranger');
});

test('the model sees the long goal and what the character thinks of people', async () => {
  const seen: string[] = [];
  const w = setup(JSON.stringify({ choice: 'go_north', thought: 't', plan: 'p', say: '' }), seen, undefined, {});
  await flush();
  const dir = w.dir;
  const store = w.store;
  store.setPref('kael', 0, 'mind', JSON.stringify({ people: { Sira: { met: 4, together: 1, helped: 0, fights: 0, opinion: 2, lastAt: 1 } } }), 1);
  const prompts: string[] = [];
  const client = { chat: async (m: { content: string }[]) => { prompts.push(m.map((x) => x.content).join('\n')); return { text: JSON.stringify({ choice: 'go_north', thought: 't', plan: 'p', say: '' }), totalMs: 1, evalCount: 1, promptCount: 1, evalMs: 1, loadMs: 0 }; } };
  const mind = new PlayerMind('kael', { ...def, ambition: 'wbic poziom 20' }, dir, world, store, client, 0.35, () => 1_000_000);
  writeFileSync(join(dir, 'state.json'), JSON.stringify({ ...base, atMs: 1_000_000, vips: [{ name: 'Sira', online: true }] }));
  mind.tick(names, () => true);
  await flush();
  assert.match(prompts[0], /TWOJ DLUGI CEL: wbic poziom 20/);
  assert.match(prompts[0], /Sira: lubisz go \(spotkan 4, wspolnych wypraw 1\)/);
});

test('a character sums up what it lived through and acts on it after a restart', async () => {
  const dir = join(tempDir(), 'kael');
  mkdirSync(dir, { recursive: true });
  const store = new NpcMemoryStore(new Memory(':memory:'));
  const prompts: string[] = [];
  const chat = async (m: { content: string }[]) => {
    const text = m.map((x) => x.content).join('\n');
    prompts.push(text);
    const answer = text.includes('Podsumuj dla siebie') ? { beliefs: ['Kael jest niepewny', 'x'.repeat(300), 7, 'wilki sa bezpieczne'] } : { choice: 'go_north', thought: 't', plan: 'p', say: '' };
    return { text: JSON.stringify(answer), totalMs: 1, evalCount: 1, promptCount: 1, evalMs: 1, loadMs: 0 };
  };
  let clock = 6_000_000;
  const start = () => new PlayerMind('kael', def, dir, world, store, { chat }, 0.35, () => clock);
  const tick = async (m: PlayerMind) => {
    writeFileSync(join(dir, 'state.json'), JSON.stringify({ ...base, atMs: clock }));
    m.tick(names, () => true);
    await flush();
  };
  const first = start();
  await tick(first);
  assert.ok(!prompts.some((p) => p.includes('Podsumuj dla siebie')), 'not right after the start');
  clock += 1_810_000;
  await tick(first);
  assert.ok(prompts.some((p) => p.includes('Podsumuj dla siebie')));
  assert.match(readFileSync(join(dir, 'diary.log'), 'utf8'), /przemyslalem: Kael jest niepewny/);
  const saved = JSON.parse(store.prefs('kael', 0).mind) as { beliefs: string[] };
  assert.equal(saved.beliefs.length, 3, 'text only');
  assert.ok(saved.beliefs[1].length <= 120);
  clock += 200_000;
  prompts.length = 0;
  await tick(start());
  assert.match(prompts.find((p) => p.includes('MOZLIWOSCI'))!, /TWOJE PRZEKONANIA:\nKael jest niepewny/);
});

test('going together forms a party, the one who was asked leads', async () => {
  const w = setup(JSON.stringify({ choice: 'go_north', thought: 't', plan: 'p', say: '' }));
  const friend = { name: 'Sira', kind: 'player' as const, hp: 100, x: 101, y: 100, z: 7 };
  w.event({ kind: 'heard', from: 'Sira', text: 'Kael idziemy razem? gdzie jestes?', level: 8, private: true });
  const random = Math.random;
  Math.random = () => 0;
  w.body({ seen: [] });
  w.mind.tick(names, () => false);
  Math.random = random;
  await flush();
  assert.equal(w.orders().party, undefined, 'not before they meet');
  w.advance(5000);
  w.body({ seen: [friend] });
  w.mind.tick(names, () => false);
  assert.deepEqual(w.orders().party, { name: 'Sira', lead: true });
});

test('hearsay colours an opinion and stays marked as hearsay', async () => {
  const w = setup('{"say":""}');
  w.event({ kind: 'heard', from: 'Sira', text: 'uwazaj na Marek, napadl mnie na polnoc od Thais', level: 8, private: true });
  w.body();
  w.mind.tick(names, () => false);
  await flush();
  const mine = w.store.eventsAbout('kael', 'Marek', 5).map((e) => e.text).join(' ');
  assert.match(mine, /Nie widzialem tego/);
});

test('a character takes a break when nothing is going on, and not in a fight', async () => {
  const random = Math.random;
  Math.random = () => 0;
  const w = setup('{}');
  Math.random = random;
  w.body({ target: 'Rat' });
  w.mind.tick(names, () => false);
  assert.equal(w.orders?.().rest, undefined);
  await flush();
  w.advance(1000);
  w.body({ seen: [{ name: 'Sira', kind: 'player', hp: 100, x: 101, y: 100, z: 7 }] });
  w.mind.tick(names, () => false);
  await flush();
  assert.ok(w.orders().rest.seconds >= 180);
  assert.match(w.orders().say.at(-1).text, /zaraz wracam/);
});

function talkWorld(answer: object) {
  const seen: string[] = [];
  const w = setup(JSON.stringify(answer), seen);
  const fleet = new Set(['Kael']);
  const hear = async (text: string, extra: object = {}, body: Partial<BodyState> = {}) => {
    w.event({ kind: 'heard', from: 'GOD', text, level: 2, ...extra });
    w.body(body);
    w.mind.tick(fleet, () => true);
    await flush();
    w.advance(5000);
  };
  return { ...w, hear, seen, prompt: () => (JSON.parse(seen.at(-1)!) as { messages: { content: string }[] }).messages.map((m) => m.content).join('\n') };
}

test('after the name is said the conversation goes on without it', async () => {
  const w = talkWorld({ say: 'no siema', opinion: 0, follow: 'none' });
  const random = Math.random;
  Math.random = () => 0.99; // no overhearing by chance
  await w.hear('kael co tak stoisz');
  const after = w.seen.length;
  await w.hear('chodz za mna');
  Math.random = random;
  assert.equal(w.seen.length, after + 1, 'the next line is for him too');
  assert.match(w.prompt(), /chodz za mna/);
  assert.match(w.prompt(), /Dobry argument moze cie przekonac/);
});

test('a conversation with a person is not cut after three answers', async () => {
  const w = talkWorld({ say: 'odpowiadam', opinion: 0, follow: 'none' });
  for (let i = 0; i < 8; i++) await w.hear(`kael pytanie numer ${i}`);
  assert.equal((w.diary().match(/-> odpowiadam/g) ?? []).length, 8);
});

test('lines written in a burst arrive together', async () => {
  const w = talkWorld({ say: 'no dobra', opinion: 0, follow: 'none' });
  w.event({ kind: 'heard', from: 'GOD', text: 'kael gram juz dlugo', level: 2 });
  w.event({ kind: 'heard', from: 'GOD', text: 'i znam miejsca', level: 2 });
  w.body();
  w.mind.tick(new Set(['Kael']), () => true);
  await flush();
  assert.match(w.prompt(), /gram juz dlugo \/ i znam miejsca/);
});

test('the character decides to follow, and walks after the person', async () => {
  const w = talkWorld({ say: 'dobra, prowadz', opinion: 1, follow: 'follow_them' });
  const god = { name: 'GOD', kind: 'player' as const, hp: 100, x: 101, y: 100, z: 7 };
  await w.hear('kael chodz, pokaze ci szybki exp', {}, { seen: [god] });
  assert.match(w.diary(), /ide za GOD/);
  w.body({ seen: [god] });
  w.mind.tick(new Set(['Kael']), () => true);
  assert.deepEqual({ type: w.orders().goal.type, name: w.orders().goal.name }, { type: 'follow', name: 'GOD' });
  assert.match(w.prompt(), /stoi blisko/);
});

test('a weak argument leaves the character where it is', async () => {
  const w = talkWorld({ say: 'a po co', opinion: 0, follow: 'none' });
  await w.hear('kael chodz za mna');
  assert.doesNotMatch(w.diary(), /ide za/);
  assert.notEqual(w.orders().goal.type, 'follow');
});

test('someone who vanished is looked for where they were last seen', async () => {
  const grid = new NavGrid();
  grid.addChunk(96, 96, 7, Array(16).fill('ffff'));
  const w = setup(JSON.stringify({ say: 'dobra', opinion: 1, follow: 'follow_them' }), [], undefined, {}, grid);
  const fleet = new Set(['Kael']);
  const god = { name: 'GOD', kind: 'player' as const, hp: 100, x: 104, y: 100, z: 7 };
  w.event({ kind: 'heard', from: 'GOD', text: 'kael chodz', level: 2 });
  w.body({ seen: [god] });
  w.mind.tick(fleet, () => true);
  await flush();
  w.body({ seen: [god] });
  w.mind.tick(fleet, () => true);
  assert.equal(w.orders().goal.type, 'follow');
  w.advance(7000);
  w.body({ seen: [] });
  w.mind.tick(fleet, () => true);
  assert.match(w.diary(), /zgubilem GOD, ide tam/);
  assert.match(w.diary(), /trasa do 104,100,7/);
  w.advance(1000);
  w.body({ x: 103, y: 100, seen: [god] });
  w.mind.tick(fleet, () => true);
  assert.equal(w.orders().goal.type, 'follow', 'found again');
});

test('an empty trip to the depot is not repeated', async () => {
  const depots = [{ x: 104, y: 100, z: 7, locker: { x: 104, y: 99, z: 7 } }];
  const prompts: string[] = [];
  const w = setup(JSON.stringify({ choice: 'go_north', thought: 't', plan: 'p', say: '' }), prompts, undefined, { depots });
  w.body({ gold: 100 });
  w.mind.tick(names, () => true);
  await flush();
  assert.ok(prompts.at(-1)!.includes('schowaj zloto do depo'));
  w.event({ kind: 'depot_done', stored: 0, taken: 0, ok: true });
  w.advance(200_000);
  w.body({ gold: 100 });
  w.mind.tick(names, () => true);
  await flush();
  w.advance(5000);
  w.body({ gold: 100 });
  w.mind.tick(names, () => true);
  await flush();
  assert.ok(!prompts.at(-1)!.includes('schowaj zloto do depo'), 'the option is gone for a while');
});

test('a door that stayed shut is remembered, and a way round is taken', async () => {
  const grid = new NavGrid();
  grid.addChunk(96, 96, 7, Array(16).fill('ffff'));
  const store = new NpcMemoryStore(new Memory(':memory:'));
  const shut = tileKey(100, 100, 7);
  store.setPref('kael', 0, 'mind', JSON.stringify({ lockedDoors: [shut] }), 1);
  const dir = join(tempDir(), 'kael');
  mkdirSync(dir, { recursive: true });
  const mind = new PlayerMind('kael', def, dir, world, store, null, 0.35, () => 1_000_000, grid);
  assert.ok(grid.route({ x: 99, y: 100, z: 7 }, { x: 101, y: 100, z: 7 }, new Set([shut]))!.every((leg) => !(leg.x === 100 && leg.y === 100)));
  assert.ok(mind);
});

function walker(answer: object) {
  const grid = new NavGrid();
  grid.addChunk(96, 96, 7, Array(16).fill('ffff'));
  const npcs = [{ name: 'Tolek', x: 108, y: 100, z: 7 }];
  const w = setup(JSON.stringify(answer), [], undefined, { npcs }, grid);
  return w;
}

test('someone standing on the target counts as arriving next to it', async () => {
  const w = walker({ choice: 'npc_tolek', thought: 'pogadam', plan: 'p', say: '' });
  w.body();
  w.mind.tick(names, () => true);
  await flush();
  assert.match(w.diary(), /trasa do 108,100,7/);
  w.body({ x: 107, y: 100 });
  w.mind.tick(names, () => false);
  w.advance(60_000);
  w.body({ x: 107, y: 100 });
  w.mind.tick(names, () => false);
  assert.match(w.diary(), /dotarlem na miejsce/);
  assert.doesNotMatch(w.diary(), /utknalem/);
});

test('a place that cannot be reached is given up, not tried for ever', async () => {
  const w = walker({ choice: 'npc_tolek', thought: 'pogadam', plan: 'p', say: '' });
  w.body();
  w.mind.tick(names, () => true);
  await flush();
  for (let i = 0; i < 6; i++) {
    w.advance(60_000);
    w.body();
    w.mind.tick(names, () => false);
    await flush();
  }
  assert.match(w.diary(), /nie da sie tam dojsc/);
  assert.ok((w.diary().match(/utknalem/g) ?? []).length <= 4);
});
