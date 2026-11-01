// Reads what a body wrote to events.jsonl, each record once. The cursor stands right after the last
// finished line, so a half-written record is simply read again next time; it is only ever moved past
// whole records. A file is known by its first bytes: a truncated or replaced one is read from the
// start, and a rotated one first gives up what was left unread. The mind saves the cursor together
// with its state, so after a restart the same records are applied to the same state.
import { closeSync, existsSync, openSync, readSync, statSync } from 'node:fs';
import type { BodyEvent } from './types.ts';

const HEAD_BYTES = 64;
const MAX_READ_BYTES = 256 * 1024;
const NEWLINE = 0x0a;

export interface EventCursor {
  offset: number;
  /** The file's first bytes, hex: how a new file is told from the old one. */
  head: string;
  session: string;
  seq: number;
  /** In the middle of a line too long to hold; the rest of it is skipped. */
  skipping: boolean;
}

function readAt(path: string, offset: number, length: number): Buffer {
  const fd = openSync(path, 'r');
  try {
    const buffer = Buffer.alloc(length);
    return buffer.subarray(0, readSync(fd, buffer, 0, length, offset));
  } finally {
    closeSync(fd);
  }
}

const sameStart = (a: string, b: string) => a.startsWith(b) || b.startsWith(a);

export class EventReader {
  private readonly path: string;
  private readonly rotated: string;
  private readonly onBadRecord: (reason: string) => void;
  cursor: EventCursor;

  /** Without a saved cursor reading starts at the end: what happened before is already known. */
  constructor(path: string, saved: EventCursor | null, onBadRecord: (reason: string) => void = () => {}) {
    this.path = path;
    this.rotated = `${path}.1`;
    this.onBadRecord = onBadRecord;
    this.cursor = saved ?? { offset: this.size(path), head: this.headOf(path), session: '', seq: 0, skipping: false };
  }

  private size(path: string): number {
    return existsSync(path) ? statSync(path).size : 0;
  }

  private headOf(path: string): string {
    return existsSync(path) ? readAt(path, 0, HEAD_BYTES).toString('hex') : '';
  }

  private isDuplicate(ev: BodyEvent): boolean {
    if (ev.session === undefined || ev.seq === undefined) return false;
    if (ev.session === this.cursor.session && ev.seq <= this.cursor.seq) return true;
    this.cursor.session = ev.session;
    this.cursor.seq = ev.seq;
    return false;
  }

  /** Whole records from `offset`; moves the cursor past exactly what it returns. */
  private drain(path: string): BodyEvent[] {
    const events: BodyEvent[] = [];
    const size = this.size(path);
    while (this.cursor.offset < size) {
      const chunk = readAt(path, this.cursor.offset, Math.min(MAX_READ_BYTES, size - this.cursor.offset));
      const end = chunk.lastIndexOf(NEWLINE);
      if (end < 0) {
        if (chunk.length < MAX_READ_BYTES) break; // the rest of the line is still being written
        this.cursor.offset += chunk.length;
        if (!this.cursor.skipping) this.onBadRecord('record too long');
        this.cursor.skipping = true;
        continue;
      }
      const lines = chunk.subarray(0, end).toString('utf8').split('\n');
      if (this.cursor.skipping) {
        lines.shift();
        this.cursor.skipping = false;
      }
      for (const line of lines) {
        if (!line) continue;
        try {
          const ev = JSON.parse(line) as BodyEvent;
          if (!this.isDuplicate(ev)) events.push(ev);
        } catch {
          this.onBadRecord(line.slice(0, 80));
        }
      }
      this.cursor.offset += end + 1;
      if (events.length > 0) break; // one bounded read per call; the rest waits for the next tick
    }
    return events;
  }

  read(): BodyEvent[] {
    const events: BodyEvent[] = [];
    const size = this.size(this.path);
    const head = this.headOf(this.path);
    if (size < this.cursor.offset || !sameStart(head, this.cursor.head)) {
      // The tail of a rotated file may still hold records that were never read.
      if (sameStart(this.headOf(this.rotated), this.cursor.head) && this.size(this.rotated) > this.cursor.offset) events.push(...this.drain(this.rotated));
      this.cursor.offset = 0;
      this.cursor.skipping = false;
    }
    this.cursor.head = head;
    events.push(...this.drain(this.path));
    return events;
  }
}
