// A character's own map of the world: where it has been, what it went there for and what came of it.
// Only what really happened goes in, measured from experience and gold the game reported. This is the
// character's knowledge, separate from the designer's atlas: a place it never saw is not here.
import { gap } from './nav.ts';
import type { BodyState, Experience, Place } from './types.ts';

const AREA = 48;
const MIN_MINUTES = 0.5;
const MAX_PLACES = 60;
const DEATH_PENALTY = 0.5;

export const areaOf = (p: { x: number; y: number; z: number }) => `${Math.floor(p.x / AREA)}:${Math.floor(p.y / AREA)}:${p.z}`;

/** Experience per hour measured here; 0 until there is something to measure. */
export const expPerHour = (p: Place) => (p.minutes >= MIN_MINUTES ? Math.round((p.exp / p.minutes) * 60) : 0);

export function ensurePlace(exp: Experience, at: { x: number; y: number; z: number }, name: string, why: Place['why'], nowMs: number): Place {
  const id = `${why === 'hunt' ? 'h' : why}:${areaOf(at)}`;
  const known = exp.places[id];
  if (known) return known;
  const place: Place = { id, name, why, doing: '', x: at.x, y: at.y, z: at.z, monsters: [], visits: 0, minutes: 0, exp: 0, gold: 0, kills: 0, deaths: 0, lastAt: nowMs };
  exp.places[id] = place;
  const ids = Object.values(exp.places).sort((a, b) => b.lastAt - a.lastAt).map((p) => p.id);
  for (const old of ids.slice(MAX_PLACES)) delete exp.places[old];
  return place;
}

/** What one stay taught: time, experience, money, kills. A stay too short says nothing. */
export function recordStay(place: Place, stay: { minutes: number; exp: number; gold: number; kills: number; monsters: Iterable<string> }, nowMs: number): boolean {
  if (stay.minutes < MIN_MINUTES) return false;
  place.visits++;
  place.minutes += stay.minutes;
  place.exp += Math.max(0, stay.exp);
  place.gold += stay.gold;
  place.kills += stay.kills;
  place.monsters = [...new Set([...stay.monsters, ...place.monsters])].slice(0, 5);
  place.lastAt = nowMs;
  return true;
}

/** Worth going back to: earnings pulled down by how often it killed this character. */
export function spotValue(p: Place): number {
  return expPerHour(p) * (1 / (1 + p.deaths * DEATH_PENALTY));
}

/** Places worth returning to, best first; where it stands now does not count. */
export function bestSpots(exp: Experience, s: BodyState, count: number): Place[] {
  return Object.values(exp.places)
    .filter((p) => p.why === 'hunt' && p.kills > 0 && expPerHour(p) > 0 && !(p.z === s.z && gap(p, s) <= AREA))
    .sort((a, b) => spotValue(b) - spotValue(a))
    .slice(0, count);
}

/** Short lines for the model: what this character knows from having been there. */
export function placeNotes(exp: Experience, limit: number): string {
  return Object.values(exp.places)
    .sort((a, b) => spotValue(b) - spotValue(a) || b.lastAt - a.lastAt)
    .slice(0, limit)
    .map((p) => {
      const money = p.minutes >= MIN_MINUTES ? Math.round((p.gold / p.minutes) * 60) : 0;
      const result = p.why === 'hunt' ? `, ${expPerHour(p)} exp/h, ${money} zlota/h, ${p.kills} zabitych${p.deaths ? `, ${p.deaths} razy tu zginales` : ''}` : '';
      return `- ${p.name}: ${p.doing}${p.monsters.length ? ` (${p.monsters.join(', ')})` : ''}${result}, bylo ${p.visits}x`;
    })
    .join('\n');
}
