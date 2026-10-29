// Provider interface: turns one engine event into proposed intents. A provider only proposes
// contract actions; Brain validates them and the engine decides whether they can run.
// Providers must be fast and side-effect free; slow ones (LLM, M4) need their own timeout/budget
// layer before being plugged in here.
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
  decide(event: Envelope<EventPayload>, ctx: ProviderContext): Intent[];
}
