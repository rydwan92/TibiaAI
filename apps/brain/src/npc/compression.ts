// Background memory compression (ADR 0008). Runs outside conversations and the game loop.
// A batch is one NPC + one subject + one closed UTC day older than the retention window. The
// summary is produced first, then stored and its details deleted in one transaction, so a crash or
// a model error loses nothing and a retry cannot duplicate (UNIQUE batch_id). Semantic compression
// is lossy by design: exact wording of old conversations is forgotten. Relationships, player facts
// and open commitments live in their own tables and are not touched.
// One summary covers rows of one visibility and one trust level, so a private line never surfaces in
// a public memory and a rumour never becomes confirmed by sitting next to a fact.
import type { ModelClient } from '../providers/local-model.ts';
import type { NpcEventRow, NpcMemoryRow, NpcMemoryStore } from './store.ts';

export const PROCESS_VERSION = 1;

export interface CompressionConfig {
  retentionMs: number;
  /** A character may hold days in detail longer than the common window (its `memory.detailDays`). */
  retentionByNpc?: Record<string, number>;
  maxBatchesPerRun: number;
  maxAttempts: number;
  /** Long-term limits per NPC. Above them the least important old memories are merged or forgotten. */
  maxMemoriesPerSubject: number;
  maxMemoriesPerNpc: number;
  forgetBelowImportance: number;
  keepImportanceAtLeast: number;
}

export const DEFAULT_COMPRESSION: CompressionConfig = {
  retentionMs: 7 * 24 * 3_600_000,
  maxBatchesPerRun: 5,
  maxAttempts: 3,
  maxMemoriesPerSubject: 12,
  maxMemoriesPerNpc: 200,
  forgetBelowImportance: 3,
  keepImportanceAtLeast: 7,
};

export interface Summary {
  summary: string;
  importance: number;
}

export interface Summarizer {
  summarize(npcKey: string, events: NpcEventRow[]): Promise<Summary>;
}

const DAY_MS = 86_400_000;
/** What one model call reads. Only rows it read may be deleted. */
export const MAX_BATCH_EVENTS = 40;
const MAX_SUMMARY_CHARS = 400;
const utcDayStart = (ms: number) => Math.floor(ms / DAY_MS) * DAY_MS;

/** Writes one short episode with the local model. Invalid output fails the batch and keeps the details. */
export class ModelSummarizer implements Summarizer {
  private readonly client: ModelClient;

  constructor(client: ModelClient) {
    this.client = client;
  }

  async summarize(npcKey: string, events: NpcEventRow[]): Promise<Summary> {
    const lines = events.map((e) => `${e.kind === 'said_by_npc' || e.actor_name === 'ty' ? npcKey : e.actor_name} (${e.source}, ${e.certainty}): ${e.text}`.slice(0, 200));
    const r = await this.client.chat([
      { role: 'system', content: `Streszczasz wspomnienia postaci ${npcKey} w jednym lub dwoch zdaniach po polsku, w trzeciej osobie. Zachowaj kto bral udzial, co sie stalo i co jest niepewne (twierdzenie, plotka). Nie zgaduj i nie dodawaj niczego spoza zapisu. Kazda linia zaczyna sie od imienia osoby, ktora mowi lub dziala. Zwroc JSON z polami summary (tekst) i importance (1-10).` },
      { role: 'user', content: lines.join('\n') },
    ], {
      schema: { type: 'object', properties: { summary: { type: 'string' }, importance: { type: 'integer' } }, required: ['summary', 'importance'] },
      timeoutMs: 60_000, maxTokens: 160, purpose: 'compress',
    });
    return parseSummary(r.text);
  }
}

export function parseSummary(raw: string): Summary {
  const v = JSON.parse(raw) as { summary?: unknown; importance?: unknown };
  if (typeof v.summary !== 'string' || v.summary.trim().length < 10) throw new Error('invalid summary');
  const importance = typeof v.importance === 'number' ? Math.min(10, Math.max(1, Math.round(v.importance))) : 4;
  return { summary: v.summary.trim().slice(0, MAX_SUMMARY_CHARS), importance };
}

interface Candidate {
  npc_key: string;
  subject: number;
  day_start: number;
}

export interface CompressionReport {
  batches: number;
  compressed: number;
  failed: number;
  deletedEvents: number;
  forgotten: number;
  merged: number;
}

/** An NPC's own line is only what it said, however certain the saying was. */
const trustOf = (e: NpcEventRow): string => (e.kind === 'said_by_npc' ? 'claimed' : e.certainty);
const groupOf = (e: NpcEventRow): string => `${e.visibility}|${trustOf(e)}`;

export class MemoryCompressor {
  private readonly store: NpcMemoryStore;
  private readonly summarizer: Summarizer;
  private readonly cfg: CompressionConfig;
  private readonly now: () => number;
  private running = false;

  constructor(store: NpcMemoryStore, summarizer: Summarizer, cfg: CompressionConfig = DEFAULT_COMPRESSION, now: () => number = Date.now) {
    this.store = store;
    this.summarizer = summarizer;
    this.cfg = cfg;
    this.now = now;
  }

