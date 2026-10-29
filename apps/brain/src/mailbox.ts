// File mailbox shared with the Lua bridge (ADR 0002). Writes use tmp + rename in the same
// directory; Node's renameSync replaces an existing target on Windows (MoveFileEx semantics).
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { agentRegistry, parseWorldStatus, type CommandPayload, type Envelope, type WorldStatus } from './contracts.ts';

export const SUBDIRS = ['events', 'commands', 'results', 'processed', 'quarantine', 'brain-processed'] as const;

export const commandFileName = (session: string, seq: number) => `cmd-${session}-${String(seq).padStart(8, '0')}.json`;

export class Mailbox {
  readonly root: string;

  constructor(root: string) {
    this.root = root;
    for (const d of SUBDIRS) mkdirSync(join(root, d), { recursive: true });
  }

  readJson(path: string): { ok: true; value: unknown } | { ok: false; error: string } {
    try {
      if (statSync(path).size > agentRegistry().limits.maxFileBytes) return { ok: false, error: 'too_large' };
      return { ok: true, value: JSON.parse(readFileSync(path, 'utf8')) };
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    }
  }

  readWorld(): WorldStatus | null {
    const path = join(this.root, 'world.json');
    if (!existsSync(path)) return null; // Lua replaces it via remove+rename; absence is transient
    const res = this.readJson(path);
    return res.ok ? parseWorldStatus(res.value) : null;
  }

  /** Files of one kind ("evt" | "res") sorted by session and sequence (names are zero-padded). */
  list(sub: 'events' | 'results', prefix: 'evt' | 'res'): string[] {
    return readdirSync(join(this.root, sub)).filter((f) => f.startsWith(`${prefix}-`) && f.endsWith('.json')).sort();
  }

  path(sub: string, name: string): string {
    return join(this.root, sub, name);
  }

  archive(sub: 'events' | 'results', name: string, quarantine = false): void {
    renameSync(join(this.root, sub, name), join(this.root, quarantine ? 'quarantine' : 'brain-processed', name));
  }

  writeAtomic(path: string, content: string): void {
    const tmp = `${path}.tmp`;
    writeFileSync(tmp, content, 'utf8');
    renameSync(tmp, path);
  }

  commandSlotTaken(session: string, seq: number): boolean {
    const name = commandFileName(session, seq);
    return ['commands', 'processed', 'quarantine'].some((d) => existsSync(join(this.root, d, name)));
  }

  writeCommand(env: Envelope<CommandPayload>, seq: number): string {
    const name = commandFileName(env.worldSessionId, seq);
    this.writeAtomic(join(this.root, 'commands', name), JSON.stringify(env));
    return name;
  }

  writeHeartbeat(hb: { atMs: number; worldSessionId: string | null; lastEventSeq: number; provider: string }): void {
    this.writeAtomic(join(this.root, 'brain-heartbeat.json'), JSON.stringify(hb));
  }
}
