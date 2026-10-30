// Action registry (ADR 0006). Each action declares the capability it needs and validates its own
// arguments; validateCommand stays generic, so a new action is registered here instead of adding
// cases to the main loop. Capabilities come from the actor type (agents.json "actorTypes"), because
// what a body can do depends on how it is controlled: an NPC cannot use a potion, a client-driven
// player can. Engine-side execution still needs a matching handler (Lua bridge or client adapter).
import type { AgentDefinition, AgentsDocument } from './agents.ts';

export interface ActionSpec {
  name: string;
  capability: string;
  /** Movement plans are ordered by planRevision; speech is not a plan. */
  movement: boolean;
  validate(args: Record<string, string>, agent: AgentDefinition, limits: AgentsDocument['limits']): boolean;
}

const registry = new Map<string, ActionSpec>();

export function registerAction(spec: ActionSpec): void {
  registry.set(spec.name, spec);
}

export function getAction(name: string): ActionSpec | undefined {
  return registry.get(name);
}

const onlyKeys = (args: Record<string, string>, allowed: string[]) => Object.keys(args).every((k) => allowed.includes(k));

registerAction({
  name: 'say',
  capability: 'speak',
  movement: false,
  validate: (args, _agent, limits) => onlyKeys(args, ['text']) && typeof args.text === 'string' && args.text.length >= 1 &&
    args.text.length <= limits.maxSayLength && !/[\u0000-\u001f\u007f]/.test(args.text),
});

registerAction({
  name: 'patrol',
  capability: 'walk',
  movement: true,
  validate: (args, agent) => onlyKeys(args, ['routeId']) && Object.hasOwn(agent.routes, args.routeId),
});

registerAction({
  name: 'move_to',
  capability: 'walk',
  movement: true,
  validate: (args, agent) => onlyKeys(args, ['waypointId']) && Object.hasOwn(agent.waypoints, args.waypointId),
});

registerAction({
  name: 'stop',
  capability: 'walk',
  movement: true,
  validate: (args) => Object.keys(args).length === 0,
});
