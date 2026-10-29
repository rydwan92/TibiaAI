import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Envelope, EventPayload } from '../src/contracts.ts';

export function tempDir(): string {
  return mkdtempSync(join(tmpdir(), 'tibiaai-test-'));
}

let seq = 0;
export function makeEvent(session: string, payload: EventPayload, overrides: Partial<Envelope<EventPayload>> = {}): Envelope<EventPayload> {
  seq += 1;
  const id = `evt-${seq}-${Math.random().toString(16).slice(2)}`;
  return {
    schemaVersion: 1, messageId: id, kind: 'event', worldSessionId: session, agentKey: 'ardan',
    createdAtMs: Date.now(), correlationId: id, sequence: seq, payload, ...overrides,
  };
}

export function writeWorld(mailboxRoot: string, session: string, nextCommandSeq = 1): void {
  writeFileSync(join(mailboxRoot, 'world.json'), JSON.stringify({
    worldSessionId: session, startedAtMs: Date.now(), atMs: Date.now(), nextCommandSeq, lastEventSeq: 0,
    lastResultSeq: 0, brainOnline: false,
    agents: { ardan: { state: 'PATROL', alarmActive: false, planRevision: 0 }, mira: { state: 'HOME', alarmActive: false, planRevision: 0 } },
  }));
}

export function writeEvent(mailboxRoot: string, ev: Envelope<EventPayload>): void {
  const name = `evt-${ev.worldSessionId}-${String(ev.sequence).padStart(8, '0')}.json`;
  writeFileSync(join(mailboxRoot, 'events', name), JSON.stringify(ev));
}
