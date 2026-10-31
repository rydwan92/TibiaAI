// What a player of this character knows about the game, taken from the server's own data: spells,
// runes, monsters, towns and hunting grounds. No guessing and no model here.
import { existsSync, readFileSync } from 'node:fs';
import { gap } from './nav.ts';
import type { BodyState, FloorPoint, Ground, PlayerDef, RuneFacts, SpellFacts, WorldFacts } from './types.ts';

/** Best spells this character can really cast, from the server's own data. */
export function spellsFor(def: PlayerDef, level: number, spells: Record<string, SpellFacts> = {}): { heal?: SpellFacts; attack?: SpellFacts } {
  const usable = Object.values(spells).filter((v) => v.vocations.includes(def.vocation) && v.level <= level && !v.premium && v.mana > 0);
  const best = (group: string, filter: (v: SpellFacts) => boolean) => usable.filter((v) => v.group === group && filter(v)).sort((a, b) => b.level - a.level)[0];
  return { heal: best('healing', (v) => v.words.startsWith('exura') && !v.needsTarget && !v.words.includes('"')), attack: best('attack', (v) => v.words.startsWith('exori') && v.needsTarget && v.mana < 60) }; // area spells hit bystanders
}

/** Attack runes this character may use, best first. Magic level is the server's to check. */
export function runesFor(def: PlayerDef, level: number, runes: Record<string, RuneFacts> = {}): number[] {
  return Object.values(runes)
    .filter((r) => r.group === 'attack' && r.needsTarget && r.level <= level && r.magicLevel <= 1 && (r.vocations.length === 0 || r.vocations.includes(def.vocation)))
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
  const { heal, attack } = spellsFor(def, s.level, world.spells);
  const next = Object.values(world.spells ?? {}).filter((v) => v.vocations.includes(def.vocation) && v.level > s.level && !v.premium).sort((a, b) => a.level - b.level)[0];
  const towns = world.towns.map((t) => `${t.name} (${way(s, t.temple)}, ${gap(t.temple, s)} pol)`).slice(0, 7).join(', ');
  return [
    `PROFESJA ${def.vocation}: ${world.vocationTips?.[def.vocation] ?? ''}`,
    `TWOJE CZARY: leczenie ${heal?.words ?? 'brak'}, atak ${attack?.words ?? 'brak'}${next ? `; kolejny czar na poziomie ${next.level}: ${next.words}` : ''}.`,
    'NARZEDZIA: lina wciaga w gore przez jasna dziure w suficie, lopata odkopuje kupke kamieni w dol, drabiny i schody sa na mapie. Masz line i lopate.',
    `MIASTA: ${towns}.`,
    `HANDEL: mikstury, strzaly, jedzenie, liny i lopaty kupisz u ${world.merchant?.name ?? 'kupca'} w Montag, tam tez sprzedasz lup. Depo w miastach chroni rzeczy przed smiercia.`,
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
