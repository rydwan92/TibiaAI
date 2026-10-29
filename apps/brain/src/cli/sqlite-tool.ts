// SQLite maintenance for backups (used by scripts/backup.ps1 and scripts/restore-test.ps1):
//   sqlite-tool.ts backup <source.sqlite> <dest.sqlite>   consistent copy (VACUUM INTO), prints row counts
//   sqlite-tool.ts check <file.sqlite>                     integrity_check + row counts
// Output: one JSON line { ok, integrity, tables: { name: rows } }.
import { existsSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

function counts(db: DatabaseSync): Record<string, number> {
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all() as { name: string }[];
  const out: Record<string, number> = {};
  for (const { name } of tables) out[name] = (db.prepare(`SELECT COUNT(*) AS c FROM "${name.replace(/"/g, '""')}"`).get() as { c: number }).c;
  return out;
}

function inspect(file: string): { ok: boolean; integrity: string; tables: Record<string, number> } {
  const db = new DatabaseSync(file, { readOnly: true });
  try {
    const integrity = (db.prepare('PRAGMA integrity_check').get() as { integrity_check: string }).integrity_check;
    return { ok: integrity === 'ok', integrity, tables: counts(db) };
  } finally {
    db.close();
  }
}

const [cmd, a, b] = process.argv.slice(2);
if (cmd === 'backup' && a && b) {
  if (!existsSync(a)) throw new Error(`source not found: ${a}`);
  if (existsSync(b)) throw new Error(`destination exists: ${b}`);
  const src = new DatabaseSync(a, { readOnly: true });
  try {
    src.prepare('VACUUM INTO ?').run(b);
  } finally {
    src.close();
  }
  console.log(JSON.stringify(inspect(b)));
} else if (cmd === 'check' && a) {
  console.log(JSON.stringify(inspect(a)));
} else {
  console.error('usage: sqlite-tool.ts backup <source> <dest> | check <file>');
  process.exit(2);
}
