// Why a character wants what it wants right now. People do not weigh options evenly: temperament, how
// the last hours went and what is missing pull them somewhere. The model gets this in words and stays
// free to do otherwise.
import type { BodyState, Experience, PlayerDef, Strategy, Trial } from './types.ts';

const SLOW_EXP = 0.5; // this share of its best pace and it feels it is getting nowhere
const RICH = 2000;
const FRUSTRATED_AT = 3;
const MAX_TRIALS = 6;
const HOUR_MS = 3_600_000;

export interface Moment {
  money: number;
  perHour: number | null;
  bestPerHour: number;
  troubles: number;
}

export function pulls(def: PlayerDef, e: Experience, x: Moment): [string, number][] {
  const slow = x.perHour !== null && x.bestPerHour > 0 && x.perHour < x.bestPerHour * SLOW_EXP;
  const list: [string, number][] = [
    ['chcesz rosnac w sile', 0.4 + def.bravery * 0.3 + (slow ? 0.4 : 0)],
    ['chcesz zarobic i odlozyc pieniadze', def.greed * (x.money < RICH ? 1 : 0.4)],
    ['ciagnie cie w nowe miejsca', def.curiosity * 0.5 + e.boredom * 0.7],
    ['brakuje ci towarzystwa', def.sociability * e.loneliness * 1.2],
    ['wolisz nie ryzykowac', e.fear + x.troubles * 0.15],
  ];
  return list.sort((a, b) => b[1] - a[1]);
}

/** The strongest two pulls in words, and a word when things keep going wrong. */
export function pullNote(def: PlayerDef, e: Experience, x: Moment): string {
  const top = pulls(def, e, x).slice(0, 2).map(([what]) => what).join(', ');
  const worn = x.troubles >= FRUSTRATED_AT ? ' Ostatnio duzo rzeczy poszlo nie tak: moze czas zmienic podejscie.' : '';
  const slow = x.perHour !== null && x.bestPerHour > 0 && x.perHour < x.bestPerHour * SLOW_EXP ? ` Idzie ci wolniej niz potrafisz (najlepiej ${x.bestPerHour} exp/h).` : '';
  return `CO CIE TERAZ CIAGNIE: ${top}.${slow}${worn}`;
}

export function startStrategy(text: string, s: BodyState, money: number, deaths: number, atMs: number): Strategy {
  return { text: text.slice(0, 120), atMs, experience: s.experience, money, deaths };
}

/** What the game says came of a try: numbers, not the character's opinion. */
export function closeStrategy(e: Experience, s: BodyState, money: number, nowMs: number): void {
  const st = e.strategy;
  if (!st) return;
  const hours = Math.max((nowMs - st.atMs) / HOUR_MS, 0.05);
  const trial: Trial = { text: st.text, expPerHour: Math.round((s.experience - st.experience) / hours), moneyPerHour: Math.round((money - st.money) / hours), deaths: e.deaths - st.deaths };
  e.trials = [...e.trials, trial].slice(-MAX_TRIALS);
  e.strategy = null;
}

export function trialNotes(e: Experience): string {
  return e.trials.map((t) => `- ${t.text}: ${t.expPerHour} exp/h, ${t.moneyPerHour} zlota/h, zgonow ${t.deaths}`).join('\n');
}
