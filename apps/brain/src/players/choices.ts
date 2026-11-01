// What a character can do next. Options exist on the map right now; the model picks one and cannot
// invent a place or an action. Temperament picks when the model is away.
import { way } from './knowledge.ts';
import { bestSpots, expPerHour, spotValue } from './places.ts';
import { gap } from './nav.ts';
import type { BodyState, Experience, GearOffer, Ground, Lesson, Option, PlayerDef, SpellFacts, Teacher, Tip, WorldFacts } from './types.ts';

const DIRECTIONS: [string, string, { x: number; y: number }][] = [
  ['north', 'na polnoc', { x: 0, y: -1 }], ['south', 'na poludnie', { x: 0, y: 1 }], ['east', 'na wschod', { x: 1, y: 0 }], ['west', 'na zachod', { x: -1, y: 0 }],
];
const FLOOR_SEARCH = 45;
const CHUNK = 32;
const NPC_NEAR = 40;
const LONELY = 0.6;
const LOW_POTIONS = 3;
const LOW_ARROWS = 30;
const LOW_CAP = 30;
const DEPOT_GOLD = 100;
const GRUDGE_TO_FIGHT = 3;
const PRANK_HP = 70;
const BASE_DAMAGE = 6;
const DAMAGE_PER_LEVEL = 0.8;
const WALK_SECONDS = 8;
const SAFE_HIT = 0.25;
const BRAVE_HIT = 0.3;
const FAR_AWAY = 400;
const POTIONS_PER_LEVEL = 0.1;
const NEAR_SQUARE = 8;
const TOWNS_OFFERED = 3;
const KEEP_FOR_SUPPLIES = 100;
const SHIELD_SLOT = 5;
const WITHDRAW_BELOW = 40;
const OUT_OF_ARROWS = 15;
const OWN_SPOTS = 2;
const WEAK_TARGET = 35;
const KNOWN_AROUND_HOME = 80;
const MAGES = new Set(['sorcerer', 'druid']);

export const chunkOf = (s: { x: number; y: number; z: number }) => `${Math.floor(s.x / CHUNK)}:${Math.floor(s.y / CHUNK)}:${s.z}`;

/** How a ground should pay for this character: time to kill and walk against the experience, and the worst hit. */
export function huntValue(g: Ground, s: BodyState, world: WorldFacts): { perHour: number; danger: number; known: boolean } {
  const known = g.monsters.map((m) => world.monsters[m]).filter(Boolean);
  if (known.length === 0) return { perHour: 0, danger: 0, known: false };
  const damage = BASE_DAMAGE + s.level * DAMAGE_PER_LEVEL;
  const seconds = known.reduce((sum, m) => sum + m.health / damage + WALK_SECONDS, 0);
  return { perHour: Math.round((known.reduce((sum, m) => sum + m.experience, 0) / seconds) * 3600), danger: Math.max(...known.map((m) => m.peakDamage)) / s.hpMax, known: true };
}

/** Places worth hunting for this character: strong enough to pay, weak enough to survive, and a walk that is worth it. */
export function groundsFor(s: BodyState, world: WorldFacts, exp: Experience): Ground[] {
  const strongest = Math.min(4, Math.floor(s.level / 12) + 1 + (exp.confidence > 0.6 ? 1 : 0));
  const dangerLimit = SAFE_HIT + exp.confidence * BRAVE_HIT;
  const canTake = (g: Ground) => {
    const v = huntValue(g, s, world);
    return v.known ? v.danger <= dangerLimit : g.tier <= strongest;
  };
  const worth = (g: Ground) => huntValue(g, s, world).perHour / (1 + (gap(g, s) + Math.abs(g.z - s.z) * 30) / FAR_AWAY);
  const near = (a: Ground, b: Ground) => worth(b) - worth(a);
  const home = s.knownNear;
  const around = home ? [home, ...(s.knownTowns ?? [])] : [];
  const heardOf = (g: Ground) => !home || around.some((t) => gap(g, t) <= (s.knownRange ?? KNOWN_AROUND_HOME)) || exp.chunks[chunkOf(g)] !== undefined;
  const pays = (g: Ground) => g.monsters.some((m) => (world.monsters[m]?.experience ?? 1) > 0); // chickens give nothing, a player knows that
  const fits = (world.grounds ?? []).filter((g) => canTake(g) && gap(g, s) > 12 && heardOf(g) && pays(g)).sort(near);
  const fresh = fits.filter((g) => !exp.chunks[chunkOf(g)]); // the map is worth seeing, not one spot worth grinding
  return [...fresh.slice(0, 2), ...fits.filter((g) => !fresh.slice(0, 2).includes(g))].slice(0, 3);
}

