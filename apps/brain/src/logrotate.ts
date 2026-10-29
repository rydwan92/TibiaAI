// Size-based log rotation: renames <name><ext> to <name>.<UTC stamp><ext>. Old files are kept.
import { existsSync, renameSync, statSync } from 'node:fs';
import { extname } from 'node:path';

export const LOG_MAX_BYTES = 10 * 1024 * 1024;

const stamp = (d: Date) => d.toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);

/** Returns the rotated file name, or null when the file is missing or below the limit. */
export function rotateIfLarger(file: string, maxBytes = LOG_MAX_BYTES, now = new Date()): string | null {
  if (!existsSync(file) || statSync(file).size <= maxBytes) return null;
  const ext = extname(file);
  let target = `${file.slice(0, file.length - ext.length)}.${stamp(now)}${ext}`;
  for (let i = 1; existsSync(target); i++) target = `${file.slice(0, file.length - ext.length)}.${stamp(now)}-${i}${ext}`;
  renameSync(file, target);
  return target;
}
