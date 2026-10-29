// Mailbox retention: archive directories (processed/, brain-processed/, quarantine/) would grow
// forever. Keep the newest N files per directory; files of the current world session are never
// removed (they guard command sequence numbers and are needed for debugging the live world).
import { readdirSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';

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
