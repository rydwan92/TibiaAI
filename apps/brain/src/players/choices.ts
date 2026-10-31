// What a character can do next. Options exist on the map right now; the model picks one and cannot
// invent a place or an action. Temperament picks when the model is away.
import { way } from './knowledge.ts';
import { gap } from './nav.ts';
import type { BodyState, Experience, Ground, Option, PlayerDef, Tip, WorldFacts } from './types.ts';

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
const WITHDRAW_BELOW = 40;
const OUT_OF_ARROWS = 15;

export const chunkOf = (s: { x: number; y: number; z: number }) => `${Math.floor(s.x / CHUNK)}:${Math.floor(s.y / CHUNK)}:${s.z}`;

/** Places worth hunting for this character: a real player knows what he can kill. */
export function groundsFor(s: BodyState, world: WorldFacts, exp: Experience): Ground[] {
  const strongest = Math.min(4, Math.floor(s.level / 12) + 1 + (exp.confidence > 0.6 ? 1 : 0)); // too strong is theirs to find out
  const near = (a: Ground, b: Ground) => gap(a, s) + Math.abs(a.z - s.z) * 30 - (gap(b, s) + Math.abs(b.z - s.z) * 30);
  const fits = (world.grounds ?? []).filter((g) => g.tier <= strongest && gap(g, s) > 12).sort(near);
  const fresh = fits.filter((g) => !exp.chunks[chunkOf(g)]); // the map is worth seeing, not one spot worth grinding
  return [...fresh.slice(0, 2), ...fits.filter((g) => !fresh.slice(0, 2).includes(g))].slice(0, 3);
}

const isArcher = (s: BodyState) => s.vocation === 'paladin' || (s.arrows ?? 0) > 0;

export function needsSupplies(s: BodyState): boolean {
  return s.potions.health < LOW_POTIONS || (isArcher(s) && (s.arrows ?? 0) < LOW_ARROWS) || (s.cap !== undefined && s.cap < LOW_CAP);
}

/** Without these a character cannot go on: an archer with no arrows, anyone with no potions. */
export function outOfSupplies(s: BodyState): boolean {
  return s.potions.health === 0 || (s.vocation === 'paladin' && (s.arrows ?? 0) < OUT_OF_ARROWS);
}