const isArcher = (s: BodyState) => s.vocation === 'paladin' || (s.arrows ?? 0) > 0;

export function needsSupplies(s: BodyState): boolean {
  const mage = MAGES.has(s.vocation ?? '');
  const low = Math.max(LOW_POTIONS, Math.floor(s.level * POTIONS_PER_LEVEL));
  return s.potions.health < low || (mage && s.potions.mana < low) || (isArcher(s) && (s.arrows ?? 0) < LOW_ARROWS) || (s.cap !== undefined && s.cap < LOW_CAP) || (s.missing?.length ?? 0) > 0;
}

/** Without these a character cannot go on: an archer with no arrows, anyone with no potions. */
export function outOfSupplies(s: BodyState): boolean {
  const mage = MAGES.has(s.vocation ?? '');
  return s.potions.health === 0 || (mage && s.potions.mana === 0) || (s.vocation === 'paladin' && (s.arrows ?? 0) < OUT_OF_ARROWS) || (s.missing?.length ?? 0) > 0;
}

/** The spell most worth a trip: healing first, then attack, nearest teacher, only what can be paid. */
export function nextLesson(s: BodyState, world: WorldFacts): { teacher: Teacher; lesson: Lesson; spell: SpellFacts } | null {
  const known = new Set(s.known ?? []);
  const found = [];
  for (const teacher of world.teachers ?? []) {
    for (const lesson of teacher.spells) {
      const entry = Object.entries(world.spells ?? {}).find(([name]) => name.toLowerCase() === lesson.spell.toLowerCase());
      if (!entry || known.has(lesson.spell.toLowerCase())) continue;
      const spell = entry[1];
      const useful = spell.group === 'healing' || (spell.group === 'attack' && spell.needsTarget);
      if (useful && lesson.vocations.includes(s.vocation ?? '') && lesson.level <= s.level && lesson.price <= (s.gold ?? 0) && !lesson.premium && !spell.premium) found.push({ teacher, lesson, spell });
    }
  }
  const rank = (f: { teacher: Teacher; spell: SpellFacts }) => (f.spell.group === 'healing' ? 0 : 1) * 100_000 + gap(f.teacher, s) + Math.abs(f.teacher.z - s.z) * 10;
  return found.sort((a, b) => rank(a) - rank(b))[0] ?? null;
}

/** The purchase that protects most for the money, leaving enough for potions. Never a shield over a bow. */
export function nextGear(s: BodyState, world: WorldFacts): GearOffer | null {
  if (!world.gearShop || !s.worn) return null;
  const worn = (slot: number) => world.gearValues?.[String(s.worn![String(slot)])]?.value ?? 0;
  const spare = (s.gold ?? 0) - KEEP_FOR_SUPPLIES;
  const fits = (g: GearOffer) => s.cap === undefined || g.weight <= s.cap; // the server refuses what cannot be carried
  const better = world.gearShop.items.filter((g) => g.price <= spare && g.level <= s.level && fits(g) && g.value > worn(g.slot) && (g.slot !== SHIELD_SLOT || worn(SHIELD_SLOT) > 0));
  return better.sort((a, b) => (b.value - worn(b.slot)) / b.price - (a.value - worn(a.slot)) / a.price)[0] ?? null;
}

