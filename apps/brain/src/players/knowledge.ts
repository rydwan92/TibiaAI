// What a player of this character knows about the game, taken from the server's own data: spells,
// runes, monsters, towns and hunting grounds. No guessing and no model here.
import { existsSync, readFileSync } from 'node:fs';
import { gap } from './nav.ts';
import type { BodyState, FloorPoint, Ground, PlayerDef, RuneFacts, SpellFacts, WorldFacts } from './types.ts';

/** Best spells this character can really cast, from the server's own data. */
export function spellsFor(def: PlayerDef, level: number, spells: Record<string, SpellFacts> = {}, known?: Set<string>): { heal?: SpellFacts; attack?: SpellFacts } {
  const usable = Object.entries(spells).filter(([name, v]) => v.vocations.includes(def.vocation) && v.level <= level && !v.premium && v.mana > 0 && (!known || known.has(name.toLowerCase()))).map(([, v]) => v);
  const best = (group: string, filter: (v: SpellFacts) => boolean) => usable.filter((v) => v.group === group && filter(v)).sort((a, b) => b.level - a.level)[0];
  return { heal: best('healing', (v) => v.words.startsWith('exura') && !v.needsTarget && !v.words.includes('"')), attack: best('attack', (v) => v.words.startsWith('exori') && v.needsTarget && v.mana < 60) }; // area spells hit bystanders
}

/** Attack runes this character may use, best first. Magic level is the server's to check. */
export function runesFor(def: PlayerDef, level: number, runes: Record<string, RuneFacts> = {}, magicLevel = 0): number[] {
  return Object.values(runes)
    .filter((r) => r.group === 'attack' && r.needsTarget && r.level <= level && r.magicLevel <= magicLevel && (r.vocations.length === 0 || r.vocations.includes(def.vocation)))
    .sort((a, b) => b.level - a.level)
    .map((r) => r.id);
}

export const way = (from: { x: number; y: number }, to: { x: number; y: number }) => {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  return Math.abs(dy) >= Math.abs(dx) ? (dy > 0 ? 'na poludnie' : 'na polnoc') : dx > 0 ? 'na wschod' : 'na zachod';
};

/** What a player of this character knows about the game, from the server's own data. */
export function knowledgeFor(def: PlayerDef, s: BodyState, world: WorldFacts): string {
  const { heal, attack } = spellsFor(def, s.level, world.spells, s.known ? new Set(s.known) : undefined);
  const next = Object.values(world.spells ?? {}).filter((v) => v.vocations.includes(def.vocation) && v.level > s.level && !v.premium).sort((a, b) => a.level - b.level)[0];
  const towns = [...world.towns].sort((a, b) => gap(a.temple, s) - gap(b.temple, s)).slice(0, 7).map((t) => `${t.name} (${way(s, t.temple)}, ${gap(t.temple, s)} pol)`).join(', ');
  return [
    `PROFESJA ${def.vocation}: ${world.vocationTips?.[def.vocation] ?? ''}`,
    `TWOJE CZARY: leczenie ${heal?.words ?? 'brak'}, atak ${attack?.words ?? 'brak'}${next ? `; kolejny czar na poziomie ${next.level}: ${next.words}` : ''}.`,
    'DRZWI: zwykle drzwi otwierasz sam po drodze. Drzwi na klucz i drzwi z wymogiem poziomu lub questa sa dla ciebie zamkniete, trasa je omija.',
    'PODROZE: do dalekich miast plyniesz statkiem, kapitan w porcie bierze zloto za rejs.',
    'NARZEDZIA: lina wciaga w gore przez jasna dziure w suficie, lopata odkopuje kupke kamieni w dol, drabiny i schody sa na mapie. Masz line i lopate.',
    `MIASTA: ${towns}.`,
    'NAUKA: czary znasz dopiero, gdy nauczy cie ich nauczyciel w gildii twojej profesji. Mowisz mu hi, nazwe czaru i yes, a on bierze zloto.',
    `HANDEL: mikstury kupisz u kupcow w miastach, a sprzet u Sama w Thais; lup sprzedasz temu, kto go skupuje. Depo w miastach chroni rzeczy przed smiercia.`,
    'PVP: mozesz zaatakowac kazdego gracza poza strefa ochronna. Zabicie go daje czaszke, a on moze sie mscic. Decyzja nalezy do ciebie.',
    'TIBIA: exp z potworow daje poziomy, a poziom to hp, mana i nowe czary. Glebiej i dalej od miast potwory sa silniejsze. Bez mikstur latwo zginac, a smierc zabiera doswiadczenie. Powyzej pietra 7 sa budynki i wzgorza, ponizej jaskinie.',
  ].join('\n');
}

