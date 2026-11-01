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
  {
    // ADR 0008: per-NPC memory. Recent detail, older memories, relationships, commitments.
    version: 3,
    sql: `
      ALTER TABLE commands ADD COLUMN plan_json TEXT;
      ALTER TABLE commands ADD COLUMN plan_applied INTEGER NOT NULL DEFAULT 0;
      CREATE TABLE npc_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        event_key TEXT NOT NULL UNIQUE,
        npc_key TEXT NOT NULL,
        kind TEXT NOT NULL,
        subject_guid INTEGER,
        actor_name TEXT NOT NULL,
        text TEXT NOT NULL,
        source TEXT NOT NULL,
        certainty TEXT NOT NULL,
        visibility TEXT NOT NULL,
        importance INTEGER NOT NULL,
        world_session_id TEXT NOT NULL,
        real_at_ms INTEGER NOT NULL,
        world_minutes INTEGER,
        batch_id INTEGER
      );
      CREATE INDEX npc_events_time ON npc_events(npc_key, real_at_ms);
      CREATE INDEX npc_events_subject ON npc_events(npc_key, subject_guid, real_at_ms);
      CREATE TABLE npc_memory_batches (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        npc_key TEXT NOT NULL,
        subject_guid INTEGER NOT NULL,
        from_ms INTEGER NOT NULL,
        to_ms INTEGER NOT NULL,
        process_version INTEGER NOT NULL,
        status TEXT NOT NULL,
        attempts INTEGER NOT NULL DEFAULT 0,
        last_error TEXT,
        updated_at_ms INTEGER NOT NULL,
        UNIQUE (npc_key, subject_guid, from_ms, to_ms, process_version)
      );
      CREATE TABLE npc_memories (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        npc_key TEXT NOT NULL,
        subject_guid INTEGER,
        kind TEXT NOT NULL,
        summary TEXT NOT NULL,
        participants_json TEXT NOT NULL,
        sources_json TEXT NOT NULL,
        certainty TEXT NOT NULL,
        visibility TEXT NOT NULL,
        importance INTEGER NOT NULL,
        from_ms INTEGER NOT NULL,
        to_ms INTEGER NOT NULL,
        batch_id INTEGER UNIQUE,
        process_version INTEGER NOT NULL,
        created_at_ms INTEGER NOT NULL
      );
      CREATE INDEX npc_memories_npc ON npc_memories(npc_key, subject_guid);
      CREATE TABLE npc_relationships (
        npc_key TEXT NOT NULL,
        player_guid INTEGER NOT NULL,
        last_name TEXT NOT NULL,
        familiarity INTEGER NOT NULL DEFAULT 0,
        trust INTEGER NOT NULL DEFAULT 0,
        interactions INTEGER NOT NULL DEFAULT 0,
        first_seen_ms INTEGER NOT NULL,
        last_seen_ms INTEGER NOT NULL,
        last_significant TEXT,
        PRIMARY KEY (npc_key, player_guid)
      );
      CREATE TABLE npc_relationship_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        npc_key TEXT NOT NULL,
        player_guid INTEGER NOT NULL,
        field TEXT NOT NULL,
        delta INTEGER NOT NULL,
        reason TEXT NOT NULL,
        event_key TEXT NOT NULL,
        at_ms INTEGER NOT NULL,
        UNIQUE (event_key, field)
      );
      CREATE TABLE npc_player_facts (
        npc_key TEXT NOT NULL,
        player_guid INTEGER NOT NULL,
        fact_key TEXT NOT NULL,
        value TEXT NOT NULL,
        certainty TEXT NOT NULL,
        event_key TEXT NOT NULL,
        at_ms INTEGER NOT NULL,
        PRIMARY KEY (npc_key, player_guid, fact_key)
      );
      CREATE TABLE npc_commitments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        npc_key TEXT NOT NULL,
        player_guid INTEGER NOT NULL,
        who TEXT NOT NULL,
        text TEXT NOT NULL,
        status TEXT NOT NULL,
        event_key TEXT NOT NULL UNIQUE,
        created_at_ms INTEGER NOT NULL,
        updated_at_ms INTEGER NOT NULL
      );
      CREATE INDEX npc_commitments_open ON npc_commitments(npc_key, player_guid, status);
      CREATE TABLE npc_memory_stats (
        npc_key TEXT NOT NULL,
        day TEXT NOT NULL,
        stored INTEGER NOT NULL DEFAULT 0,
        dropped INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (npc_key, day)
      );`,
  },
  {
    // ADR 0009: what a player chose with one NPC (language, lesson level). Settings, not memories:
    // they are never compressed and never shared with another NPC.
    version: 4,
    sql: `
      CREATE TABLE npc_player_prefs (
        npc_key TEXT NOT NULL,
        player_guid INTEGER NOT NULL,
        pref_key TEXT NOT NULL,
        value TEXT NOT NULL,
        updated_at_ms INTEGER NOT NULL,
        PRIMARY KEY (npc_key, player_guid, pref_key)
      );`,
  },
  {
    // ADR 0011: every cloud model call with its reported cost. Budgets are read from here.
    version: 5,
    sql: `
      CREATE TABLE model_usage (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        at_ms INTEGER NOT NULL,
        agent_key TEXT NOT NULL,
        model TEXT NOT NULL,
        effort TEXT NOT NULL,
        purpose TEXT NOT NULL,
        input_tokens INTEGER NOT NULL,
        output_tokens INTEGER NOT NULL,
        cache_read_tokens INTEGER NOT NULL,
        credits REAL NOT NULL,
        estimated INTEGER NOT NULL,
        duration_ms INTEGER NOT NULL,
        ok INTEGER NOT NULL,
        error TEXT NOT NULL
      );
      CREATE INDEX model_usage_time ON model_usage(at_ms);`,
  },
  {
    // A person's own notes for the helper, apart from everything the world remembers.
    version: 6,
    sql: `
      CREATE TABLE assistant_notes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        owner TEXT NOT NULL,
        text TEXT NOT NULL,
        created_at_ms INTEGER NOT NULL,
        due_at_ms INTEGER,
        done INTEGER NOT NULL
      );
      CREATE INDEX assistant_notes_owner ON assistant_notes(owner, done);`,
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
  private inTx = false;
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

  /** Joins a transaction already open, so effects and their marker can commit together. */
  tx<T>(fn: () => T): T {
    if (this.inTx) return fn();
    this.db.exec('BEGIN IMMEDIATE');
    this.inTx = true;
    try {
      const out = fn();
      this.db.exec('COMMIT');
      return out;
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    } finally {
      this.inTx = false;
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

  insertCommand(env: Envelope<CommandPayload>, seq: number, plan?: unknown): void {
    const p = env.payload;
    this.db.prepare(`INSERT INTO commands (command_id, world_session_id, seq, agent_key, action, args_json, correlation_id,
      plan_revision, created_at_ms, expires_at_ms, status, plan_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'sent', ?)`).run(
      p.commandId, env.worldSessionId, seq, env.agentKey, p.action, JSON.stringify(p.args), env.correlationId,
      p.planRevision, env.createdAtMs, p.expiresAtMs, plan === undefined ? null : JSON.stringify(plan));
  }

  /** A command's stored plan until its effects are marked applied; duplicates get nothing. */
  pendingPlan(commandId: string, status: string): { text: string; plan: unknown } | null {
    if (status === 'accepted') return null;
    const row = this.db.prepare('SELECT args_json, plan_json, plan_applied FROM commands WHERE command_id = ?').get(commandId) as
      { args_json: string; plan_json: string | null; plan_applied: number } | undefined;
    if (!row?.plan_json || row.plan_applied) return null;
    return { text: (JSON.parse(row.args_json) as { text: string }).text, plan: JSON.parse(row.plan_json) };
  }

  /** Call in the transaction that writes the plan's effects, so a crash leaves both or neither. */
  markPlanApplied(commandId: string): void {
    this.db.prepare('UPDATE commands SET plan_applied = 1 WHERE command_id = ?').run(commandId);
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
