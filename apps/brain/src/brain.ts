// Brain loop: events -> memory -> rules -> commands; results -> memory. Never blocks the game:
// the engine keeps its local controller and falls back when Brain is slow or absent.
import { randomUUID } from 'node:crypto';
import {
  agentRegistry, parseEvent, parseResult, SCHEMA_VERSION, validateCommand,
  type CommandPayload, type Envelope, type EventPayload, type ResultPayload, type WorldStatus,
} from './contracts.ts';
import type { Mailbox } from './mailbox.ts';
import type { Memory } from './memory.ts';
import { applyConfirmedReply } from './npc/confirmed.ts';
import { taskDefinitions } from './agents.ts';
import type { DialoguePlan } from './npc/dialogue.ts';
import { extractClaims, isConversationTurn, perceive } from './npc/perception.ts';
import { applySentiment } from './npc/relations.ts';
import type { NpcMemoryStore } from './npc/store.ts';
import type { Intent, Provider } from './providers/provider.ts';
import { RulesProvider } from './providers/rules.ts';
import { pruneMailbox } from './retention.ts';

export type Logger = (kind: string, fields?: Record<string, unknown>) => void;

const MAX_EVENTS_PER_TICK = 20;
const MAX_RESULTS_PER_TICK = 50;
const COMMAND_TTL_MS = 5000;
const WORLD_STALE_MS = 10_000;
const EVENT_MAX_AGE_MS = 15_000; // older observations (e.g. queued while Brain was down) are stored, not acted on
const RETENTION_INTERVAL_MS = 10 * 60_000;
const RUMOR_MAX_AGE_MS = 10 * 60_000; // ADR 0005: only fresh statements are passed on
const DECISION_MAX_AGE_MS = 20_000; // a slow provider's answer older than this is dropped
const MAX_EFFECT_TRIES = 5;

interface Scheduled {
  dueAtMs: number;
  intent: Intent;
  event: Envelope<EventPayload>;
}

export class Brain {
  private worldSessionId: string | null = null;
  private scheduled: Scheduled[] = [];
  private lastHeartbeatMs = 0;
  private lastRetentionMs = 0;
  private readonly mailbox: Mailbox;
  private readonly memory: Memory;
  private readonly log: Logger;
  private readonly now: () => number;
  private provider: Provider;
  private readonly effectFailures = new Map<string, number>();
  private readonly npcStore: NpcMemoryStore | null;
  private latestWorld: WorldStatus | null = null;

  constructor(mailbox: Mailbox, memory: Memory, log: Logger, now: () => number = Date.now, provider: Provider = new RulesProvider(), npcStore: NpcMemoryStore | null = null) {
    this.mailbox = mailbox;
    this.memory = memory;
    this.log = log;
    this.now = now;
    this.provider = provider;
    this.npcStore = npcStore;
    for (const key of agentRegistry().keys()) memory.ensureAgent(key);
  }

