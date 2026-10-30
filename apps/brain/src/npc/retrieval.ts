// Memory retrieval behind an interface, so embeddings can replace text matching later without
// touching the context builder. Candidates are limited by npc_key and the speaker in SQL first;
// scoring only orders rows the NPC may use, so text similarity cannot leak someone else's memory.
import type { Certainty, NpcMemoryStore, Source } from './store.ts';

export interface MemoryQuery {
  npcKey: string;
  playerGuid: number;
  text: string;
  nowMs: number;
  limit: number;
  excludeEventIds: Set<number>;
}

export interface RetrievedMemory {
  ref: string;
  text: string;
  source: Source | 'memory';
  certainty: Certainty;
  atMs: number;
  ageHours: number;
  score: number;
}

export interface MemoryRetriever {
  retrieve(query: MemoryQuery): RetrievedMemory[];
}

const STOP = new Set(['oraz', 'jest', 'sie', 'czy', 'jak', 'tak', 'nie', 'ale', 'dla', 'przy', 'tego', 'tam', 'tutaj', 'tylko', 'jestem', 'mam', 'masz', 'twoje', 'moje']);

export const normalise = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ł/g, 'l');

export function tokens(text: string): Set<string> {
  return new Set(normalise(text).split(/[^a-z0-9]+/).filter((t) => t.length >= 3 && !STOP.has(t)));
}

/** Prefix match, so Polish inflection ("woz", "wozie") still counts. */
function overlap(a: Set<string>, b: Set<string>): number {
  let n = 0;
  for (const x of a) {
    for (const y of b) {
      if (x === y || (x.length >= 4 && y.length >= 4 && (x.startsWith(y.slice(0, 4)) || y.startsWith(x.slice(0, 4))))) {
        n++;
        break;
      }
    }
  }
  return n;
}

export class TextMemoryRetriever implements MemoryRetriever {
  private readonly store: NpcMemoryStore;

  constructor(store: NpcMemoryStore) {
    this.store = store;
  }

  retrieve(q: MemoryQuery): RetrievedMemory[] {
    const words = tokens(q.text);
    const age = (atMs: number) => Math.max(0, q.nowMs - atMs) / 3_600_000;
    const score = (text: string, importance: number, atMs: number) => overlap(words, tokens(text)) * 4 + importance + Math.max(0, 3 - age(atMs) / 24);
    const events: RetrievedMemory[] = this.store.visibleEvents(q.npcKey, q.playerGuid, 80)
      .filter((e) => !q.excludeEventIds.has(e.id) && e.kind !== 'said_by_npc')
      .map((e) => ({ ref: `event:${e.id}`, text: e.source === 'witnessed' ? e.text : `${e.actor_name}: ${e.text}`, source: e.source, certainty: e.certainty, atMs: e.real_at_ms, ageHours: age(e.real_at_ms), score: score(e.text, e.importance, e.real_at_ms) }));
    const memories: RetrievedMemory[] = this.store.visibleMemories(q.npcKey, q.playerGuid, 40)
      .map((m) => ({ ref: `memory:${m.id}`, text: m.summary, source: 'memory', certainty: m.certainty, atMs: m.to_ms, ageHours: age(m.to_ms), score: score(m.summary, m.importance, m.to_ms) }));
    return [...events, ...memories].sort((a, b) => b.score - a.score || b.atMs - a.atMs).slice(0, q.limit);
  }
}
