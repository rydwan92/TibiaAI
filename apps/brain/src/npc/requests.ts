// Recognises what a player plainly asks for, deterministically. These are ordinary requests, kept
// apart from attempts to change an NPC's rules: nothing here grants anything. A model can propose
// an action, but only a request found in the player's own words can start one, and the engine then
// checks whether it is possible. Text is normalised to ASCII lower case first.
import type { TaskDefinition, TaskStep } from '../agents.ts';
import { normalise } from './retrieval.ts';

export interface PlaceAliases {
  aliases: string[];
}

const GUIDE_VERB = /\b(pokaz|zaprowadz|zabierz|doprowadz|odprowadz|poprowadz|prowadz|chodzmy|idzmy|pojdzmy|show|take|lead|guide|bring)\b/;
const NEGATED = /\b(nie (pokazuj|prowadz|zaprowadzaj|zabieraj|chce|idz)|don'?t|do not)\b/;
const GUIDE_CANCEL = /\b(jednak nie|zmienilem zdanie|zmienilam zdanie|nie chce juz|rezygnuje|nigdzie nie ide|nevermind|never mind)\b/;
const LESSON_END = /koniec lekcji|konczymy lekcje|skonczmy lekcje|end (of )?(the )?lesson|stop (the )?lesson/;
const LESSON_START = /(uczyc|nauk[aiey]|naucz mnie|lekcj[aeiy]|cwiczyc|cwiczenia)\b.*angielsk|angielsk\w*\b.*(lekcj|nauk|uczyc|cwicz)|zacznijmy lekcje|learn english|english lesson/;
const LEVEL = /\b(a1|a2|b1|b2|c1|c2)\b/;
const LANGUAGE_VERB = /\b(mow|mowmy|rozmawiaj|rozmawiajmy|odpowiadaj|pisz|speak|talk)\b/;

/**
 * The line without the NPC's name at its start ("Tolku, pokaz..."). It only says who is spoken to:
 * a model repeats it back, and a language tutor takes the Polish vocative for a mistake.
 */
export function withoutAddress(text: string, npcName: string, addressNames: string[] = []): string {
  const stem = npcName.toLowerCase().replace(/[aeiouy]$/, '');
  const forms = [...addressNames.map((n) => n.toLowerCase()), `${stem}[a-z]{0,3}`].join('|');
  const rest = text.trim().replace(new RegExp(`^(${forms})(?=[\\s,!:.]|$)[\\s,!:.]*`, 'i'), '');
  return rest || text.trim();
}

export interface TaskRequest {
  taskId: string;
  step: TaskStep;
}

/** The errand step this player can take at this NPC now. The state comes from the engine, not from speech. */
export function parseTaskRequest(text: string, agentKey: string, states: Record<string, number>, tasks: Record<string, TaskDefinition>): TaskRequest | null {
  const said = ` ${normalise(text).replace(/[^a-z0-9]+/g, ' ').trim()} `;
  for (const [taskId, task] of Object.entries(tasks)) {
    const step = task.steps.find((s) => s.at === agentKey && s.from === (states[taskId] ?? 0));
    if (step?.words.some((w) => said.includes(` ${w} `))) return { taskId, step };
  }
  return null;
}

/** The place a player asks to be led to, or null. "gdzie jest ..." is a question, not a request. */
export function parseGuideRequest(text: string, places: Record<string, PlaceAliases>): string | null {
  const said = normalise(text);
  if (!GUIDE_VERB.test(said) || NEGATED.test(said)) return null;
  const words = new Set(said.split(/[^a-z0-9]+/));
  for (const [id, place] of Object.entries(places)) {
    if (place.aliases.some((alias) => words.has(alias))) return id;
  }
  return null;
}

export function parseGuideCancel(text: string): boolean {
  return GUIDE_CANCEL.test(normalise(text));
}

export type LessonCommand = { kind: 'start' | 'end' | 'level'; level?: string };

export function parseLessonCommand(text: string): LessonCommand | null {
  const said = normalise(text);
  if (LESSON_END.test(said)) return { kind: 'end' };
  const level = said.match(LEVEL)?.[1]?.toUpperCase();
  if (LESSON_START.test(said)) return { kind: 'start', ...(level ? { level } : {}) };
  return level ? { kind: 'level', level } : null;
}

/** A lasting wish ("mow do mnie po angielsku"). "Powiedz to po angielsku" is a one-off and stays with the model. */
export function parseLanguagePreference(text: string): 'en' | 'pl' | null {
  const said = normalise(text);
  if (!LANGUAGE_VERB.test(said)) return null;
  if (/po angielsku|in english/.test(said)) return 'en';
  if (/po polsku|in polish/.test(said)) return 'pl';
  return null;
}
