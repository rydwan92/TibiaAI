// SQLite memory (node:sqlite). Brain never touches game tables; only this file.
// Facts come from engine events (playerGuid from the world), never from chat text claims.
import { DatabaseSync } from 'node:sqlite';
import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { CommandPayload, Envelope, EventPayload, ResultPayload } from './contracts.ts';

const MIGRATIONS: { version: number; sql: string }[] = [
  {
    version: 1,
    sql: `
      CREATE TABLE agents (agent_key TEXT PRIMARY KEY, created_at TEXT NOT NULL);
      CREATE TABLE world_sessions (
        world_session_id TEXT PRIMARY KEY,
        first_seen_at_ms INTEGER NOT NULL,
        last_event_seq INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE observations (
        event_id TEXT PRIMARY KEY,
        world_session_id TEXT NOT NULL,
        agent_key TEXT NOT NULL,
        sequence INTEGER NOT NULL,
        type TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        source TEXT NOT NULL,
        observed_at_ms INTEGER NOT NULL,
        received_at_ms INTEGER NOT NULL,
        expires_at_ms INTEGER,
        status TEXT NOT NULL
      );
      CREATE TABLE encounters (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        agent_key TEXT NOT NULL,
        player_guid INTEGER NOT NULL,
        player_name TEXT NOT NULL,
        event_id TEXT NOT NULL UNIQUE,
        world_session_id TEXT NOT NULL,
        observed_at_ms INTEGER NOT NULL
      );
      CREATE INDEX encounters_agent_player ON encounters(agent_key, player_guid);
      CREATE TABLE commands (
        command_id TEXT PRIMARY KEY,
        world_session_id TEXT NOT NULL,
        seq INTEGER NOT NULL,
        agent_key TEXT NOT NULL,
        action TEXT NOT NULL,
        args_json TEXT NOT NULL,
        correlation_id TEXT NOT NULL,
        plan_revision INTEGER NOT NULL,
        created_at_ms INTEGER NOT NULL,
        expires_at_ms INTEGER NOT NULL,
        status TEXT NOT NULL,
        reason_code TEXT,
        UNIQUE (world_session_id, seq)
      );
      CREATE TABLE action_results (
        message_id TEXT PRIMARY KEY,
        command_id TEXT NOT NULL,
        status TEXT NOT NULL,
        reason_code TEXT NOT NULL,
        duplicate INTEGER NOT NULL,
        payload_json TEXT NOT NULL,
        received_at_ms INTEGER NOT NULL
      );`,
  },
  {
    // ADR 0005: what an agent heard another agent say. A relation with provenance, not a world fact.
    version: 2,
    sql: `
      CREATE TABLE heard_statements (
        event_id TEXT PRIMARY KEY,
        listener_key TEXT NOT NULL,
        speaker_key TEXT NOT NULL,
        text TEXT NOT NULL,
        yelled INTEGER NOT NULL,
        distance INTEGER NOT NULL,
        world_session_id TEXT NOT NULL,
        observed_at_ms INTEGER NOT NULL
      );
      CREATE INDEX heard_listener_time ON heard_statements(listener_key, observed_at_ms);`,
  },
];

export interface HeardStatement {
  speakerKey: string;
  text: string;
  yelled: boolean;
  atMs: number;
}

export interface EncounterStats {
  count: number;
  lastAtMs: number | null;
}

export class Memory {
  readonly db: DatabaseSync;
  readonly file: string;

  constructor(file: string) {
    this.file = file;
    if (file !== ':memory:') mkdirSync(dirname(file), { recursive: true });
    const existed = file !== ':memory:' && existsSync(file);
    this.db = new DatabaseSync(file);
    this.db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
    this.migrate(existed);
  }

  private migrate(existed: boolean): void {
    this.db.exec('CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)');
    const row = this.db.prepare('SELECT COALESCE(MAX(version), 0) AS v FROM schema_migrations').get() as { v: number };
    const pending = MIGRATIONS.filter((m) => m.version > row.v);
    if (pending.length === 0) return;
    if (existed) {
      // Copy before migrating; the copy stays next to the database (runtime/, git-ignored).
      this.db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
      copyFileSync(this.file, `${this.file}.bak-v${row.v}-${Date.now()}`);
    }
    for (const m of pending) {
      this.tx(() => {
        this.db.exec(m.sql);
        this.db.prepare('INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)').run(m.version, new Date().toISOString());
      });
    }
  }

