// Per-NPC memory store (ADR 0008). Every read takes npc_key; private rows also require the speaker.
// Provenance is kept apart: source says how the NPC learned something, certainty how far it can be
// trusted. Nothing the model invents is stored as a confirmed fact.
import type { DatabaseSync } from 'node:sqlite';
import type { Memory } from '../memory.ts';

export type EventKind = 'said_by_player' | 'said_by_npc' | 'heard' | 'witnessed' | 'action_result';
export type Source = 'direct' | 'heard' | 'witnessed' | 'server_confirmed';
export type Certainty = 'confirmed' | 'claimed' | 'rumor';
export type Visibility = 'private' | 'public';

export interface NpcEventInput {
  eventKey: string;
  npcKey: string;
  kind: EventKind;
  subjectGuid: number | null;
  actorName: string;
  text: string;
  source: Source;
  certainty: Certainty;
  visibility: Visibility;
  importance: number;
  worldSessionId: string;
  realAtMs: number;
  worldMinutes?: number | null;
}

export interface NpcEventRow {
  id: number;
  npc_key: string;
  kind: EventKind;
  subject_guid: number | null;
  actor_name: string;
  text: string;
  source: Source;
  certainty: Certainty;
  visibility: Visibility;
  importance: number;
  real_at_ms: number;
}

export interface NpcMemoryRow {
  id: number;
  npc_key: string;
  subject_guid: number | null;
  kind: string;
  summary: string;
  participants_json: string;
  sources_json: string;
  certainty: Certainty;
  visibility: Visibility;
  importance: number;
  from_ms: number;
  to_ms: number;
}

export interface Relationship {
  npc_key: string;
  player_guid: number;
  last_name: string;
  familiarity: number;
  trust: number;
  interactions: number;
  first_seen_ms: number;
  last_seen_ms: number;
  last_significant: string | null;
}

export interface Commitment {
  id: number;
  who: 'npc' | 'player';
  text: string;
  status: string;
  created_at_ms: number;
}

export interface StoreLimits {
  /** Traffic cap per NPC and UTC day; above it only important rows are kept, and drops are counted. */
  maxEventsPerDay: number;
  keepAboveLimitImportance: number;
  duplicateWindowMs: number;
}

export const DEFAULT_STORE_LIMITS: StoreLimits = { maxEventsPerDay: 2000, keepAboveLimitImportance: 6, duplicateWindowMs: 10 * 60_000 };

export const dayOf = (ms: number) => new Date(ms).toISOString().slice(0, 10);

export class NpcMemoryStore {
  readonly db: DatabaseSync;
  private readonly memory: Memory;
  private readonly limits: StoreLimits;

  constructor(memory: Memory, limits: StoreLimits = DEFAULT_STORE_LIMITS) {
    this.memory = memory;
    this.db = memory.db;
    this.limits = limits;
  }

  tx<T>(fn: () => T): T {
    return this.memory.tx(fn);
  }

