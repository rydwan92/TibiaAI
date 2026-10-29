// Brain loop: events -> memory -> rules -> commands; results -> memory. Never blocks the game:
// the engine keeps its local controller and falls back when Brain is slow or absent.
import { randomUUID } from 'node:crypto';
import { parseEvent, parseResult, SCHEMA_VERSION, validateCommand, type CommandPayload, type Envelope, type EventPayload } from './contracts.ts';
import type { Mailbox } from './mailbox.ts';
import type { Memory } from './memory.ts';
import { decide, type Intent } from './rules.ts';

export type Logger = (kind: string, fields?: Record<string, unknown>) => void;

const MAX_EVENTS_PER_TICK = 20;
const MAX_RESULTS_PER_TICK = 50;
const COMMAND_TTL_MS = 5000;
const WORLD_STALE_MS = 10_000;
const EVENT_MAX_AGE_MS = 15_000; // older observations (e.g. queued while Brain was down) are stored, not acted on

interface Scheduled {
  dueAtMs: number;
  intent: Intent;
  event: Envelope<EventPayload>;
}

export class Brain {
  private worldSessionId: string | null = null;
  private scheduled: Scheduled[] = [];
  private lastHeartbeatMs = 0;
  private readonly mailbox: Mailbox;
  private readonly memory: Memory;
  private readonly log: Logger;
  private readonly now: () => number;
  readonly provider: string;

  constructor(mailbox: Mailbox, memory: Memory, log: Logger, now: () => number = Date.now, provider = 'rules') {
    this.mailbox = mailbox;
    this.memory = memory;
    this.log = log;
    this.now = now;
    this.provider = provider;
    memory.ensureAgent('ardan');
  }

  tick(): void {
    const nowMs = this.now();
    const world = this.mailbox.readWorld();
    if (world && nowMs - world.atMs <= WORLD_STALE_MS && world.worldSessionId !== this.worldSessionId) {
      this.worldSessionId = world.worldSessionId;
      this.memory.ensureSession(world.worldSessionId, nowMs);
      const expired = this.memory.expireOtherSessions(world.worldSessionId);
      this.scheduled = [];
      this.log('world_session_detected', { worldSessionId: world.worldSessionId, expiredCommands: expired });
    }

    if (nowMs - this.lastHeartbeatMs >= 1000) {
      try {
        this.mailbox.writeHeartbeat({
          atMs: nowMs,
          worldSessionId: this.worldSessionId,
          lastEventSeq: this.worldSessionId ? this.memory.lastEventSeq(this.worldSessionId) : 0,
          provider: this.provider,
        });
        this.lastHeartbeatMs = nowMs;
      } catch {
        // Lua may hold the file open for a moment; retry next tick.
      }
    }

    this.processEvents(nowMs);
    this.processResults(nowMs);
    this.flushScheduled(nowMs, world?.nextCommandSeq ?? 1, world?.agent?.planRevision ?? 0);
  }

  private processEvents(nowMs: number): void {
    for (const name of this.mailbox.list('events', 'evt').slice(0, MAX_EVENTS_PER_TICK)) {
      const read = this.mailbox.readJson(this.mailbox.path('events', name));
      const parsed = read.ok ? parseEvent(read.value) : { ok: false as const, error: read.error };
      if (!parsed.ok) {
        this.log('event_rejected', { file: name, error: parsed.error });
        this.mailbox.archive('events', name, true);
        continue;
      }
      const ev = parsed.value;
      const current = ev.worldSessionId === this.worldSessionId;
      const stale = !current || (ev.sequence ?? 0) <= this.memory.lastEventSeq(ev.worldSessionId) ||
        nowMs - ev.createdAtMs > EVENT_MAX_AGE_MS;
      this.memory.ensureSession(ev.worldSessionId, nowMs);
      const encounterBefore = ev.payload.type === 'player_greeted'
        ? this.memory.encounterStats(ev.agentKey, ev.payload.playerGuid) : undefined;
      const inserted = this.memory.tx(() => {
        const ok = this.memory.recordObservation(ev, stale ? 'stale' : 'processed', nowMs);
        if (ok && ev.payload.type === 'player_greeted') {
          this.memory.recordEncounter(ev.agentKey, ev.payload.playerGuid, ev.payload.playerName, ev.messageId, ev.worldSessionId, ev.createdAtMs);
        }
        return ok;
      });
      this.mailbox.archive('events', name);
      if (!inserted) {
        this.log('event_duplicate', { eventId: ev.messageId });
        continue;
      }
      this.log('event_received', { eventId: ev.messageId, type: ev.payload.type, sequence: ev.sequence, stale });
      if (stale) continue; // remembered, but no action for old sessions/observations

      const intents = decide(ev, {
        encounterBefore,
        alarmsThisSession: this.memory.countObservations(ev.worldSessionId, 'training_alarm_started'),
        nowMs,
      });
      for (const intent of intents) this.scheduled.push({ dueAtMs: nowMs + intent.delayMs, intent, event: ev });
    }
  }

  private processResults(nowMs: number): void {
    for (const name of this.mailbox.list('results', 'res').slice(0, MAX_RESULTS_PER_TICK)) {
      const read = this.mailbox.readJson(this.mailbox.path('results', name));
      const parsed = read.ok ? parseResult(read.value) : { ok: false as const, error: read.error };
      if (!parsed.ok) {
        this.log('result_rejected', { file: name, error: parsed.error });
        this.mailbox.archive('results', name, true);
        continue;
      }
      const r = parsed.value;
      this.memory.applyResult(r, nowMs);
      this.mailbox.archive('results', name);
      this.log('result_received', { commandId: r.payload.commandId, status: r.payload.status, reasonCode: r.payload.reasonCode,
        duplicate: r.payload.duplicate ?? false, correlationId: r.correlationId });
    }
  }

  private flushScheduled(nowMs: number, worldNextSeq: number, planRevision: number): void {
    const due = this.scheduled.filter((s) => s.dueAtMs <= nowMs);
    this.scheduled = this.scheduled.filter((s) => s.dueAtMs > nowMs);
    for (const s of due) {
      if (s.event.worldSessionId !== this.worldSessionId) continue;
      this.sendCommand(s.event.worldSessionId, s.event.agentKey, s.event.messageId, 'say', { text: s.intent.text },
        worldNextSeq, nowMs, planRevision);
    }
  }

  sendCommand(session: string, agentKey: string, correlationId: string, action: CommandPayload['action'],
    args: Record<string, string>, worldNextSeq: number, nowMs: number, planRevision = 0): string | null {
    const env: Envelope<CommandPayload> = {
      schemaVersion: SCHEMA_VERSION,
      messageId: randomUUID(),
      kind: 'command',
      worldSessionId: session,
      agentKey,
      createdAtMs: nowMs,
      correlationId,
      payload: { commandId: randomUUID(), planRevision, expiresAtMs: nowMs + COMMAND_TTL_MS, action, args },
    };
    const valid = validateCommand(env, nowMs);
    if (!valid.ok) {
      this.log('command_refused_locally', { action, error: valid.error });
      return null;
    }
    let seq = Math.max(worldNextSeq, this.memory.maxCommandSeq(session) + 1);
    while (this.mailbox.commandSlotTaken(session, seq)) seq++;
    this.memory.insertCommand(env, seq);
    this.mailbox.writeCommand(env, seq);
    this.log('command_sent', { commandId: env.payload.commandId, seq, action, args, correlationId });
    return env.payload.commandId;
  }
}