/** Options that exist right now. The model picks one; it cannot invent a place or an action. */
export function optionsFor(s: BodyState, world: WorldFacts, exp: Experience, tips: Tip[] = [], friends: string[] = []): Option[] {
  const options: Option[] = [];
  const monsters = s.seen.filter((c) => c.kind === 'monster');
  if (monsters.length > 0) options.push({ id: 'fight', label: `walcz tutaj: ${[...new Set(monsters.map((m) => m.name))].slice(0, 3).map((name) => (world.monsters[name] ? `${name} ${world.monsters[name].experience} exp` : name)).join(', ')}`, goal: { type: 'hunt', heading: { x: 0, y: 0 } } });
  for (const [i, t] of tips.slice(-2).entries()) {
    if (gap(t.ground, s) > 12 || t.ground.z !== s.z) {
      options.push({ id: `tip_${i + 1}`, label: `sprawdz, co polecal ${t.from}: ${t.ground.monsters.join(', ')} (${t.ground.name}, ${gap(t.ground, s)} pol stad)`, goal: { type: 'route', x: t.ground.x, y: t.ground.y, z: t.ground.z } });
    }
  }
  const spots = bestSpots(exp, s, OWN_SPOTS);
  const top = Math.max(1, ...Object.values(exp.places).map(spotValue));
  for (const [i, p] of spots.entries()) {
    const died = p.deaths > 0 ? `, zginales tu ${p.deaths}x` : '';
    options.push({ id: `spot_${i + 1}`, label: `wroc na swoja miejscowke: ${p.name} (${p.doing}, ${expPerHour(p)} exp/h, ${p.visits}x${died}, ${gap(p, s)} pol)`, goal: { type: 'route', x: p.x, y: p.y, z: p.z }, risk: Math.min(1, p.deaths * 0.3), value: spotValue(p) / top });
  }
  for (const [i, g] of groundsFor(s, world, exp).entries()) {
    const warned = exp.warnings[chunkOf(g)];
    const killers = g.monsters.filter((m) => exp.deathsBy[m]);
    const died = killers.length > 0 ? `, tu zginales przez ${killers[0]}` : exp.dangerAt[chunkOf(g)] ? ', tu juz prawie zginales' : warned ? `, ${warned} ostrzegal przed tym miejscem` : '';
    const pays = huntValue(g, s, world);
    const hard = pays.known ? (pays.danger > SAFE_HIT ? `, bije do ${Math.round(pays.danger * 100)}% twojego zycia` : '') : g.tier > Math.floor(s.level / 12) ? ', trudne' : '';
    const risk = killers.length > 0 ? 0.8 : exp.dangerAt[chunkOf(g)] ? 0.6 : warned ? 0.5 : hard ? 0.2 : 0;
    const worth = g.monsters.map((m) => (world.monsters[m] ? `${m} ${world.monsters[m].experience} exp` : m)).join(', ');
    options.push({ id: `hunt_${i + 1}`, label: `idz polowac: ${worth} (${g.name}, ${gap(g, s)} pol stad${pays.perHour ? `, szacunkowo ${pays.perHour} exp/h` : ''}${hard}${died})`, goal: { type: 'route', x: g.x, y: g.y, z: g.z }, risk });
  }
  const unknownFirst = DIRECTIONS.map(([id, label, heading]) => {
    const been = exp.chunks[chunkOf({ x: s.x + heading.x * CHUNK, y: s.y + heading.y * CHUNK, z: s.z })] ?? 0;
    return { been, option: { id: `go_${id}`, label: `idz ${label}${been > 0 ? ' (juz tam byles)' : ' (nieznane)'}`, goal: { type: 'explore', heading } } };
  }).sort((a, b) => a.been - b.been);
  const wanderings = unknownFirst.slice(0, 2).map((d) => d.option);
  for (const dir of ['down', 'up'] as const) {
    // Ways nobody has taken yet come first: the map is there to be learned.
    const seen = (p: { x: number; y: number; z: number }) => (exp.chunks[chunkOf(p)] ? FLOOR_SEARCH : 0);
    const point = world.points.filter((p) => p.z === s.z && p.dir === dir && p.kind !== 'teleport' && gap(p, s) <= FLOOR_SEARCH).sort((a, b) => gap(a, s) + seen(a) - gap(b, s) - seen(b))[0];
    if (point) {
      options.push({ id: `floor_${dir}`, label: `${dir === 'down' ? 'zejdz nizej' : 'wejdz wyzej'} (${point.kind}, ${gap(point, s)} pol stad)`, goal: { type: 'floor', x: point.x, y: point.y, z: point.z, kind: point.kind } });
    }
  }
  const shop = world.merchant ? [world.merchant, ...(world.shops ?? [])].sort((a, b) => gap(a, s) + Math.abs(a.z - s.z) * 10 - gap(b, s) - Math.abs(b.z - s.z) * 10)[0] : undefined;
  if (shop && !s.justShopped) {
    const low = needsSupplies(s);
    options.push({ id: 'supply', label: `idz do ${shop.name}, sprzedaj lup i kup zapasy (zloto ${s.gold ?? 0}, mikstury ${s.potions.health}/${s.potions.mana}${s.arrows ? `, strzaly ${s.arrows}` : ''}${s.missing?.length ? `, brakuje ci ${s.missing.length} rzeczy z ekwipunku` : ''}${low ? ', konczy ci sie zapas' : ''}, ${gap(shop, s)} pol)`, goal: { type: 'route', x: shop.x, y: shop.y, z: shop.z, name: shop.name, errand: 'shop', greet: shop !== world.merchant } });
  }
  const depot = [...(world.depots ?? [])].sort((a, b) => gap(a, s) + Math.abs(a.z - s.z) * 10 - gap(b, s) - Math.abs(b.z - s.z) * 10)[0];
  if (depot && (s.gold ?? 0) >= DEPOT_GOLD) {
    options.push({ id: 'depot', label: `schowaj zloto do depo, wtedy nie stracisz go przy smierci (zloto ${s.gold}, ${gap(depot, s)} pol)`, goal: { type: 'route', x: depot.x, y: depot.y, z: depot.z, errand: 'depot', locker: depot.locker } });
  }
  const next = nextLesson(s, world);
  if (next) {
    const { teacher, lesson, spell } = next;
    const first = spell.group === 'healing' && !Object.entries(world.spells ?? {}).some(([name, v]) => v.group === 'healing' && (s.known ?? []).includes(name.toLowerCase()));
    options.push({ id: `learn_${lesson.spell.toLowerCase().replace(/\W/g, '')}`, label: `naucz sie czaru ${lesson.spell} (${spell.words}) u ${teacher.npc}${lesson.price > 0 ? ` za ${lesson.price} zlota` : ' za darmo'}, ${gap(teacher, s)} pol${first ? ', bez tego nie wyleczysz sie czarem' : ''}`, goal: { type: 'route', x: teacher.x, y: teacher.y, z: teacher.z, name: teacher.npc, errand: 'learn', lesson: { spell: lesson.spell, word: lesson.word } }, value: first ? 1 : 0.5 });
  }
  const gear = nextGear(s, world);
  if (gear && world.gearShop) {
    const shop = world.gearShop;
    const now = world.gearValues?.[String(s.worn?.[String(gear.slot)])]?.value ?? 0;
    options.push({ id: `gear_${gear.id}`, label: `kup u ${shop.npc}: ${gear.name} (ochrona ${gear.value}, masz ${now}) za ${gear.price} zlota, ${gap(shop, s)} pol`, goal: { type: 'route', x: shop.x, y: shop.y, z: shop.z, name: shop.npc, errand: 'shop', offer: gear }, value: Math.min(1, (gear.value - now) / 4) });
  }
  const known = new Set(Array.isArray(s.vips) ? s.vips.map((v) => v.name) : []);
  if (depot && exp.stored > 0 && ((s.gold ?? 0) < WITHDRAW_BELOW || s.wantsCash)) {
    options.push({ id: 'withdraw', label: `wyplac zloto z depo (masz tam ${exp.stored}, przy sobie ${s.gold ?? 0})`, goal: { type: 'route', x: depot.x, y: depot.y, z: depot.z, errand: 'withdraw', locker: depot.locker } });
  }
  for (const c of s.seen.filter((p) => p.kind === 'player' && !s.sparing?.includes(p.name))) {
    const grudge = Math.round(exp.grudges[c.name] ?? 0);
    if (known.has(c.name) && grudge < GRUDGE_TO_FIGHT) {
      // A friend needs a reason, and a joke is one: short, harmless, and it may still sting.
      if ((s.mischief ?? 0) > 0 && c.hp >= PRANK_HP && s.hp / s.hpMax >= PRANK_HP / 100) options.push({ id: `prank_${c.name.toLowerCase().replace(/\W/g, '')}`, label: `zaczep ${c.name} dla zartu (krotki sparing, bez zabijania, moze sie obrazic)`, goal: { type: 'pvp', name: c.name, prank: true } });
      continue;
    }
    const motive = grudge > 0 ? ` (masz do niego uraze: ${grudge})` : c.hp < WEAK_TARGET ? ` (ledwo stoi, ma ${c.hp}% zycia, latwy lup)` : ' (dla zabawy albo dla szacunku)';
    options.push({ id: `attack_${c.name.toLowerCase().replace(/\W/g, '')}`, label: `zaatakuj gracza ${c.name}${motive}`, goal: { type: 'pvp', name: c.name }, value: c.hp < WEAK_TARGET ? 1 : 0 });
  }
  const company = friends.map((name) => ({ id: `team_${name.toLowerCase()}`, label: `napisz do ${name} i zaproponuj wspolne polowanie`, goal: { type: 'team', name } }));
  if (exp.loneliness > LONELY) options.unshift(...company);
  else options.push(...company);
  if (world.square && gap(world.square, s) > NEAR_SQUARE) options.push({ id: 'square', label: `idz na ${world.square.name}, tam spotkasz ludzi i pogadasz (${gap(world.square, s)} pol)`, goal: { type: 'route', x: world.square.x, y: world.square.y, z: world.square.z } });
  const towns = [...world.towns].sort((a, b) => gap(a.temple, s) - gap(b.temple, s));
  const town = towns[0];
  for (const t of towns.slice(1).filter((t) => !exp.towns.includes(t.name)).slice(0, TOWNS_OFFERED)) {
    options.push({ id: `travel_${t.name.split(' ')[0].toLowerCase()}`, label: `wyrusz do miasta ${t.name} (${way(s, t.temple)}, ${gap(t.temple, s)} pol, jeszcze tam nie byles, moze trzeba statkiem)`, goal: { type: 'route', ...t.temple } });
  }
  const npc = [...(world.npcs ?? [])].filter((n) => n.z === s.z && gap(n, s) <= NPC_NEAR).sort(() => Math.random() - 0.5)[0];
  if (npc) options.push({ id: `npc_${npc.name.toLowerCase()}`, label: `porozmawiaj z ${npc.name} i wypytaj o swiat`, goal: { type: 'route', x: npc.x, y: npc.y, z: npc.z, name: npc.name } });
  if (town && gap(town.temple, s) > 12) {
    options.push({ id: 'town', label: `wroc do miasta ${town.name} (${gap(town.temple, s)} pol)`, goal: { type: 'route', ...town.temple } });
  }
  return [...options, ...wanderings];
}