  /** One pass. Never throws: failures stay recorded on their batch for a later retry. */
  async run(): Promise<CompressionReport> {
    const report: CompressionReport = { batches: 0, compressed: 0, failed: 0, deletedEvents: 0, forgotten: 0, merged: 0 };
    if (this.running) return report;
    this.running = true;
    try {
      const cutoff = (ms: number) => utcDayStart(this.now() - ms); // only whole closed days
      const own = Object.entries(this.cfg.retentionByNpc ?? {});
      const limitByNpc = own.length > 0 ? `CASE e.npc_key ${own.map(() => 'WHEN ? THEN ?').join(' ')} ELSE ? END` : '?';
      const candidates = this.store.db.prepare(`SELECT npc_key, COALESCE(subject_guid, 0) AS subject,
        (real_at_ms / ${DAY_MS}) * ${DAY_MS} AS day_start FROM npc_events e WHERE real_at_ms < ${limitByNpc}
        AND NOT EXISTS (SELECT 1 FROM npc_memory_batches b WHERE b.npc_key = e.npc_key AND b.subject_guid = COALESCE(e.subject_guid, 0)
          AND b.from_ms = (e.real_at_ms / ${DAY_MS}) * ${DAY_MS} AND b.process_version = ? AND b.status = 'failed' AND b.attempts >= ?)
        GROUP BY 1, 2, 3 ORDER BY day_start LIMIT ?`)
        .all(...own.flatMap(([key, ms]) => [key, cutoff(ms)]), cutoff(this.cfg.retentionMs), PROCESS_VERSION, this.cfg.maxAttempts, this.cfg.maxBatchesPerRun) as unknown as Candidate[];
      for (const c of candidates) {
        // A busy day takes several passes: each reads a limited group and deletes only that.
        const lastId = Math.max(0, ...this.eventsOf(c).map((e) => e.id)); // rows arriving now wait for the next run
        let more = true;
        while (more && report.batches < this.cfg.maxBatchesPerRun) {
          report.batches++;
          const ok = await this.compressBatch(c, report);
          if (ok) report.compressed++;
          else report.failed++;
          more = ok && this.eventsOf(c).some((e) => e.id <= lastId);
        }
      }
      this.enforceLimits(report);
    } finally {
      this.running = false;
    }
    return report;
  }

  private eventsOf(c: Candidate): NpcEventRow[] {
    return this.store.db.prepare(`SELECT * FROM npc_events WHERE npc_key = ? AND COALESCE(subject_guid, 0) = ? AND real_at_ms >= ? AND real_at_ms < ? ORDER BY real_at_ms, id`)
      .all(c.npc_key, c.subject, c.day_start, c.day_start + DAY_MS) as unknown as NpcEventRow[];
  }

