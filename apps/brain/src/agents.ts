// Agent registry: the single source of agent definitions (packages/contracts/agents.json,
// ADR 0004), shared with the Lua runtime. Validation mirrors TibiaAI.validateDefinition in Lua.
import { readFileSync } from 'node:fs';

export interface Position { x: number; y: number; z: number }

export type Behavior = { type: 'patrol'; defaultRoute: string } | { type: 'stationary'; home: string };

export interface Place {
  label: string;
  position: Position;
  aliases: string[];
}

export interface SkillSpec {
  /** Capabilities the actor's body must have. */
  requires: string[];
  /** Intents this skill lets a model propose. */
  intents: string[];
}

export interface AgentDefinition {
  key: string;
  /** Name players use. The name shown in game adds the marker; agentKey stays the identity. */
  npcName: string;
  addressNames?: string[];
  marked?: boolean;
  skills?: string[];
  guidePlaces?: string[];
  description?: string;
  actor: string;
  spawn: string;
  behavior: Behavior;
  waypoints: Record<string, Position>;
  routes: Record<string, string[]>;
  greeting: { words: string[]; range: number; cooldownSeconds?: number };
  hearing?: { range: number; yellRange?: number };
  alarm?: { zones: string[]; moveTo: string; yell?: boolean; rewarnSeconds?: number };
  texts: Record<string, string>;
}

export interface AgentsDocument {
  schemaVersion: 1;
  timing: Record<string, number>;
  alarmZones: string[];
  actorTypes: Record<string, { capabilities: string[] }>;
  aiMarker?: { format: string; lookNote?: string; outfitAccent?: Record<string, number> };
  places?: Record<string, Place>;
  skills?: Record<string, SkillSpec>;
  agents: Record<string, Omit<AgentDefinition, 'key'>>;
  actions: string[];
  limits: { maxTtlMs: number; maxSayLength: number; maxEventTextLength: number; maxFileBytes: number };
}

export const DEFAULT_AGENTS_PATH = new URL('../../../packages/contracts/agents.json', import.meta.url);
export const DEFAULT_TASKS_PATH = new URL('../../../packages/contracts/tasks.json', import.meta.url);

export interface TaskStep {
  id: string;
  at: string;
  from: number;
  to: number;
  words: string[];
  /** Fixed line of this step: an instruction must not depend on the model. */
  say: string;
  notice?: string;
  giveItem?: { id: number; count: number };
  takeItem?: { id: number; count: number };
  money?: number;
  trust?: number;
}

export interface TaskDefinition {
  label: string;
  storage: number;
  steps: TaskStep[];
  refused: Record<string, string>;
}

let tasks: Record<string, TaskDefinition> | null = null;

/** Errands as data, shared with the engine. Brain only reads them to recognise a step. */
export function taskDefinitions(): Record<string, TaskDefinition> {
  tasks ??= (JSON.parse(readFileSync(DEFAULT_TASKS_PATH, 'utf8')) as { tasks: Record<string, TaskDefinition> }).tasks;
  return tasks;
}

const KEY_RE = /^[a-z][a-z0-9_]*$/;
const isObj = (v: unknown): v is Record<string, any> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isPos = (p: unknown) => isObj(p) && [p.x, p.y, p.z].every((n) => Number.isInteger(n));

