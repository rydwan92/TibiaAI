// Decision timeline: joins the world journal (Lua, runtime/logs/world-journal.jsonl) and the
// Brain log (runtime/logs/brain.log) into chains keyed by the originating id
// (event messageId, or a command's correlationId when there is no event):
//   observation (world event) -> decision (brain received / command sent)
//   -> execution (world accepted / said / moved / result) -> outcome (brain result).
// Pure functions; the CLI lives in src/cli/timeline.ts.

export type LogEntry = Record<string, any> & { ts: string; kind: string };

export interface Step {
  atMs: number;
  ts: string;
  source: 'world' | 'brain';
  phase: 'observation' | 'decision' | 'execution' | 'outcome';
  kind: string;
  agentKey?: string;
  summary: string;
}

export interface Chain {
  key: string;
  agentKey?: string;
  steps: Step[];
}

const short = (v: unknown) => JSON.stringify(v);

function describe(e: LogEntry, source: 'world' | 'brain'): Pick<Step, 'phase' | 'summary'> | null {
  if (source === 'world') {
    switch (e.kind) {
      case 'event': {
        const { type, ...rest } = e.payload ?? {};
        return { phase: 'observation', summary: `${e.eventType} ${short(rest)}${e.delivered ? '' : ' (not delivered to Brain)'}` };
      }
      case 'command_accepted': return { phase: 'execution', summary: `accepted ${e.action} (planRevision ${e.planRevision})` };
      case 'npc_said': return { phase: 'execution', summary: `said "${e.text}" [${e.source}]` };
      case 'move_completed':
      case 'move_failed': return { phase: 'execution', summary: `move ${e.target}: ${e.reason} at ${short(e.position)}` };
      case 'command_result': return { phase: 'execution', summary: `result ${e.status}/${e.reasonCode}` };
      default: return null;
    }
  }
  switch (e.kind) {
    case 'event_received': return { phase: 'decision', summary: `received ${e.type}${e.stale ? ' (stale: stored, no action)' : ''}` };
    case 'command_sent': return { phase: 'decision', summary: `sent ${e.action} ${short(e.args)} seq ${e.seq}` };
    case 'command_refused_locally': return { phase: 'decision', summary: `refused locally: ${e.error}` };
    case 'result_received': return { phase: 'outcome', summary: `${e.status}/${e.reasonCode}${e.duplicate ? ' (duplicate)' : ''}` };
    default: return null;
  }
}

/** Builds chains; world entries should already be filtered to one world session. */
export function buildTimeline(world: LogEntry[], brain: LogEntry[]): Chain[] {
  const chains = new Map<string, Chain>();
  const commandToKey = new Map<string, string>();

  const add = (key: string, e: LogEntry, source: 'world' | 'brain') => {
    const d = describe(e, source);
    if (!d) return;
    let chain = chains.get(key);
    if (!chain) {
      chain = { key, steps: [] };
      chains.set(key, chain);
    }
    chain.agentKey ??= e.agentKey;
    chain.steps.push({ atMs: Date.parse(e.ts), ts: e.ts, source, kind: e.kind, agentKey: e.agentKey, ...d });
  };

  // Pass 1: roots and command -> chain links (both logs carry correlationId on commands).
  for (const e of world) if (e.kind === 'event' && e.eventId) chains.set(e.eventId, { key: e.eventId, agentKey: e.agentKey, steps: [] });
  for (const e of [...brain, ...world]) {
    if ((e.kind === 'command_sent' || e.kind === 'command_accepted') && e.commandId && e.correlationId) {
      commandToKey.set(e.commandId, e.correlationId);
    }
  }
  const knownKeys = new Set([...chains.keys(), ...commandToKey.values()]);

  // Pass 2: attach steps.
  for (const e of world) {
    const key = e.kind === 'event' ? e.eventId : (e.correlationId ?? (e.commandId && commandToKey.get(e.commandId)));
    if (key) add(key, e, 'world');
  }
  for (const e of brain) {
    const key = e.kind === 'event_received' ? e.eventId : (e.correlationId ?? (e.commandId && commandToKey.get(e.commandId)));
    if (key && knownKeys.has(key)) add(key, e, 'brain');
  }

  // World timestamps have 1 s resolution (os.time in Lua), Brain's have ms. Within one second the
  // causal order is observation -> decision -> execution -> outcome, so compare by second first.
  const rank = { observation: 0, decision: 1, execution: 2, outcome: 3 };
  const second = (s: Step) => Math.floor(s.atMs / 1000);
  const result = [...chains.values()].filter((c) => c.steps.length > 0);
  for (const c of result) c.steps.sort((a, b) => second(a) - second(b) || rank[a.phase] - rank[b.phase] || a.atMs - b.atMs);
  return result.sort((a, b) => a.steps[0].atMs - b.steps[0].atMs);
}

export function formatChain(c: Chain): string {
  const lines = [`== ${c.agentKey ?? '?'}  ${c.key}`];
  for (const s of c.steps) {
    lines.push(`  ${s.ts.slice(11, 23).padEnd(12)} ${s.source.padEnd(5)} ${s.phase.padEnd(11)} ${s.summary}`);
  }
  return lines.join('\n');
}

export function parseJsonLines(text: string): LogEntry[] {
  const out: LogEntry[] = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      const v = JSON.parse(line);
      if (v && typeof v.ts === 'string' && typeof v.kind === 'string') out.push(v);
    } catch {
      // partial line while a writer is appending; skip
    }
  }
  return out;
}
