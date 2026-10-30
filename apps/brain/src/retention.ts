// Mailbox retention: archive directories (processed/, brain-processed/, quarantine/) would grow
// forever. Keep the newest N files per directory; files of the current world session are never
// removed (they guard command sequence numbers and are needed for debugging the live world).
import { readdirSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';

export const RETENTION_LIMITS: Record<string, number> = {
  processed: 2000,
  'brain-processed': 2000,
  quarantine: 200,
};

/** Returns the number of files removed from `dir`. */
export function pruneDirectory(dir: string, keep: number, protectedSession: string | null): number {
  const files = readdirSync(dir)
    .filter((name) => name.endsWith('.json'))
    .map((name) => ({ name, mtimeMs: statSync(join(dir, name)).mtimeMs }))
    .sort((a, b) => b.mtimeMs - a.mtimeMs || b.name.localeCompare(a.name));
  let removed = 0;
  for (const f of files.slice(keep)) {
    if (protectedSession && f.name.includes(`-${protectedSession}-`)) continue;
    rmSync(join(dir, f.name), { force: true });
    removed++;
  }
  return removed;
}

export function pruneMailbox(mailboxRoot: string, currentSession: string | null, limits = RETENTION_LIMITS): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [sub, keep] of Object.entries(limits)) out[sub] = pruneDirectory(join(mailboxRoot, sub), keep, currentSession);
  return out;
}

const DAY_MS = 86_400_000;

// observations and heard_statements hold raw player words, so they must not outlive the NPC detail
// window; commands keep the bot's own lines for debugging. Current-session rows are never removed.
export const DB_RETENTION_DAYS = { observations: 8, heardStatements: 8, commands: 30, closedCommitments: 90, relationshipLog: 180 };

/** Removes expired operational rows. Returns the number of rows removed per table. */
export function pruneDatabase(db: DatabaseSync, nowMs: number, currentSession: string | null, days = DB_RETENTION_DAYS): Record<string, number> {
  const before = (d: number) => nowMs - d * DAY_MS;
  const session = currentSession ?? '';
  const run = (sql: string, ...args: (number | string)[]) => Number(db.prepare(sql).run(...args).changes);
  return {
    observations: run('DELETE FROM observations WHERE received_at_ms < ? AND world_session_id <> ?', before(days.observations), session),
    heardStatements: run('DELETE FROM heard_statements WHERE observed_at_ms < ? AND world_session_id <> ?', before(days.heardStatements), session),
    actionResults: run(`DELETE FROM action_results WHERE received_at_ms < ?
      AND command_id IN (SELECT command_id FROM commands WHERE world_session_id <> ?)`, before(days.commands), session),
    commands: run(`DELETE FROM commands WHERE created_at_ms < ? AND world_session_id <> ?
      AND status NOT IN ('sent', 'accepted')`, before(days.commands), session),
    closedCommitments: run(`DELETE FROM npc_commitments WHERE status <> 'open' AND updated_at_ms < ?`, before(days.closedCommitments)),
    relationshipLog: run('DELETE FROM npc_relationship_log WHERE at_ms < ?', before(days.relationshipLog)),
  };
}
