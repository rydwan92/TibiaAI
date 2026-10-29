// Contract v1 (DOCS/CONTRACTS.md). The Lua bridge applies the same rules on the engine side.
import { readFileSync } from 'node:fs';

const allowlistUrl = new URL('../../../packages/contracts/allowlist.json', import.meta.url);
export const allowlist = JSON.parse(readFileSync(allowlistUrl, 'utf8')) as {
  agents: Record<string, { routes: string[]; waypoints: string[] }>;
  actions: string[];
  limits: { maxTtlMs: number; maxSayLength: number; maxEventTextLength: number; maxFileBytes: number };
};

export const SCHEMA_VERSION = 1;

export type Kind = 'event' | 'command' | 'result';

export interface Envelope<P> {
  schemaVersion: 1;
  messageId: string;
  kind: Kind;
  worldSessionId: string;
  agentKey: string;
  createdAtMs: number;
  correlationId: string;
  sequence?: number;
  payload: P;
}

export type EventPayload =
  | { type: 'player_greeted'; playerGuid: number; playerName: string; text: string }
  | { type: 'training_alarm_started'; zoneId: string; triggeredBy?: string }
  | { type: 'training_alarm_cleared'; zoneId: string; clearedBy?: string }
  | { type: 'position_observed'; x: number; y: number; z: number };

export type Action = 'say' | 'patrol' | 'move_to' | 'stop';

export interface CommandPayload {
  commandId: string;
  planRevision: number;
  expiresAtMs: number;
  action: Action;
  args: Record<string, string>;
}

export type ResultStatus = 'accepted' | 'completed' | 'rejected' | 'failed' | 'expired';

export interface ResultPayload {
  commandId: string;
  status: ResultStatus;
  reasonCode: string;
  actualPosition?: { x: number; y: number; z: number };
  completedAtMs?: number;
  duplicate?: boolean;
  detail?: string;
}

export type Validation<T> = { ok: true; value: T } | { ok: false; error: string };

const fail = (error: string): { ok: false; error: string } => ({ ok: false, error });

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isStr = (v: unknown, max = 128): v is string => typeof v === 'string' && v.length > 0 && v.length <= max;
const isInt = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v);
const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

function checkEnvelope(raw: unknown, kind: Kind): Validation<Envelope<unknown>> {
  if (!isObj(raw)) return fail('not_object');
  if (raw.schemaVersion !== SCHEMA_VERSION) return fail('schema_version');
  if (raw.kind !== kind) return fail('kind');
  if (!isStr(raw.messageId, 64)) return fail('message_id');
  if (!isStr(raw.worldSessionId, 64) || !ID_RE.test(raw.worldSessionId)) return fail('world_session_id');
  if (!isStr(raw.agentKey, 32) || !allowlist.agents[raw.agentKey]) return fail('agent_key');
  if (!isInt(raw.createdAtMs) || raw.createdAtMs <= 0) return fail('created_at');
  if (!isStr(raw.correlationId, 64)) return fail('correlation_id');
  if (!isObj(raw.payload)) return fail('payload');
  return { ok: true, value: raw as unknown as Envelope<unknown> };
}

export function parseEvent(raw: unknown): Validation<Envelope<EventPayload>> {
  const env = checkEnvelope(raw, 'event');
  if (!env.ok) return env;
  const e = env.value;
  if (!isInt(e.sequence) || e.sequence < 1) return fail('sequence');
  const p = e.payload as Record<string, unknown>;
  switch (p.type) {
    case 'player_greeted':
      if (!isInt(p.playerGuid) || p.playerGuid <= 0) return fail('player_guid');
      if (!isStr(p.playerName, 64)) return fail('player_name');
      if (typeof p.text !== 'string' || p.text.length > allowlist.limits.maxEventTextLength) return fail('text');
      break;
    case 'training_alarm_started':
    case 'training_alarm_cleared':
      if (!isStr(p.zoneId, 64)) return fail('zone_id');
      break;
    case 'position_observed':
      if (!isInt(p.x) || !isInt(p.y) || !isInt(p.z)) return fail('position');
      break;
    default:
      return fail('unknown_event_type');
  }
  return { ok: true, value: e as Envelope<EventPayload> };
}

const RESULT_STATUSES: ResultStatus[] = ['accepted', 'completed', 'rejected', 'failed', 'expired'];

export function parseResult(raw: unknown): Validation<Envelope<ResultPayload>> {
  const env = checkEnvelope(raw, 'result');
  if (!env.ok) return env;
  const p = env.value.payload as Record<string, unknown>;
  if (!isStr(p.commandId, 64)) return fail('command_id');
  if (!RESULT_STATUSES.includes(p.status as ResultStatus)) return fail('status');
  if (!isStr(p.reasonCode, 64)) return fail('reason_code');
  return { ok: true, value: env.value as Envelope<ResultPayload> };
}

/** Brain-side validation before a command is written; mirrors the Lua checks. */
export function validateCommand(env: Envelope<CommandPayload>, nowMs: number): Validation<Envelope<CommandPayload>> {
  const base = checkEnvelope(env, 'command');
  if (!base.ok) return base;
  const p = env.payload;
  if (!isStr(p.commandId, 64) || !ID_RE.test(p.commandId)) return fail('invalid_command');
  if (!isInt(p.planRevision) || p.planRevision < 0) return fail('invalid_plan_revision');
  if (!isInt(p.expiresAtMs) || p.expiresAtMs - env.createdAtMs > allowlist.limits.maxTtlMs) return fail('ttl_too_long');
  if (p.expiresAtMs < nowMs) return fail('ttl_expired');
  if (!allowlist.actions.includes(p.action)) return fail('unknown_action');
  const agent = allowlist.agents[env.agentKey];
  const args = p.args ?? {};
  const keys = Object.keys(args);
  const only = (allowed: string[]) => keys.every((k) => allowed.includes(k));
  switch (p.action) {
    case 'say':
      if (!only(['text']) || typeof args.text !== 'string' || args.text.length < 1 ||
        args.text.length > allowlist.limits.maxSayLength || /[\u0000-\u001f\u007f]/.test(args.text)) return fail('invalid_args');
      break;
    case 'patrol':
      if (!only(['routeId']) || !agent.routes.includes(args.routeId)) return fail('invalid_args');
      break;
    case 'move_to':
      if (!only(['waypointId']) || !agent.waypoints.includes(args.waypointId)) return fail('invalid_args');
      break;
    case 'stop':
      if (keys.length > 0) return fail('invalid_args');
      break;
  }
  return { ok: true, value: env };
}

export interface WorldStatus {
  worldSessionId: string;
  startedAtMs: number;
  atMs: number;
  nextCommandSeq: number;
  lastEventSeq: number;
  lastResultSeq: number;
  brainOnline: boolean;
  agent: { state: string; alarmActive: boolean; position?: { x: number; y: number; z: number }; planRevision: number };
}

export function parseWorldStatus(raw: unknown): WorldStatus | null {
  if (!isObj(raw) || !isStr(raw.worldSessionId, 64) || !ID_RE.test(raw.worldSessionId)) return null;
  if (!isInt(raw.nextCommandSeq) || !isInt(raw.atMs)) return null;
  return raw as unknown as WorldStatus;
}