  tick(): void {
    const nowMs = this.now();
    const world = this.mailbox.readWorld();
    if (world) this.latestWorld = world;
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
          provider: this.provider.name,
        });
        this.lastHeartbeatMs = nowMs;
      } catch {
        // Lua may hold the file open for a moment; retry next tick.
      }
    }

    this.processEvents(nowMs);
    this.processResults(nowMs);
    this.flushScheduled(this.now(), world);

    if (nowMs - this.lastRetentionMs >= RETENTION_INTERVAL_MS) {
      this.lastRetentionMs = nowMs;
      try {
        const removed = pruneMailbox(this.mailbox.root, this.worldSessionId);
        if (Object.values(removed).some((n) => n > 0)) this.log('mailbox_pruned', removed);
      } catch (err) {
        this.log('mailbox_prune_error', { error: (err as Error).message });
      }
    }
  }

  get currentWorldSession(): string | null {
    return this.worldSessionId;
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
        if (ok && ev.payload.type === 'agent_heard') {
          const h = ev.payload;
          this.memory.recordHeard(ev.messageId, ev.agentKey, h.speakerKey, h.text, h.yelled, h.distance, ev.worldSessionId, ev.createdAtMs);
        }
        if (ok) this.rememberPerception(ev);
        return ok;
      });
      this.mailbox.archive('events', name);
      if (!inserted) {
        this.log('event_duplicate', { eventId: ev.messageId });
        continue;
      }
      this.log('event_received', { eventId: ev.messageId, type: ev.payload.type, sequence: ev.sequence, stale });
      if (stale) continue; // remembered, but no action for old sessions/observations
      this.dropStaleContinuations(ev);

      const heard = ev.payload.type === 'player_greeted' ? this.memory.latestHeard(ev.agentKey, nowMs - RUMOR_MAX_AGE_MS) : undefined;
      const decided = this.provider.decide(ev, {
        agent: agentRegistry().get(ev.agentKey)!,
        encounterBefore,
        alarmsThisSession: this.memory.countObservations(ev.worldSessionId, 'training_alarm_started', ev.agentKey),
        alarmActive: this.latestWorld?.agents[ev.agentKey]?.alarmActive ?? false,
        guide: this.latestWorld?.agents[ev.agentKey]?.guide,
        latestHeard: heard && { ...heard, speakerName: agentRegistry().get(heard.speakerKey)?.npcName ?? heard.speakerKey },
        nowMs,
      });
      if (decided instanceof Promise) {
        decided.then((intents) => this.acceptIntents(ev, intents)).catch((err: Error) => {
          this.log('provider_failed', { eventId: ev.messageId, error: err.message });
        });
      } else {
        this.acceptIntents(ev, decided);
      }
    }
  }

  /** The second line of a reply is dropped once the player moved on or an alarm took over. */
  private dropStaleContinuations(ev: Envelope<EventPayload>): void {
    const p = ev.payload;
    const alarm = p.type === 'training_alarm_started';
    const newTurn = isConversationTurn(ev) && (p.type === 'player_greeted' || p.type === 'player_said');
    if (!alarm && !newTurn) return;
    this.scheduled = this.scheduled.filter((s) => !(s.intent.plan?.continuation && s.event.agentKey === ev.agentKey &&
      (alarm || (newTurn && s.intent.toPlayerGuid === (p as { playerGuid: number }).playerGuid))));
  }

  /** What this NPC perceived goes to its own memory, including claims the player made directly. */
  private rememberPerception(ev: Envelope<EventPayload>): void {
    if (!this.npcStore) return;
    const row = perceive(ev);
    if (row) this.npcStore.addEvent(row);
    const p = ev.payload;
    if (isConversationTurn(ev) && (p.type === 'player_greeted' || p.type === 'player_said')) {
      for (const c of extractClaims(p.text)) this.npcStore.setClaim(ev.agentKey, p.playerGuid, c.key, c.value, ev.messageId, ev.createdAtMs);
    }
    // Trust grows from what the engine confirmed, never from what was said about it.
    if (p.type === 'task_step_done') {
      const step = taskDefinitions()[p.taskId]?.steps.find((s) => s.id === p.stepId);
      if (step?.trust) applySentiment(this.npcStore, ev.agentKey, p.playerGuid, step.trust, `zlecenie: ${p.taskId}`, ev.messageId, ev.createdAtMs);
    }
  }

  private acceptIntents(ev: Envelope<EventPayload>, intents: Intent[]): void {
    const nowMs = this.now();
    if (ev.payload.type === 'agent_heard' && intents.length > 0) {
      // Loop guard for any provider (ADR 0005): agent speech never triggers agent speech.
      this.log('intents_blocked_loop_guard', { eventId: ev.messageId, count: intents.length });
      return;
    }
    if (intents.length > 0 && (ev.worldSessionId !== this.worldSessionId || nowMs - ev.createdAtMs > DECISION_MAX_AGE_MS)) {
      this.log('decision_stale', { eventId: ev.messageId, ageMs: nowMs - ev.createdAtMs });
      return;
    }
    for (const intent of intents) this.scheduled.push({ dueAtMs: nowMs + intent.delayMs, intent, event: ev });
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
      try {
        this.applyReplyEffects(r, nowMs);
      } catch (err) {
        // The file stays, so the next tick retries; the effects were rolled back as a whole.
        const tries = (this.effectFailures.get(name) ?? 0) + 1;
        this.effectFailures.set(name, tries);
        this.log('reply_effects_failed', { commandId: r.payload.commandId, tries, error: (err as Error).message });
        if (tries < MAX_EFFECT_TRIES) continue;
        this.mailbox.archive('results', name, true);
        this.effectFailures.delete(name);
        continue;
      }
      this.mailbox.archive('results', name);
      this.log('result_received', { commandId: r.payload.commandId, status: r.payload.status, reasonCode: r.payload.reasonCode,
        duplicate: r.payload.duplicate ?? false, correlationId: r.correlationId });
    }
  }

  /** Speech counts as said only when the engine reports it, and its effects apply exactly once. */
  private applyReplyEffects(r: Envelope<ResultPayload>, nowMs: number): void {
    if (!this.npcStore || r.payload.duplicate) return;
    const row = this.memory.pendingPlan(r.payload.commandId, r.payload.status);
    if (!row) return;
    const store = this.npcStore;
    this.memory.tx(() => {
      if (r.payload.status === 'completed') {
        applyConfirmedReply(store, {
          commandId: r.payload.commandId, npcKey: r.agentKey, text: row.text, worldSessionId: r.worldSessionId, atMs: nowMs, plan: row.plan as DialoguePlan,
        });
      }
      this.memory.markPlanApplied(r.payload.commandId);
    });
    if (r.payload.status !== 'completed') {
      this.log('reply_not_delivered', { commandId: r.payload.commandId, status: r.payload.status, reasonCode: r.payload.reasonCode });
    }
  }

  private flushScheduled(nowMs: number, world: WorldStatus | null): void {
    const due = this.scheduled.filter((s) => s.dueAtMs <= nowMs);
    this.scheduled = this.scheduled.filter((s) => s.dueAtMs > nowMs);
    for (const s of due) {
      if (s.event.worldSessionId !== this.worldSessionId) continue;
      const planRevision = world?.agents[s.event.agentKey]?.planRevision ?? 0;
      const args: Record<string, string> = s.intent.action === 'guide_cancel' ? {} : { text: s.intent.text };
      if (s.intent.toPlayerGuid !== undefined) args.toPlayerGuid = String(s.intent.toPlayerGuid);
      if (s.intent.placeId !== undefined) args.placeId = s.intent.placeId;
      if (s.intent.taskId !== undefined) {
        args.taskId = s.intent.taskId;
        args.stepId = s.intent.stepId ?? '';
      }
      this.sendCommand(s.event.worldSessionId, s.event.agentKey, s.event.messageId, s.intent.action, args, world?.nextCommandSeq ?? 1, nowMs, planRevision, s.intent.plan);
    }
  }

  /** The model can come up after Brain: rules hold the world until then. */
  useProvider(provider: Provider): void {
    this.provider = provider;
  }

  sendCommand(session: string, agentKey: string, correlationId: string, action: CommandPayload['action'],
    args: Record<string, string>, worldNextSeq: number, nowMs: number, planRevision = 0, plan?: DialoguePlan): string | null {
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
    // One step: Lua waits for consecutive numbers, so a number must not be spent without a file.
    try {
      this.memory.tx(() => {
        this.memory.insertCommand(env, seq, plan);
        this.mailbox.writeCommand(env, seq);
      });
    } catch (err) {
      this.log('command_write_failed', { action, seq, error: (err as Error).message });
      return null;
    }
    this.log('command_sent', { commandId: env.payload.commandId, seq, action, args, correlationId });
    return env.payload.commandId;
  }
}