  private async compressBatch(c: Candidate, report: CompressionReport): Promise<boolean> {
    const db = this.store.db;
    const fromMs = c.day_start;
    const toMs = c.day_start + DAY_MS;
    db.prepare(`INSERT OR IGNORE INTO npc_memory_batches (npc_key, subject_guid, from_ms, to_ms, process_version, status, updated_at_ms)
      VALUES (?, ?, ?, ?, ?, 'pending', ?)`).run(c.npc_key, c.subject, fromMs, toMs, PROCESS_VERSION, this.now());
    const batch = db.prepare(`SELECT id, attempts FROM npc_memory_batches WHERE npc_key = ? AND subject_guid = ? AND from_ms = ? AND to_ms = ? AND process_version = ?`)
      .get(c.npc_key, c.subject, fromMs, toMs, PROCESS_VERSION) as { id: number; attempts: number };
    const day = this.eventsOf(c);
    if (day.length === 0) return true;
    const events = day.filter((e) => groupOf(e) === groupOf(day[0])).slice(0, MAX_BATCH_EVENTS);
    try {
      const summary = await this.summarizer.summarize(c.npc_key, events);
      const participants = [...new Set(events.map((e) => e.actor_name))];
      const sources = [...new Set(events.map((e) => e.source))];
      const certainty = trustOf(events[0]);
      const importance = Math.max(summary.importance, ...events.map((e) => e.importance));
      const visibility = events[0].visibility;
      const ids = events.map((e) => e.id);
      this.store.tx(() => {
        // Rows that arrived after the first pass extend its memory; they never replace it.
        const earlier = db.prepare('SELECT * FROM npc_memories WHERE batch_id = ?').get(batch.id) as NpcMemoryRow | undefined;
        const extended = earlier ? `${earlier.summary} ${summary.summary}` : '';
        if (earlier && earlier.certainty === certainty && earlier.visibility === visibility && extended.length <= MAX_SUMMARY_CHARS) {
          db.prepare(`UPDATE npc_memories SET summary = ?, participants_json = ?, sources_json = ?, importance = ?, to_ms = ? WHERE id = ?`).run(
            extended,
            JSON.stringify([...new Set([...JSON.parse(earlier.participants_json) as string[], ...participants])]),
            JSON.stringify([...new Set([...JSON.parse(earlier.sources_json) as string[], ...sources])]),
            Math.max(earlier.importance, importance), Math.max(earlier.to_ms, events[events.length - 1].real_at_ms), earlier.id);
        } else {
          db.prepare(`INSERT INTO npc_memories (npc_key, subject_guid, kind, summary, participants_json, sources_json, certainty, visibility,
            importance, from_ms, to_ms, batch_id, process_version, created_at_ms) VALUES (?, ?, 'episode', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
            c.npc_key, c.subject === 0 ? null : c.subject, summary.summary, JSON.stringify(participants), JSON.stringify(sources), certainty, visibility,
            importance, events[0].real_at_ms, events[events.length - 1].real_at_ms, earlier ? null : batch.id, PROCESS_VERSION, this.now());
        }
        // Only the rows that were summarised: anything written meanwhile stays for the next pass.
        const placeholders = ids.map(() => '?').join(',');
        db.prepare(`DELETE FROM npc_events WHERE id IN (${placeholders})`).run(...ids);
        db.prepare(`UPDATE npc_memory_batches SET status = 'done', last_error = NULL, updated_at_ms = ? WHERE id = ?`).run(this.now(), batch.id);
      });
      report.deletedEvents += ids.length;
      return true;
    } catch (err) {
      db.prepare(`UPDATE npc_memory_batches SET status = 'failed', attempts = attempts + 1, last_error = ?, updated_at_ms = ? WHERE id = ?`)
        .run((err as Error).message.slice(0, 200), this.now(), batch.id);
      return false;
    }
  }

  /** Long-term ceiling: merge the oldest low-value episodes per subject, then forget the least important. */
  private enforceLimits(report: CompressionReport): void {
    const db = this.store.db;
    const crowded = db.prepare(`SELECT npc_key, COALESCE(subject_guid, 0) AS subject, COUNT(*) AS n FROM npc_memories GROUP BY 1, 2 HAVING n > ?`)
      .all(this.cfg.maxMemoriesPerSubject) as { npc_key: string; subject: number; n: number }[];
    for (const c of crowded) {
      const oldest = db.prepare(`SELECT * FROM npc_memories WHERE npc_key = ? AND COALESCE(subject_guid, 0) = ? AND importance < ? ORDER BY to_ms LIMIT ?`)
        .all(c.npc_key, c.subject, this.cfg.keepImportanceAtLeast, c.n - this.cfg.maxMemoriesPerSubject + 1) as unknown as NpcMemoryRow[];
      const sameKind = new Map<string, NpcMemoryRow[]>();
      for (const r of oldest) sameKind.set(`${r.visibility}|${r.certainty}`, [...(sameKind.get(`${r.visibility}|${r.certainty}`) ?? []), r]);
      for (const rows of sameKind.values()) {
        if (rows.length < 2) continue;
        this.store.tx(() => {
          const union = (field: 'participants_json' | 'sources_json') => JSON.stringify([...new Set(rows.flatMap((r) => JSON.parse(r[field]) as string[]))]);
          const text = rows.map((r) => r.summary).join(' ').slice(0, MAX_SUMMARY_CHARS);
          db.prepare(`DELETE FROM npc_memories WHERE id IN (${rows.map(() => '?').join(',')})`).run(...rows.map((r) => r.id));
          db.prepare(`INSERT INTO npc_memories (npc_key, subject_guid, kind, summary, participants_json, sources_json, certainty, visibility, importance,
            from_ms, to_ms, batch_id, process_version, created_at_ms) VALUES (?, ?, 'merged', ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)`).run(
            c.npc_key, c.subject === 0 ? null : c.subject, text, union('participants_json'), union('sources_json'), rows[0].certainty, rows[0].visibility,
            Math.max(...rows.map((r) => r.importance)), rows[0].from_ms, rows[rows.length - 1].to_ms, PROCESS_VERSION, this.now());
        });
        report.merged += rows.length;
      }
    }
    const totals = db.prepare('SELECT npc_key, COUNT(*) AS n FROM npc_memories GROUP BY npc_key HAVING n > ?').all(this.cfg.maxMemoriesPerNpc) as { npc_key: string; n: number }[];
    for (const t of totals) {
      const res = db.prepare(`DELETE FROM npc_memories WHERE id IN (SELECT id FROM npc_memories WHERE npc_key = ? AND importance < ? ORDER BY importance, to_ms LIMIT ?)`)
        .run(t.npc_key, this.cfg.keepImportanceAtLeast, t.n - this.cfg.maxMemoriesPerNpc);
      report.forgotten += Number(res.changes);
    }
    const res = db.prepare(`DELETE FROM npc_memories WHERE importance < ? AND to_ms < ?`).run(this.cfg.forgetBelowImportance, this.now() - 30 * DAY_MS);
    report.forgotten += Number(res.changes);
  }
}