/** Without a model: temperament and experience decide, with some chance, like a person. */
export function chooseByTemperament(def: PlayerDef, exp: Experience, s: BodyState, options: Option[], random = Math.random): Option {
  const weight = (o: Option): number => {
    const lowHealth = s.hp / s.hpMax < 0.5 || s.potions.health === 0;
    if (o.id === 'town') return lowHealth ? 4 : 0.2 + exp.fear;
    if (o.id === 'fight') return lowHealth ? 0.1 : 1 + def.bravery * 2 + def.greed + exp.confidence;
    if (o.id === 'floor_down') return lowHealth ? 0.05 : def.bravery + def.curiosity + exp.boredom - exp.fear;
    if (o.id === 'floor_up') return exp.fear + (s.z > 7 ? 0.5 : 0.1);
    if (o.id.startsWith('hunt_')) return lowHealth ? 0.1 : (1.5 + def.greed + def.bravery * 0.5 + exp.boredom + def.curiosity * 0.5) * (1 - (o.risk ?? 0));
    if (o.id.startsWith('spot_')) return lowHealth ? 0.1 : (1 + (o.value ?? 0) * 2 + def.greed) * (1 - (o.risk ?? 0) * 0.7) * (1 - exp.boredom * 0.5);
    if (o.id === 'supply') return needsSupplies(s) ? 6 : 0.1;
    if (o.id === 'depot') return 0.4 + def.greed;
    if (o.id === 'withdraw') return needsSupplies(s) ? 8 : 0.1;
    if (o.id.startsWith('learn_')) return lowHealth ? 0.3 : 1 + (o.value ?? 0) * 8;
    if (o.id.startsWith('attack_')) {
      const grudge = exp.grudges[o.goal.name ?? ''] ?? 0;
      if (grudge >= GRUDGE_TO_FIGHT) return def.bravery + grudge * 0.3;
      if (lowHealth) return 0.02;
      return 0.02 + (def.mischief ?? 0) * (0.3 + def.bravery * 0.3) + (def.mischief ?? 0) * def.greed * (o.value ?? 0);
    }
    if (o.id === 'square') return lowHealth ? 0.05 : 0.1 + def.sociability * exp.loneliness * 2;
    if (o.id.startsWith('gear_')) return lowHealth ? 0.1 : 1.5 + (o.value ?? 0) * 3;
    if (o.id.startsWith('prank_')) return lowHealth ? 0.02 : (def.mischief ?? 0) * 0.5;
    if (o.id.startsWith('vow_')) return lowHealth ? 0.3 : 3;
    if (o.id.startsWith('travel_')) return lowHealth ? 0.05 : def.curiosity + exp.boredom;
    if (o.id.startsWith('npc_')) return 0.2 + def.sociability * 0.5;
    if (o.id.startsWith('team_')) return 0.3 + def.sociability + exp.fear * 0.5;
    if (o.id.startsWith('tip_')) return lowHealth ? 0.1 : 1 + def.sociability + def.curiosity;
    return (o.label.includes('nieznane') ? 1 + def.curiosity : 0.3) + exp.boredom;
  };
  const weights = options.map((o) => Math.max(0.02, weight(o)));
  let roll = random() * weights.reduce((a, b) => a + b, 0);
  for (let i = 0; i < options.length; i++) {
    roll -= weights[i];
    if (roll <= 0) return options[i];
  }
  return options[options.length - 1];
}

/** A monster that can take this share of the character's health in one round is not worth it. */
export function tooDangerous(s: BodyState, world: WorldFacts, bravery: number, factor: number): string | null {
  const limit = s.hpMax * (factor + bravery * 0.35);
  for (const c of s.seen) {
    const m = c.kind === 'monster' ? world.monsters[c.name] : undefined;
    if (m && m.peakDamage > limit) return c.name;
  }
  return null;
}
