// Minds of player agents with a FAKE model and a simulated body: logic only. Real play is checked
// through scripts\player-agents.ps1 in real clients.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Memory } from '../src/memory.ts';
import { NpcMemoryStore } from '../src/npc/store.ts';
import { chooseByTemperament, groundsFor, needsSupplies, optionsFor, outOfSupplies, tooDangerous } from '../src/players/choices.ts';
import { knowledgeFor, lookupFacts, runesFor, spellsFor } from '../src/players/knowledge.ts';
import { PlayerMind } from '../src/players/mind.ts';
import type { BodyState, PlayerDef, WorldFacts } from '../src/players/types.ts';
import { NavGrid, tileKey } from '../src/players/nav.ts';
import { loadLocalAiConfig, LocalModelClient } from '../src/providers/local-model.ts';
import { tempDir } from './helpers.ts';

const world: WorldFacts = {
  monsters: {
    Rat: { health: 20, experience: 5, peakDamage: 8, attacks: ['melee'], weakTo: [], hostile: true },
    Hydra: { health: 2350, experience: 2100, peakDamage: 320, attacks: ['melee'], weakTo: ['ice'], hostile: true },
  },
  points: [{ x: 110, y: 100, z: 7, kind: 'hole', dir: 'down' }, { x: 90, y: 100, z: 7, kind: 'ladder', dir: 'up' }, { x: 500, y: 500, z: 7, kind: 'stairs', dir: 'down' }, { x: 100, y: 100, z: 8, kind: 'stairs', dir: 'up' }],
  towns: [{ name: 'Montag', temple: { x: 200, y: 200, z: 7 } }],
};
const def: PlayerDef = { character: 'Kael', vocation: 'knight', bravery: 0.5, curiosity: 0.5, sociability: 1, greed: 0.5, voice: 'krotko' };
const base: BodyState = { atMs: 0, online: true, name: 'Kael', level: 8, experience: 4200, hp: 185, hpMax: 185, mana: 90, manaMax: 90, x: 100, y: 100, z: 7, target: '', potions: { health: 5, mana: 2 }, seen: [], goalId: 0 };
const exp = { fear: 0.2, confidence: 0.4, boredom: 0.2, loneliness: 0.2, kills: {}, deathsBy: {}, deaths: 0, chunks: {}, floors: [], dangerAt: {}, warnings: {}, plan: '', finding: null, tipsGiven: 0, tipsHeard: 0, grudges: {}, lessons: [], ways: {}, trades: 0, stored: 0, pvpFights: 0, helped: 0, trips: 0, modelChoices: 0, ruleChoices: 0 };
const rat = { name: 'Rat', kind: 'monster' as const, hp: 100, x: 101, y: 100, z: 7 };
const hydra = { ...rat, name: 'Hydra' };

function setup(answer: string | Error, seen: string[] = [], identity?: string) {
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
  const mind = new PlayerMind('kael', def, dir, { ...world, identity }, store, new LocalModelClient(policy, fetcher), 0.35, now);
  const body = (over: Partial<BodyState> = {}) => writeFileSync(join(dir, 'state.json'), JSON.stringify({ ...base, atMs: clock, ...over }));
  const event = (e: object) => appendFileSync(join(dir, 'events.jsonl'), `${JSON.stringify({ atMs: clock, ...e })}\n`);
  const orders = () => JSON.parse(readFileSync(join(dir, 'orders.json'), 'utf8'));
  const diary = () => readFileSync(join(dir, 'diary.log'), 'utf8');
  const advance = (ms: number) => { clock += ms; };
  return { dir, store, mind, body, event, orders, diary, advance };
}

