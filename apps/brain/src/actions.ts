// Action registry (ADR 0006). Each action declares the capability it needs and validates its own
// arguments; validateCommand stays generic, so a new action is registered here instead of adding
// cases to the main loop. Capabilities come from the actor type (agents.json "actorTypes"), because
// what a body can do depends on how it is controlled: an NPC cannot use a potion, a client-driven
// player can. Engine-side execution still needs a matching handler (Lua bridge or client adapter).
import { taskDefinitions, type AgentDefinition, type AgentsDocument } from './agents.ts';

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
  // toPlayerGuid (optional): the reply is for this player; the engine drops it if they left.
  validate: (args, _agent, limits) => onlyKeys(args, ['text', 'toPlayerGuid']) && typeof args.text === 'string' && args.text.length >= 1 &&
    args.text.length <= limits.maxSayLength && !/[\u0000-\u001f\u007f]/.test(args.text) &&
    (args.toPlayerGuid === undefined || /^\d+$/.test(args.toPlayerGuid)),
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

const hasGuide = (agent: AgentDefinition) => agent.skills?.includes('guide') === true;

// Starts the engine's guide behavior; arrival is reported later by the engine, never assumed here.
registerAction({
  name: 'guide_start',
  capability: 'walk',
  movement: false,
  validate: (args, agent, limits) => onlyKeys(args, ['placeId', 'toPlayerGuid', 'text']) && hasGuide(agent) &&
    agent.guidePlaces?.includes(args.placeId) === true && /^\d+$/.test(args.toPlayerGuid ?? '') &&
    typeof args.text === 'string' && args.text.length >= 1 && args.text.length <= limits.maxSayLength && !/[\u0000-\u001f\u007f]/.test(args.text),
});

// One step of an errand at the agent who owns that step. Items and gold come from the task
// definition in the engine: the arguments carry neither.
registerAction({
  name: 'task_step',
  capability: 'speak',
  movement: false,
  validate: (args, agent, limits) => onlyKeys(args, ['taskId', 'stepId', 'toPlayerGuid', 'text']) && agent.skills?.includes('tasks') === true &&
    /^\d+$/.test(args.toPlayerGuid ?? '') && taskDefinitions()[args.taskId]?.steps.some((s) => s.id === args.stepId && s.at === agent.key) === true &&
    typeof args.text === 'string' && args.text.length >= 1 && args.text.length <= limits.maxSayLength && !/[\u0000-\u001f\u007f]/.test(args.text),
});

registerAction({
  name: 'guide_cancel',
  capability: 'walk',
  movement: false,
  validate: (args, agent) => onlyKeys(args, ['toPlayerGuid']) && hasGuide(agent) && /^\d+$/.test(args.toPlayerGuid ?? ''),
});

registerAction({
  name: 'stop',
  capability: 'walk',
  movement: true,
  validate: (args) => Object.keys(args).length === 0,
});