  /** Stores one perception. Returns false for duplicates, repeats and rows over the traffic limit. */
  addEvent(e: NpcEventInput): boolean {
    const day = dayOf(e.realAtMs);
    const repeat = this.db.prepare(`SELECT 1 FROM npc_events WHERE npc_key = ? AND kind = ? AND text = ?
      AND COALESCE(subject_guid, 0) = ? AND real_at_ms > ? LIMIT 1`).get(
      e.npcKey, e.kind, e.text, e.subjectGuid ?? 0, e.realAtMs - this.limits.duplicateWindowMs);
    if (repeat && e.kind !== 'said_by_player' && e.kind !== 'said_by_npc') return false;
    const stats = this.db.prepare('SELECT stored FROM npc_memory_stats WHERE npc_key = ? AND day = ?').get(e.npcKey, day) as { stored: number } | undefined;
    if ((stats?.stored ?? 0) >= this.limits.maxEventsPerDay && e.importance < this.limits.keepAboveLimitImportance) {
      this.bumpStats(e.npcKey, day, 0, 1);
      return false;
    }
    const res = this.db.prepare(`INSERT OR IGNORE INTO npc_events (event_key, npc_key, kind, subject_guid, actor_name, text, source, certainty,
      visibility, importance, world_session_id, real_at_ms, world_minutes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      e.eventKey, e.npcKey, e.kind, e.subjectGuid, e.actorName, e.text, e.source, e.certainty, e.visibility, e.importance,
      e.worldSessionId, e.realAtMs, e.worldMinutes ?? null);
    if (res.changes === 0) return false;
    this.bumpStats(e.npcKey, day, 1, 0);
    return true;
  }

  private bumpStats(npcKey: string, day: string, stored: number, dropped: number): void {
    this.db.prepare(`INSERT INTO npc_memory_stats (npc_key, day, stored, dropped) VALUES (?, ?, ?, ?)
      ON CONFLICT (npc_key, day) DO UPDATE SET stored = stored + ?, dropped = dropped + ?`).run(npcKey, day, stored, dropped, stored, dropped);
  }

  /** Last turns of the conversation between this NPC and this player only, oldest first. */
  recentTurns(npcKey: string, playerGuid: number, limit: number): NpcEventRow[] {
    const rows = this.db.prepare(`SELECT * FROM npc_events WHERE npc_key = ? AND subject_guid = ? AND kind IN ('said_by_player', 'said_by_npc')
      ORDER BY real_at_ms DESC, id DESC LIMIT ?`).all(npcKey, playerGuid, limit) as unknown as NpcEventRow[];
    return rows.reverse();
  }

  /** Candidate events: private rows about this player, plus what this NPC perceived publicly. */
  visibleEvents(npcKey: string, playerGuid: number, limit: number): NpcEventRow[] {
    return this.db.prepare(`SELECT * FROM npc_events WHERE npc_key = ? AND (subject_guid = ? OR visibility = 'public')
      ORDER BY real_at_ms DESC, id DESC LIMIT ?`).all(npcKey, playerGuid, limit) as unknown as NpcEventRow[];
  }

  visibleMemories(npcKey: string, playerGuid: number, limit: number): NpcMemoryRow[] {
    return this.db.prepare(`SELECT * FROM npc_memories WHERE npc_key = ? AND (subject_guid = ? OR visibility = 'public')
      ORDER BY importance DESC, to_ms DESC LIMIT ?`).all(npcKey, playerGuid, limit) as unknown as NpcMemoryRow[];
  }

  relationship(npcKey: string, playerGuid: number): Relationship | undefined {
    return this.db.prepare('SELECT * FROM npc_relationships WHERE npc_key = ? AND player_guid = ?').get(npcKey, playerGuid) as Relationship | undefined;
  }

  facts(npcKey: string, playerGuid: number): { fact_key: string; value: string; certainty: Certainty }[] {
    return this.db.prepare('SELECT fact_key, value, certainty FROM npc_player_facts WHERE npc_key = ? AND player_guid = ? ORDER BY at_ms').all(npcKey, playerGuid) as never;
  }

  /** Something the player said about themselves: always a claim, never a confirmed fact. */
  setClaim(npcKey: string, playerGuid: number, factKey: string, value: string, eventKey: string, atMs: number): void {
    this.db.prepare(`INSERT INTO npc_player_facts (npc_key, player_guid, fact_key, value, certainty, event_key, at_ms) VALUES (?, ?, ?, ?, 'claimed', ?, ?)
      ON CONFLICT (npc_key, player_guid, fact_key) DO UPDATE SET value = excluded.value, event_key = excluded.event_key, at_ms = excluded.at_ms`).run(
      npcKey, playerGuid, factKey, value, eventKey, atMs);
  }

  prefs(npcKey: string, playerGuid: number): Record<string, string> {
    const rows = this.db.prepare('SELECT pref_key, value FROM npc_player_prefs WHERE npc_key = ? AND player_guid = ?').all(npcKey, playerGuid) as { pref_key: string; value: string }[];
    return Object.fromEntries(rows.map((r) => [r.pref_key, r.value]));
  }

  setPref(npcKey: string, playerGuid: number, key: string, value: string, atMs: number): void {
    this.db.prepare(`INSERT INTO npc_player_prefs (npc_key, player_guid, pref_key, value, updated_at_ms) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT (npc_key, player_guid, pref_key) DO UPDATE SET value = excluded.value, updated_at_ms = excluded.updated_at_ms`).run(npcKey, playerGuid, key, value, atMs);
  }

  openCommitments(npcKey: string, playerGuid: number): Commitment[] {
    return this.db.prepare(`SELECT id, who, text, status, created_at_ms FROM npc_commitments WHERE npc_key = ? AND player_guid = ? AND status = 'open'
      ORDER BY created_at_ms`).all(npcKey, playerGuid) as unknown as Commitment[];
  }

  addCommitment(npcKey: string, playerGuid: number, who: 'npc' | 'player', text: string, eventKey: string, atMs: number): void {
    this.db.prepare(`INSERT OR IGNORE INTO npc_commitments (npc_key, player_guid, who, text, status, event_key, created_at_ms, updated_at_ms)
      VALUES (?, ?, ?, ?, 'open', ?, ?, ?)`).run(npcKey, playerGuid, who, text, eventKey, atMs, atMs);
  }

  stats(): { npc_key: string; events: number; memories: number; open_commitments: number; relationships: number }[] {
    return this.db.prepare(`SELECT a.agent_key AS npc_key,
      (SELECT COUNT(*) FROM npc_events e WHERE e.npc_key = a.agent_key) AS events,
      (SELECT COUNT(*) FROM npc_memories m WHERE m.npc_key = a.agent_key) AS memories,
      (SELECT COUNT(*) FROM npc_commitments c WHERE c.npc_key = a.agent_key AND c.status = 'open') AS open_commitments,
      (SELECT COUNT(*) FROM npc_relationships r WHERE r.npc_key = a.agent_key) AS relationships
      FROM agents a ORDER BY a.agent_key`).all() as never;
  }
}
