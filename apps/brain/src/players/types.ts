// Shapes shared by the parts of a player agent: what the world offers, what a body reports and what a
// mind keeps.
import type { Pos } from './nav.ts';

export interface PlayerDef {
  character: string;
  vocation: string;
  bravery: number;
  curiosity: number;
  sociability: number;
  greed: number;
  voice: string;
}

export interface MonsterFacts {
  health: number;
  experience: number;
  peakDamage: number;
  attacks: string[];
  weakTo: string[];
  hostile: boolean;
}

export interface FloorPoint {
  x: number;
  y: number;
  z: number;
  kind: string;
  dir: 'up' | 'down';
  /** A teleport's destination. */
  to?: Pos;
}

export interface Ground {
  name: string;
  town: string;
  tier: number;
  monsters: string[];
  x: number;
  y: number;
  z: number;
}

export interface SpellFacts {
  words: string;
  group: string;
  level: number;
  mana: number;
  premium: boolean;
  vocations: string[];
  needsTarget: boolean;
}

export interface RuneFacts {
  id: number;
  group: string;
  level: number;
  magicLevel: number;
  needsTarget: boolean;
  vocations: string[];
}

export interface WorldFacts {
  monsters: Record<string, MonsterFacts>;
  points: FloorPoint[];
  towns: { name: string; temple: { x: number; y: number; z: number } }[];
  grounds?: Ground[];
  spells?: Record<string, SpellFacts>;
  runes?: Record<string, RuneFacts>;
  vocationTips?: Record<string, string>;
  npcs?: { name: string; x: number; y: number; z: number }[];
  merchant?: { name: string; x: number; y: number; z: number };
  supplies?: Record<string, { id: number; count: number }[]>;
  /** Item ids worth carrying home: what the merchant buys. */
  sellable?: number[];
  /** Where a locker can be used from. */
  depots?: { x: number; y: number; z: number; locker: { x: number; y: number; z: number } }[];
  /** in_character: a player among players; honest: admits to being an AI when asked. */
  identity?: string;
}

export interface Seen {
  name: string;
  kind: 'monster' | 'player' | 'npc';
  hp: number;
  x: number;
  y: number;
  z: number;
}

export interface BodyState {
  atMs: number;
  online: boolean;
  name: string;
  level: number;
  experience: number;
  hp: number;
  hpMax: number;
  mana: number;
  manaMax: number;
  x: number;
  y: number;
  z: number;
  target: string;
  potions: { health: number; mana: number };
  gold?: number;
  vocation?: string;
  arrows?: number;
  food?: number;
  cap?: number;
  vips?: { name: string; online: boolean }[];
  seen: Seen[];
  goalId: number;
}

export interface BodyEvent {
  kind: string;
  atMs: number;
  from?: string;
  text?: string;
  level?: number;
  private?: boolean;
  online?: boolean;
  error?: string;
  money?: number;
  stored?: number;
  taken?: number;
  ok?: boolean;
}

export type Goal = { type: string; id: number; name?: string; errand?: 'shop' | 'depot' | 'withdraw'; locker?: { x: number; y: number; z: number }; buy?: { id: number; count: number }[]; deposit?: number[]; withdraw?: { id: number; count: number }[]; x?: number; y?: number; z?: number; kind?: string; heading?: { x: number; y: number }; flee?: boolean; avoid?: boolean };

export interface Option {
  id: string;
  label: string;
  goal: Omit<Goal, 'id'>;
}

/** Advice that reached this character through speech; nothing else carries knowledge between minds. */
export interface Tip {
  from: string;
  ground: Ground;
}

/** A trip together. The one who asked follows; the other simply goes on playing. */
export interface Team {
  with: string;
  lead: boolean;
  following: boolean;
  waiting: boolean;
  untilMs: number;
  lastSeenAt: number;
  lostAsks: number;
}

export interface Finding {
  name: string;
  monsters: string[];
  danger: boolean;
}

export interface Experience {
  fear: number;
  confidence: number;
  boredom: number;
  loneliness: number;
  kills: Record<string, number>;
  deathsBy: Record<string, number>;
  deaths: number;
  chunks: Record<string, number>;
  floors: number[];
  dangerAt: Record<string, string>;
  warnings: Record<string, string>;
  plan: string;
  finding: Finding | null;
  tipsGiven: number;
  tipsHeard: number;
  /** Bad blood towards people, built from what they did; the choice to act on it stays free. */
  grudges: Record<string, number>;
  /** What this character decided to do differently, in its own words. */
  lessons: string[];
  /** Ways between floors really used: stairs, holes, ropes, shovels, ladders, teleports. */
  ways: Record<string, number>;
  trades: number;
  stored: number;
  pvpFights: number;
  helped: number;
  trips: number;
  modelChoices: number;
  ruleChoices: number;
}
