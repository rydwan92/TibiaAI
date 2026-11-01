// A character's life with other people. Everyday detail fades through compression; what is here stays:
// moments that shaped a relationship, promises until they are kept or broken, a line for each week.
// It lives in the character's experience, so it survives restarts, compression and a change of model.
import type { Experience, MemoryStyle, Moment, Rumor, Vow } from './types.ts';

const MAX_MOMENTS = 8;
const MAX_VOWS = 8;
const MAX_WEEKS = 12;
const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;
const VOW_DAYS = 14;
const FADE_DAYS = 30; // a small thing from a month ago gives way to a new one, a big one does not
const MAX_RUMORS = 6;
const RUMOR_DAYS = 1;
const NEWSWORTHY = /zabil|zginal|zginel|wbil|poziom|bylem w|dotarl|kupil|napadl|uwazaj|polecam|smok|boss|najazd|inwazj|nowe miasto|statk/;

/** How strongly this character holds on to a kind of memory. */
export function weigh(style: MemoryStyle | undefined, topic: keyof MemoryStyle | undefined, importance: number): number {
  const by = topic ? style?.[topic] ?? 1 : 1;
  return Math.max(1, Math.min(10, Math.round(importance * by)));
}

export function addMoment(exp: Experience, person: string, text: string, weight: number, nowMs: number): void {
  const list = exp.moments[person] ?? [];
  if (list.some((m) => m.text === text)) return;
  const kept = (m: Moment) => m.weight - (nowMs - m.atMs) / (FADE_DAYS * DAY_MS);
  const all = [...list, { atMs: nowMs, text: text.slice(0, 140), weight }];
  exp.moments[person] = all.sort((a, b) => kept(b) - kept(a)).slice(0, MAX_MOMENTS).sort((a, b) => a.atMs - b.atMs);
}

export function whenWords(atMs: number, nowMs: number): string {
  const ago = nowMs - atMs;
  if (ago < 2 * HOUR_MS) return 'przed chwila';
  if (ago < DAY_MS) return `${Math.round(ago / HOUR_MS)} godz. temu`;
  if (ago < 2 * DAY_MS) return 'wczoraj';
  if (ago < 14 * DAY_MS) return `${Math.round(ago / DAY_MS)} dni temu`;
  return `${Math.round(ago / (7 * DAY_MS))} tyg. temu`;
}

/** Lines for the model. Only what really happened to this character, with how long ago it was. */
export function momentNotes(exp: Experience, person: string, nowMs: number): string {
  return (exp.moments[person] ?? []).map((m) => `- ${whenWords(m.atMs, nowMs)}: ${m.text}`).join('\n');
}

export function addVow(exp: Experience, vow: Omit<Vow, 'id'>): Vow | null {
  const text = vow.text.trim().slice(0, 120);
  if (text.length < 5 || exp.vows.some((v) => v.person === vow.person && v.who === vow.who && v.text === text)) return null;
  const made = { ...vow, text, id: ++exp.vowSeq };
  exp.vows = [...exp.vows, made].slice(-MAX_VOWS);
  return made;
}

export function closeVow(exp: Experience, id: number): Vow | null {
  const vow = exp.vows.find((v) => v.id === id) ?? null;
  if (vow) exp.vows = exp.vows.filter((v) => v.id !== id);
  return vow;
}

/** Open promises, numbered as the model must name them. */
export function vowNotes(exp: Experience, nowMs: number, person?: string): string {
  return exp.vows.filter((v) => !person || v.person === person).map((v) => `${v.id}. ${v.who === 'me' ? `obiecales ${v.person}` : `${v.person} obiecal tobie`}: ${v.text} (${whenWords(v.atMs, nowMs)})`).join('\n');
}

/** A promise does not stay open forever: this many days on, it counts as broken. */
export function overdueVows(exp: Experience, nowMs: number): Vow[] {
  const late = exp.vows.filter((v) => nowMs - v.atMs > VOW_DAYS * DAY_MS);
  if (late.length > 0) exp.vows = exp.vows.filter((v) => !late.includes(v));
  return late;
}

/** Worth passing on? Plain words decide, so ordinary chat does not fill the character's head. */
export const isNews = (text: string) => NEWSWORTHY.test(text.toLowerCase());

export function addRumor(exp: Experience, rumor: Rumor): void {
  if (exp.rumors.some((r) => r.text === rumor.text)) return;
  exp.rumors = [...exp.rumors, { ...rumor, text: rumor.text.slice(0, 140) }].slice(-MAX_RUMORS);
}

/** What a character can bring up: its own stories first, then what it heard, marked as hearsay. */
export function topicsOf(exp: Experience, nowMs: number): string[] {
  const fresh = exp.rumors.filter((r) => nowMs - r.atMs < RUMOR_DAYS * DAY_MS);
  return [...exp.news.map((n) => `sam przezyles: ${n}`), ...fresh.map((r) => `${r.from === 'serwer' ? 'ogloszenie w grze' : `slyszales od ${r.from}, nie widziales tego sam`}: ${r.text}`)];
}

export const weekOf = (ms: number) => Math.floor((ms + 3 * DAY_MS) / (7 * DAY_MS)); // weeks start on Monday
export const weekStart = (week: number) => week * 7 * DAY_MS - 3 * DAY_MS;

export function addWeek(exp: Experience, week: number, text: string): void {
  exp.chronicle = [...exp.chronicle.filter((c) => c.week !== week), { week, text: text.slice(0, 280) }].slice(-MAX_WEEKS);
}

export function chronicleNotes(exp: Experience, limit: number): string {
  return exp.chronicle.slice(-limit).map((c) => `- ${c.text}`).join('\n');
}
