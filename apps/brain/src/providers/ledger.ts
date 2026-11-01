// What every cloud model call cost, kept in SQLite so that a restart cannot reset a budget.
import type { DatabaseSync } from 'node:sqlite';

export interface UsageRow {
  atMs: number;
  agentKey: string;
  model: string;
  effort: string;
  purpose: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  credits: number;
  /** The call ended before the service reported its cost; credits is then the reserve. */
  estimated: boolean;
  durationMs: number;
  ok: boolean;
  error: string;
}

export interface UsageSummary {
  agentKey: string;
  model: string;
  effort: string;
  calls: number;
  failed: number;
  inputTokens: number;
  outputTokens: number;
  credits: number;
  avgMs: number;
  maxMs: number;
}

export function dayStartMs(nowMs: number): number {
  const d = new Date(nowMs);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

export function monthStartMs(nowMs: number): number {
  const d = new Date(nowMs);
  d.setDate(1);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

export class CreditLedger {
  private readonly db: DatabaseSync;

  constructor(db: DatabaseSync) {
    this.db = db;
  }

  record(row: UsageRow): void {
    this.db.prepare(`INSERT INTO model_usage (at_ms, agent_key, model, effort, purpose, input_tokens, output_tokens, cache_read_tokens, credits, estimated, duration_ms, ok, error)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(row.atMs, row.agentKey, row.model, row.effort, row.purpose, row.inputTokens, row.outputTokens, row.cacheReadTokens, row.credits, row.estimated ? 1 : 0, row.durationMs, row.ok ? 1 : 0, row.error);
  }

  spentSince(ms: number): number {
    const row = this.db.prepare('SELECT COALESCE(SUM(credits), 0) AS spent FROM model_usage WHERE at_ms >= ?').get(ms) as { spent: number };
    return row.spent;
  }

  summary(sinceMs: number): UsageSummary[] {
    return this.db.prepare(`SELECT agent_key AS agentKey, model, effort, COUNT(*) AS calls, SUM(1 - ok) AS failed, SUM(input_tokens) AS inputTokens, SUM(output_tokens) AS outputTokens,
        SUM(credits) AS credits, ROUND(AVG(duration_ms)) AS avgMs, MAX(duration_ms) AS maxMs
      FROM model_usage WHERE at_ms >= ? GROUP BY agent_key, model, effort ORDER BY credits DESC`).all(sinceMs) as unknown as UsageSummary[];
  }

  byPurpose(sinceMs: number): { purpose: string; calls: number; credits: number; good: number }[] {
    return this.db.prepare(`SELECT purpose, COUNT(*) AS calls, SUM(credits) AS credits, SUM(ok) AS good
      FROM model_usage WHERE at_ms >= ? GROUP BY purpose ORDER BY credits DESC`).all(sinceMs) as unknown as { purpose: string; calls: number; credits: number; good: number }[];
  }
}