/** Facts about whatever a message names, so an agent answers from the game's data, not from guesses. */
export function lookupFacts(text: string, world: WorldFacts): string[] {
  const low = text.toLowerCase();
  const found: string[] = [];
  for (const [name, m] of Object.entries(world.monsters)) {
    if (low.includes(name.toLowerCase())) found.push(`${name}: ${m.health} hp, ${m.experience} exp, bije do ${m.peakDamage}${m.weakTo.length ? `, slaby na ${m.weakTo.join('/')}` : ''}`);
  }
  for (const [name, v] of Object.entries(world.spells ?? {})) {
    if (low.includes(name.toLowerCase()) || low.includes(v.words.toLowerCase())) found.push(`czar ${name}: ${v.words}, poziom ${v.level}, mana ${v.mana}, profesje ${v.vocations.join('/')}`);
  }
  for (const [name, r] of Object.entries(world.runes ?? {})) {
    if (low.includes(name.toLowerCase())) found.push(`runa ${name}: poziom ${r.level}, magia ${r.magicLevel}`);
  }
  return found.slice(0, 4);
}

/** Best potions this character may drink, strongest first, per need. */
export function potionsFor(def: PlayerDef, level: number, potions: WorldFacts['potions'] = []): { health: number[]; mana: number[] } {
  const allowed = potions.filter((p) => p.level <= level && (p.vocations.length === 0 || p.vocations.includes(def.vocation))).reverse();
  return { health: allowed.filter((p) => p.kind === 'health').map((p) => p.id), mana: allowed.filter((p) => p.kind === 'mana').map((p) => p.id) };
}

/** What a seasoned player would say about this level, worked out from what really walks this world. */
export function huntingAdvice(s: BodyState, world: WorldFacts): string {
  const names = new Set((world.grounds ?? []).flatMap((g) => g.monsters));
  const best = [...names].map((name) => ({ name, m: world.monsters[name] })).filter(({ m }) => m && m.experience > 0 && m.peakDamage < s.hpMax * 0.45)
    .sort((a, b) => b.m.experience / (b.m.health / (6 + s.level * 0.8) + 8) - a.m.experience / (a.m.health / (6 + s.level * 0.8) + 8)).slice(0, 5);
  return best.map(({ name, m }) => `${name} (${m.experience} exp, bije do ${m.peakDamage})`).join(', ');
}

/** The shopping list for this level: the standing list, with the best potions and rune it can use. */
export function suppliesFor(def: PlayerDef, level: number, magicLevel: number, world: WorldFacts): { id: number; count: number }[] {
  const best = potionsFor(def, level, world.potions);
  const rune = runesFor(def, level, world.runes, magicLevel).find((id) => world.sold?.includes(id));
  const more = Math.max(1, Math.min(4, level / 25)); // the deeper the hunt, the more a trip drinks
  return (world.supplies?.[def.vocation] ?? []).map((item) => {
    const kind = world.potions?.find((p) => p.id === item.id)?.kind;
    if (kind) return { ...item, id: best[kind][0] ?? item.id, count: Math.round(item.count * more) };
    if (Object.values(world.runes ?? {}).some((r) => r.id === item.id)) return { ...item, id: rune ?? item.id };
    return item;
  });
}

export function monsterNotes(s: BodyState, world: WorldFacts): string {
  const names = [...new Set(s.seen.filter((c) => c.kind === 'monster').map((c) => c.name))].slice(0, 4);
  return names.map((n) => {
    const m = world.monsters[n];
    return m ? `${n}: ${m.health} hp, ${m.experience} exp, bije do ${m.peakDamage}${m.weakTo.length ? `, slaby na ${m.weakTo.join('/')}` : ''}` : n;
  }).join('; ');
}

export function loadWorldFacts(gameDataPath: string, atlasPath: string, groundsPath?: string): WorldFacts {
  const game = JSON.parse(readFileSync(gameDataPath, 'utf8')) as { monsters: WorldFacts['monsters']; spells: WorldFacts['spells']; runes: WorldFacts['runes'] };
  const atlas = existsSync(atlasPath) ? JSON.parse(readFileSync(atlasPath, 'utf8')) as { points: FloorPoint[]; towns: WorldFacts['towns'] } : { points: [], towns: [] };
  const grounds = groundsPath && existsSync(groundsPath) ? (JSON.parse(readFileSync(groundsPath, 'utf8')) as { grounds: Ground[] }).grounds : [];
  return { monsters: game.monsters, spells: game.spells, runes: game.runes, grounds, points: atlas.points, towns: atlas.towns.filter((t) => t.name !== 'Tps Room') };
}
