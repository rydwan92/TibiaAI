// What a character thinks of other people, built only from what happened between them. It lives in
// the character's experience, so it survives restarts and a change of model.
import type { Experience, Person } from './types.ts';

const MAX_OPINION = 5;
const MAX_PEOPLE = 40;

export function personOf(exp: Experience, name: string, nowMs: number): Person {
  const known = exp.people[name];
  if (known) return known;
  const others = Object.entries(exp.people);
  if (others.length >= MAX_PEOPLE) {
    const faintest = others.sort(([, a], [, b]) => Math.abs(a.opinion) + a.met - (Math.abs(b.opinion) + b.met) || a.lastAt - b.lastAt)[0];
    delete exp.people[faintest[0]];
  }
  const person: Person = { met: 0, together: 0, helped: 0, fights: 0, opinion: 0, lastAt: nowMs };
  exp.people[name] = person;
  return person;
}

export function changeOpinion(person: Person, by: number): void {
  person.opinion = Math.max(-MAX_OPINION, Math.min(MAX_OPINION, person.opinion + by));
}

const FEELING: [number, string][] = [[3, 'bardzo go lubisz'], [1, 'lubisz go'], [-1, 'jest ci obojetny'], [-3, 'nie lubisz go'], [-6, 'nie znosisz go']];

/** One line for the model. Empty for someone the character has nothing to say about. */
export function personNote(exp: Experience, name: string): string {
  const p = exp.people[name];
  if (!p || (p.met === 0 && p.together === 0 && p.fights === 0 && p.opinion === 0)) return '';
  const parts = [`spotkan ${p.met}`];
  if (p.together > 0) parts.push(`wspolnych wypraw ${p.together}`);
  if (p.helped > 0) parts.push(`pomogles mu ${p.helped}x`);
  if (p.fights > 0) parts.push(`walk miedzy wami ${p.fights}`);
  const feeling = FEELING.find(([min]) => p.opinion >= min)?.[1] ?? 'nie znosisz go';
  return `${name}: ${feeling} (${parts.join(', ')}).`;
}