const names = new Set(['Kael', 'Sira']);
const flush = () => new Promise((r) => setTimeout(r, 10));

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
  const grounds = [{ name: 'blisko', town: 'Montag', tier: 0, monsters: ['Rat'], x: 150, y: 150, z: 7 }, { name: 'daleko', town: 'Montag', tier: 4, monsters: ['Hydra'], x: 180, y: 180, z: 12 }];
  assert.deepEqual(groundsFor(base, { ...world, grounds }, exp).map((g) => g.name), ['blisko'], 'no hydras at level 8');
  assert.equal(groundsFor({ ...base, level: 60 }, { ...world, grounds }, exp).length, 2);
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
  const ground = { name: 'na polnoc od Montag, na powierzchni', town: 'Montag', tier: 0, monsters: ['Wolf'], x: 150, y: 90, z: 7 };
  const options = optionsFor({ ...base, x: 150, y: 150 }, world, exp, [{ from: 'Sira', ground }]);
  assert.ok(options.some((o) => o.id === 'tip_1' && o.goal.type === 'route' && o.label.includes('Sira')), JSON.stringify(options.map((o) => o.id)));
  assert.ok(options.findIndex((o) => o.id === 'tip_1') < options.findIndex((o) => o.id === 'go_north'), 'a reason to go somewhere comes before wandering');
  world.grounds = [ground];
  try {
    const h = setup(JSON.stringify({ say: 'dzieki' }));
    h.body();
    h.mind.tick(new Set(['Kael', 'Sira']), () => false);
    await new Promise((r) => setTimeout(r, 10)); // the first decision finishes
    h.event({ kind: 'heard', from: 'Sira', text: 'polecam na polnoc od Montag, na powierzchni, sa tam Wolf', level: 8, private: true });
    h.mind.tick(new Set(['Kael', 'Sira']), () => true);
    await new Promise((r) => setTimeout(r, 30));
    assert.match(h.diary(), /Sira poleca: na polnoc od Montag/);
    assert.equal(h.orders().say.at(-1).to, 'Sira', 'a private message gets a private answer');
    h.event({ kind: 'heard', from: 'Ravn', text: 'uwazaj na polnoc od Montag, na powierzchni', level: 8 });
    h.mind.tick(new Set(['Kael', 'Sira']), () => false);
    assert.match(h.diary(), /Ravn ostrzega przed/);
    h.event({ kind: 'heard', from: 'Canary', text: 'na polnoc od Montag, na powierzchni', level: 0 });
    h.mind.tick(new Set(['Kael', 'Sira']), () => false);
    assert.doesNotMatch(h.diary(), /Canary/, 'an NPC is not a player giving advice');
  } finally {
    delete world.grounds;
  }
});

test('new places and towns draw a character out; loneliness brings friends to the top', () => {
  const grounds = [
    { name: 'a', town: 'Montag', tier: 0, monsters: ['Rat'], x: 120, y: 100, z: 7 },
    { name: 'b', town: 'Montag', tier: 0, monsters: ['Rat'], x: 130, y: 100, z: 7 },
    { name: 'c', town: 'Montag', tier: 0, monsters: ['Rat'], x: 140, y: 100, z: 7 },
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
  const settle = () => new Promise((r) => setTimeout(r, 10));
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

test('friends online can be asked along; agents answer each other in private and a chat ends', async () => {
  const friendly = { vips: [{ name: 'Sira', online: true }, { name: 'Ravn', online: false }] };
  const options = optionsFor({ ...base, ...friendly }, world, exp, [], ['Sira']);
  assert.ok(options.some((o) => o.id === 'team_sira' && o.goal.type === 'team'));
  const h = setup(JSON.stringify({ say: 'spoko' }));
  const names = new Set(['Kael', 'Sira', 'Ravn']);
  const settle = () => new Promise((r) => setTimeout(r, 10));
  h.body(friendly);
  h.mind.tick(names, () => false);
  await settle();
  h.event({ kind: 'heard', from: 'Sira', text: 'idziemy razem? gdzie jestes?', level: 8, private: true });
  h.mind.tick(names, () => true);
  await settle();
  assert.match(h.orders().say.at(-1).text, /jestem 100,100,7/, 'the place travels in words');
  assert.equal(h.orders().say.at(-1).to, 'Sira');
  for (let i = 0; i < 7; i++) {
    h.advance(5000);
    h.body(friendly);
    h.event({ kind: 'heard', from: 'Ravn', text: `co tam ${i}`, level: 8, private: true });
    h.mind.tick(names, () => true);
    await settle();
  }
  const toRavn = h.orders().say.filter((l: { to?: string }) => l.to === 'Ravn');
  assert.ok(toRavn.length >= 1, 'a private message gets an answer');
  assert.ok(toRavn.length <= 4, `a chat ends: ${toRavn.length}`);
  assert.match(h.diary(), /Ravn: co tam \d -> spoko/);
  assert.match(h.diary(), /-> \(bez odpowiedzi\)/, 'the same line twice is left unsaid');
});

test('two friends asking at once do not end up following each other in circles', async () => {
  const settle = () => new Promise((r) => setTimeout(r, 10));
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
  assert.match(h.orders().say.at(-1).text, /jestem 100,100,7/, 'Kael sorts before Sira, so Kael leads');
});

test('hurt with a monster at hand, a character calls an online friend with its place', async () => {
  const h = setup(JSON.stringify({ choice: 'go_north', thought: 'x', plan: 'y', say: '' }));
  const names = new Set(['Kael', 'Sira']);
  h.body({ hp: 30, vips: [{ name: 'Sira', online: true }], seen: [rat] });
  h.mind.tick(names, () => false);
  await new Promise((r) => setTimeout(r, 10));
  const call = h.orders().say.find((l: { text: string }) => l.text.startsWith('pomocy'));
  assert.equal(call.to, 'Sira');
  assert.match(call.text, /Rat mnie bije, jestem 100,100,7/);
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