/** Returns a list of problems; empty when the document is valid. */
export function validateAgentsDocument(doc: unknown): string[] {
  const errors: string[] = [];
  if (!isObj(doc) || doc.schemaVersion !== 1) return ['schemaVersion must be 1'];
  if (!isObj(doc.agents) || Object.keys(doc.agents).length === 0) errors.push('agents: at least one agent required');
  if (!Array.isArray(doc.actions)) errors.push('actions');
  if (!isObj(doc.limits)) errors.push('limits');
  const zones: unknown[] = Array.isArray(doc.alarmZones) ? doc.alarmZones : [];
  if (doc.aiMarker !== undefined && !(isObj(doc.aiMarker) && typeof doc.aiMarker.format === 'string' && doc.aiMarker.format.includes('{name}'))) {
    errors.push('aiMarker.format must contain {name}');
  }
  const places: Record<string, any> = isObj(doc.places) ? doc.places : {};
  for (const [id, place] of Object.entries(places)) {
    if (!isObj(place) || !isPos(place.position) || !Array.isArray(place.aliases) || typeof place.label !== 'string') errors.push(`place ${id}`);
  }
  const skills: Record<string, any> = isObj(doc.skills) ? doc.skills : {};
  for (const [key, def] of Object.entries<any>(isObj(doc.agents) ? doc.agents : {})) {
    const err = (msg: string) => errors.push(`${key}: ${msg}`);
    if (!KEY_RE.test(key)) err('agent key format');
    if (!isObj(def)) { err('not an object'); continue; }
    if (typeof def.npcName !== 'string' || !def.npcName) err('npcName');
    if (!isObj(doc.actorTypes) || !(def.actor in doc.actorTypes)) err('actor must be one of actorTypes');
    const wps = isObj(def.waypoints) ? def.waypoints : {};
    if (Object.keys(wps).length === 0) err('waypoints');
    for (const [id, p] of Object.entries(wps)) if (!isPos(p)) err(`waypoint ${id}`);
    if (!(def.spawn in wps)) err('spawn must be a waypoint id');
    for (const [rid, route] of Object.entries<any>(isObj(def.routes) ? def.routes : {})) {
      if (!Array.isArray(route) || route.length === 0) err(`route ${rid} empty`);
      else for (const wp of route) if (!(wp in wps)) err(`route ${rid} -> ${wp}`);
    }
    const b = def.behavior;
    if (!isObj(b) || !['patrol', 'stationary'].includes(b.type)) err('behavior.type');
    else if (b.type === 'patrol' && !(isObj(def.routes) && b.defaultRoute in def.routes)) err('behavior.defaultRoute');
    else if (b.type === 'stationary' && !(b.home in wps)) err('behavior.home');
    if (def.alarm !== undefined) {
      if (!isObj(def.alarm) || !Array.isArray(def.alarm.zones) || !(def.alarm.moveTo in wps)) err('alarm');
      else for (const z of def.alarm.zones) if (!zones.includes(z)) err(`alarm zone ${z} not in alarmZones`);
    }
    if (!isObj(def.greeting) || !Array.isArray(def.greeting.words) || typeof def.greeting.range !== 'number') err('greeting');
    const body: string[] = isObj(doc.actorTypes) ? doc.actorTypes[def.actor]?.capabilities ?? [] : [];
    for (const name of def.skills ?? []) {
      if (!(name in skills)) err(`unknown skill ${name}`);
      else if (!skills[name].requires.every((c: string) => body.includes(c))) err(`skill ${name} needs capabilities the actor lacks`);
    }
    for (const id of def.guidePlaces ?? []) if (!(id in places)) err(`guide place ${id}`);
    if (def.hearing !== undefined && (!isObj(def.hearing) || typeof def.hearing.range !== 'number' ||
      (def.hearing.yellRange !== undefined && typeof def.hearing.yellRange !== 'number'))) err('hearing');
    if (!isObj(def.texts) || typeof def.texts.greetFallback !== 'string') err('texts.greetFallback');
    for (const [name, text] of Object.entries<any>(isObj(def.texts) ? def.texts : {})) {
      if (typeof text !== 'string') err(`texts.${name} must be a string`);
      else if (/[^\x20-\x7e]/.test(text)) err(`texts.${name} must be printable ASCII (client encoding not verified)`);
      else if (text.length > 200) err(`texts.${name} longer than 200`);
    }
  }
  return errors;
}

export class AgentRegistry {
  readonly doc: AgentsDocument;
  private readonly defs: Map<string, AgentDefinition>;

  constructor(doc: AgentsDocument) {
    const errors = validateAgentsDocument(doc);
    if (errors.length > 0) throw new Error(`Invalid agent definitions:\n${errors.join('\n')}`);
    this.doc = doc;
    this.defs = new Map(Object.entries(doc.agents).map(([key, def]) => [key, { ...def, key } as AgentDefinition]));
  }

  static load(path: URL | string = DEFAULT_AGENTS_PATH): AgentRegistry {
    return new AgentRegistry(JSON.parse(readFileSync(path, 'utf8')) as AgentsDocument);
  }

  get(key: string): AgentDefinition | undefined {
    return this.defs.get(key);
  }

  has(key: string): boolean {
    return this.defs.has(key);
  }

  keys(): string[] {
    return [...this.defs.keys()].sort();
  }

  /** What this agent's body can do; depends on its actor type, not on its role. */
  capabilities(key: string): string[] {
    const def = this.get(key);
    return def ? this.doc.actorTypes[def.actor].capabilities : [];
  }

  /** Skills assigned to this agent. A fix to a skill reaches every agent that has it. */
  skills(key: string): string[] {
    return this.get(key)?.skills ?? [];
  }

  /** Name shown in game. Memory, mail and commands never use it. */
  displayName(key: string): string {
    const def = this.get(key);
    if (!def) return key;
    const format = this.doc.aiMarker?.format;
    return def.marked && format ? format.replace('{name}', def.npcName) : def.npcName;
  }

  get places(): Record<string, Place> {
    return this.doc.places ?? {};
  }

  get limits(): AgentsDocument['limits'] {
    return this.doc.limits;
  }

  get actions(): string[] {
    return this.doc.actions;
  }
}