/** Options that exist right now. The model picks one; it cannot invent a place or an action. */
export function optionsFor(s: BodyState, world: WorldFacts, exp: Experience, tips: Tip[] = [], friends: string[] = []): Option[] {
  const options: Option[] = [];
  const monsters = s.seen.filter((c) => c.kind === 'monster');
  if (monsters.length > 0) options.push({ id: 'fight', label: `walcz tutaj: ${[...new Set(monsters.map((m) => m.name))].slice(0, 3).join(', ')}`, goal: { type: 'hunt', heading: { x: 0, y: 0 } } });
  for (const [i, t] of tips.slice(-2).entries()) {
    if (gap(t.ground, s) > 12 || t.ground.z !== s.z) {
      options.push({ id: `tip_${i + 1}`, label: `sprawdz, co polecal ${t.from}: ${t.ground.monsters.join(', ')} (${t.ground.name}, ${gap(t.ground, s)} pol stad)`, goal: { type: 'route', x: t.ground.x, y: t.ground.y, z: t.ground.z } });
    }
  }
  for (const [i, g] of groundsFor(s, world, exp).entries()) {
    const warned = exp.warnings[chunkOf(g)];
    const killers = g.monsters.filter((m) => exp.deathsBy[m]);
    const died = killers.length > 0 ? `, tu zginales przez ${killers[0]}` : exp.dangerAt[chunkOf(g)] ? ', tu juz prawie zginales' : warned ? `, ${warned} ostrzegal przed tym miejscem` : '';
    const hard = g.tier > Math.floor(s.level / 12) ? ', trudne' : '';
    options.push({ id: `hunt_${i + 1}`, label: `idz polowac: ${g.monsters.join(', ')} (${g.name}, ${gap(g, s)} pol stad${hard}${died})`, goal: { type: 'route', x: g.x, y: g.y, z: g.z } });
  }
  const unknownFirst = DIRECTIONS.map(([id, label, heading]) => {
    const been = exp.chunks[chunkOf({ x: s.x + heading.x * CHUNK, y: s.y + heading.y * CHUNK, z: s.z })] ?? 0;
    return { been, option: { id: `go_${id}`, label: `idz ${label}${been > 0 ? ' (juz tam byles)' : ' (nieznane)'}`, goal: { type: 'explore', heading } } };
  }).sort((a, b) => a.been - b.been);
  const wanderings = unknownFirst.slice(0, 2).map((d) => d.option);
  for (const dir of ['down', 'up'] as const) {
    const point = world.points.filter((p) => p.z === s.z && p.dir === dir && gap(p, s) <= FLOOR_SEARCH).sort((a, b) => gap(a, s) - gap(b, s))[0];
    if (point) {
      options.push({ id: `floor_${dir}`, label: `${dir === 'down' ? 'zejdz nizej' : 'wejdz wyzej'} (${point.kind}, ${gap(point, s)} pol stad)`, goal: { type: 'floor', x: point.x, y: point.y, z: point.z, kind: point.kind } });
    }
  }
  if (world.merchant) {
    const low = needsSupplies(s);
    options.push({ id: 'supply', label: `wroc do ${world.merchant.name}, sprzedaj lup i kup zapasy (zloto ${s.gold ?? 0}, mikstury ${s.potions.health}/${s.potions.mana}${s.arrows ? `, strzaly ${s.arrows}` : ''}${low ? ', konczy ci sie zapas' : ''}, ${gap(world.merchant, s)} pol)`, goal: { type: 'route', x: world.merchant.x, y: world.merchant.y, z: world.merchant.z, name: world.merchant.name, errand: 'shop' } });
  }
  const depot = [...(world.depots ?? [])].sort((a, b) => gap(a, s) + Math.abs(a.z - s.z) * 10 - gap(b, s) - Math.abs(b.z - s.z) * 10)[0];
  if (depot && (s.gold ?? 0) >= DEPOT_GOLD) {
    options.push({ id: 'depot', label: `schowaj zloto do depo, wtedy nie stracisz go przy smierci (zloto ${s.gold}, ${gap(depot, s)} pol)`, goal: { type: 'route', x: depot.x, y: depot.y, z: depot.z, errand: 'depot', locker: depot.locker } });
  }
  const known = new Set(Array.isArray(s.vips) ? s.vips.map((v) => v.name) : []);
  if (depot && exp.stored > 0 && (s.gold ?? 0) < WITHDRAW_BELOW) {
    options.push({ id: 'withdraw', label: `wyplac zloto z depo (masz tam ${exp.stored}, przy sobie ${s.gold ?? 0})`, goal: { type: 'route', x: depot.x, y: depot.y, z: depot.z, errand: 'withdraw', locker: depot.locker } });
  }
  for (const c of s.seen.filter((p) => p.kind === 'player')) {
    const grudge = Math.round(exp.grudges[c.name] ?? 0);
    if (known.has(c.name) && grudge < GRUDGE_TO_FIGHT) continue; // a friend needs a reason, a stranger only a mood
    options.push({ id: `attack_${c.name.toLowerCase().replace(/\W/g, '')}`, label: `zaatakuj gracza ${c.name}${grudge > 0 ? ` (masz do niego uraze: ${grudge})` : ''}`, goal: { type: 'pvp', name: c.name } });
  }
  const company = friends.map((name) => ({ id: `team_${name.toLowerCase()}`, label: `napisz do ${name} i zaproponuj wspolne polowanie`, goal: { type: 'team', name } }));
  if (exp.loneliness > LONELY) options.unshift(...company);
  else options.push(...company);
  const towns = [...world.towns].sort((a, b) => gap(a.temple, s) - gap(b.temple, s));
  const town = towns[0];
  for (const t of towns.slice(1).filter((t) => !exp.chunks[chunkOf(t.temple)]).slice(0, 2)) {
    options.push({ id: `travel_${t.name.split(' ')[0].toLowerCase()}`, label: `wyrusz do miasta ${t.name} (${way(s, t.temple)}, ${gap(t.temple, s)} pol, jeszcze tam nie byles)`, goal: { type: 'route', ...t.temple } });
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
    if (o.id.startsWith('hunt_')) return lowHealth ? 0.1 : (o.label.includes('ostrzegal') || o.label.includes('prawie zginales') ? 0.3 : 1.5) + def.greed + def.bravery * 0.5 + exp.boredom;
    if (o.id === 'supply') return needsSupplies(s) ? 6 : 0.1;
    if (o.id === 'depot') return 0.4 + def.greed;
    if (o.id === 'withdraw') return needsSupplies(s) ? 8 : 0.1;
    if (o.id.startsWith('attack_')) {
      const grudge = exp.grudges[o.goal.name ?? ''] ?? 0;
      return grudge >= GRUDGE_TO_FIGHT ? def.bravery + grudge * 0.3 : 0.02;
    }
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
