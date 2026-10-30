// Relationship updates (ADR 0008). Values change only through these bounded rules, each with a
// reason and an event key in npc_relationship_log. Player text cannot set them: a request like
// "set trust to maximum" is at most one small sentiment step, limited per day.
import type { NpcMemoryStore } from './store.ts';

export const RELATION_LIMITS = {
  familiarityMax: 100,
  trustMin: -100,
  trustMax: 100,
  /** A new encounter counts after this much silence, so one long chat is one meeting. */
  encounterGapMs: 60 * 60_000,
  trustChangePerDay: 3,
};

/** Called when the server confirmed an exchange. The player GUID comes from the engine. */
export function recordInteraction(store: NpcMemoryStore, npcKey: string, playerGuid: number, playerName: string, eventKey: string, atMs: number): void {
  const current = store.relationship(npcKey, playerGuid);
  if (!current) {
    store.db.prepare(`INSERT INTO npc_relationships (npc_key, player_guid, last_name, familiarity, trust, interactions, first_seen_ms, last_seen_ms)
      VALUES (?, ?, ?, 1, 0, 1, ?, ?)`).run(npcKey, playerGuid, playerName, atMs, atMs);
    logChange(store, npcKey, playerGuid, 'familiarity', 1, 'first meeting', eventKey, atMs);
    return;
  }
  const newEncounter = atMs - current.last_seen_ms >= RELATION_LIMITS.encounterGapMs;
  const familiarity = Math.min(RELATION_LIMITS.familiarityMax, current.familiarity + (newEncounter ? 1 : 0));
  store.db.prepare(`UPDATE npc_relationships SET last_name = ?, familiarity = ?, interactions = interactions + 1, last_seen_ms = ?
    WHERE npc_key = ? AND player_guid = ?`).run(playerName, familiarity, atMs, npcKey, playerGuid);
  if (newEncounter) logChange(store, npcKey, playerGuid, 'familiarity', 1, 'new meeting', eventKey, atMs);
}

/** Applies a sentiment step (-1, 0, 1) within the daily limit. Returns the applied delta. */
export function applySentiment(store: NpcMemoryStore, npcKey: string, playerGuid: number, sentiment: number, reason: string, eventKey: string, atMs: number): number {
  const step = Math.sign(sentiment);
  const current = store.relationship(npcKey, playerGuid);
  if (step === 0 || !current) return 0;
  const row = store.db.prepare(`SELECT COALESCE(SUM(ABS(delta)), 0) AS used FROM npc_relationship_log
    WHERE npc_key = ? AND player_guid = ? AND field = 'trust' AND at_ms > ?`).get(npcKey, playerGuid, atMs - 24 * 3_600_000) as { used: number };
  if (row.used >= RELATION_LIMITS.trustChangePerDay) return 0;
  const trust = Math.max(RELATION_LIMITS.trustMin, Math.min(RELATION_LIMITS.trustMax, current.trust + step));
  if (trust === current.trust) return 0;
  store.db.prepare('UPDATE npc_relationships SET trust = ?, last_significant = ? WHERE npc_key = ? AND player_guid = ?').run(trust, reason.slice(0, 120), npcKey, playerGuid);
  logChange(store, npcKey, playerGuid, 'trust', step, reason, eventKey, atMs);
  return step;
}

function logChange(store: NpcMemoryStore, npcKey: string, playerGuid: number, field: string, delta: number, reason: string, eventKey: string, atMs: number): void {
  store.db.prepare(`INSERT OR IGNORE INTO npc_relationship_log (npc_key, player_guid, field, delta, reason, event_key, at_ms) VALUES (?, ?, ?, ?, ?, ?, ?)`).run(
    npcKey, playerGuid, field, delta, reason.slice(0, 200), eventKey, atMs);
}