  tx<T>(fn: () => T): T {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const out = fn();
      this.db.exec('COMMIT');
      return out;
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }
  }

  close(): void {
    this.db.close();
  }

  ensureAgent(agentKey: string): void {
    this.db.prepare('INSERT OR IGNORE INTO agents (agent_key, created_at) VALUES (?, ?)').run(agentKey, new Date().toISOString());
  }

  ensureSession(worldSessionId: string, nowMs: number): void {
    this.db.prepare('INSERT OR IGNORE INTO world_sessions (world_session_id, first_seen_at_ms) VALUES (?, ?)').run(worldSessionId, nowMs);
  }

  lastEventSeq(worldSessionId: string): number {
    const row = this.db.prepare('SELECT last_event_seq AS s FROM world_sessions WHERE world_session_id = ?').get(worldSessionId) as { s: number } | undefined;
    return row?.s ?? 0;
  }

  /** Records an observation; returns false when the eventId was already stored (duplicate). */
  recordObservation(env: Envelope<EventPayload>, status: string, nowMs: number): boolean {
    const res = this.db.prepare(`INSERT OR IGNORE INTO observations
      (event_id, world_session_id, agent_key, sequence, type, payload_json, source, observed_at_ms, received_at_ms, status)
      VALUES (?, ?, ?, ?, ?, ?, 'engine', ?, ?, ?)`).run(
      env.messageId, env.worldSessionId, env.agentKey, env.sequence ?? 0, env.payload.type,
      JSON.stringify(env.payload), env.createdAtMs, nowMs, status);
    if (res.changes === 0) return false;
    this.db.prepare('UPDATE world_sessions SET last_event_seq = MAX(last_event_seq, ?) WHERE world_session_id = ?').run(env.sequence ?? 0, env.worldSessionId);
    return true;
  }

  encounterStats(agentKey: string, playerGuid: number): EncounterStats {
    const row = this.db.prepare(`SELECT COUNT(*) AS c, MAX(observed_at_ms) AS last FROM encounters
      WHERE agent_key = ? AND player_guid = ?`).get(agentKey, playerGuid) as { c: number; last: number | null };
    return { count: row.c, lastAtMs: row.last };
  }

  recordEncounter(agentKey: string, playerGuid: number, playerName: string, eventId: string, worldSessionId: string, observedAtMs: number): void {
    this.db.prepare(`INSERT OR IGNORE INTO encounters (agent_key, player_guid, player_name, event_id, world_session_id, observed_at_ms)
      VALUES (?, ?, ?, ?, ?, ?)`).run(agentKey, playerGuid, playerName, eventId, worldSessionId, observedAtMs);
  }

  recordHeard(eventId: string, listenerKey: string, speakerKey: string, text: string, yelled: boolean, distance: number,
    worldSessionId: string, observedAtMs: number): void {
    this.db.prepare(`INSERT OR IGNORE INTO heard_statements
      (event_id, listener_key, speaker_key, text, yelled, distance, world_session_id, observed_at_ms) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(
      eventId, listenerKey, speakerKey, text, yelled ? 1 : 0, distance, worldSessionId, observedAtMs);
  }

  /** Most recent statement the listener heard at or after sinceMs (any speaker). */
  latestHeard(listenerKey: string, sinceMs: number): HeardStatement | undefined {
    const row = this.db.prepare(`SELECT speaker_key, text, yelled, observed_at_ms FROM heard_statements
      WHERE listener_key = ? AND observed_at_ms >= ? ORDER BY observed_at_ms DESC, rowid DESC LIMIT 1`).get(listenerKey, sinceMs) as
      { speaker_key: string; text: string; yelled: number; observed_at_ms: number } | undefined;
    return row && { speakerKey: row.speaker_key, text: row.text, yelled: row.yelled === 1, atMs: row.observed_at_ms };
  }

  countObservations(worldSessionId: string, type: string, agentKey?: string): number {
    const row = (agentKey
      ? this.db.prepare('SELECT COUNT(*) AS c FROM observations WHERE world_session_id = ? AND type = ? AND agent_key = ?').get(worldSessionId, type, agentKey)
      : this.db.prepare('SELECT COUNT(*) AS c FROM observations WHERE world_session_id = ? AND type = ?').get(worldSessionId, type)) as { c: number };
    return row.c;
  }

  maxCommandSeq(worldSessionId: string): number {
    const row = this.db.prepare('SELECT COALESCE(MAX(seq), 0) AS s FROM commands WHERE world_session_id = ?').get(worldSessionId) as { s: number };
    return row.s;
  }

  insertCommand(env: Envelope<CommandPayload>, seq: number): void {
    const p = env.payload;
    this.db.prepare(`INSERT INTO commands (command_id, world_session_id, seq, agent_key, action, args_json, correlation_id,
      plan_revision, created_at_ms, expires_at_ms, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'sent')`).run(
      p.commandId, env.worldSessionId, seq, env.agentKey, p.action, JSON.stringify(p.args), env.correlationId,
      p.planRevision, env.createdAtMs, p.expiresAtMs);
  }

  /** Stores an engine result. Success is recorded only from engine results, never assumed. */
  applyResult(env: Envelope<ResultPayload>, nowMs: number): boolean {
    const p = env.payload;
    const res = this.db.prepare(`INSERT OR IGNORE INTO action_results
      (message_id, command_id, status, reason_code, duplicate, payload_json, received_at_ms) VALUES (?, ?, ?, ?, ?, ?, ?)`).run(
      env.messageId, p.commandId, p.status, p.reasonCode, p.duplicate ? 1 : 0, JSON.stringify(p), nowMs);
    if (res.changes === 0) return false;
    if (!p.duplicate) {
      this.db.prepare('UPDATE commands SET status = ?, reason_code = ? WHERE command_id = ?').run(p.status, p.reasonCode, p.commandId);
    }
    return true;
  }

  /** Commands of ended world sessions can never run (Lua only reads its own session's files). */
  expireOtherSessions(currentSessionId: string): number {
    const res = this.db.prepare(`UPDATE commands SET status = 'expired', reason_code = 'world_session_ended'
      WHERE world_session_id <> ? AND status IN ('sent', 'accepted')`).run(currentSessionId);
    return Number(res.changes);
  }

  commandStatus(commandId: string): { status: string; reason_code: string | null } | undefined {
    return this.db.prepare('SELECT status, reason_code FROM commands WHERE command_id = ?').get(commandId) as
      { status: string; reason_code: string | null } | undefined;
  }
}
