// Provider interface: turns one engine event into proposed intents. A provider only proposes
// contract actions; Brain validates them and the engine decides whether they can run.
// A provider may answer later with a Promise (local model); it must then enforce its own timeout,
// queue and budget, and Brain drops decisions that arrive after the world moved on.
import type { AgentDefinition } from '../agents.ts';
import type { Envelope, EventPayload } from '../contracts.ts';
import type { EncounterStats, HeardStatement } from '../memory.ts';

export interface Intent {
  action: 'say';
  text: string;
  delayMs: number;
}

export interface ProviderContext {
  agent: AgentDefinition;
  nowMs: number;
  /** Encounter stats for the greeting player before this event was recorded. */
  encounterBefore?: EncounterStats;
  /** Training alarms observed for this agent in the current world session (incl. this one). */
  alarmsThisSession?: number;
  /** Freshest statement this agent heard from another agent (ADR 0005), if recent enough. */
  latestHeard?: HeardStatement & { speakerName: string };
}

export interface Provider {
  readonly name: string;
  decide(event: Envelope<EventPayload>, ctx: ProviderContext): Intent[] | Promise<Intent[]>;
}
