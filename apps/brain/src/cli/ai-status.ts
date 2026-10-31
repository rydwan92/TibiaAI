// Passive AI status: reads local state only. It never sends a conversation or a generate request to
// any model, so running it costs no inference and cannot reach a cloud model. The only network
// calls are read-only GETs to the game's own loopback Ollama endpoint.
//   node apps/brain/src/cli/ai-status.ts [--json]
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AgentRegistry } from '../agents.ts';
import { NpcCatalog } from '../npc/config.ts';
import { loadLocalAiConfig } from '../providers/local-model.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
const runtime = join(root, 'runtime');
const json = (path: string): any => {
  try {
    return existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : null;
  } catch {
    return null;
  }
};
const clock = (ms?: number | null) => (ms ? new Date(ms).toLocaleTimeString('pl-PL') : '-');
const ago = (ms?: number | null) => (ms ? `${Math.max(0, Math.round((Date.now() - ms) / 1000))} s temu` : '-');

/** Local read-only GET. Anything but a loopback URL is refused here as well. */
async function localGet(base: string, path: string): Promise<any> {
  if (!/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(base)) return null;
  try {
    const res = await fetch(`${base}${path}`, { redirect: 'error', signal: AbortSignal.timeout(2000) });
    return res.ok ? await res.json() : null;
  } catch {
    return null;
  }
}

/** CONFIRMED only from the running server's own answer; anything else stays UNKNOWN. */
export function cloudState(status: any): 'CONFIRMED' | 'NOT_BLOCKED' | 'UNKNOWN' {
  const disabled = status?.cloud?.disabled;
  if (disabled === true) return 'CONFIRMED';
  return disabled === false ? 'NOT_BLOCKED' : 'UNKNOWN';
}

function brainLogTail(): any[] {
  const path = join(runtime, 'logs', 'brain.log');
  if (!existsSync(path)) return [];
  return readFileSync(path, 'utf8').split('\n').slice(-600).flatMap((l) => {
    try {
      return [JSON.parse(l)];
    } catch {
      return [];
    }
  });
}

function journalTail(): any[] {
  const path = join(runtime, 'logs', 'world-journal.jsonl');
  if (!existsSync(path)) return [];
  return readFileSync(path, 'utf8').split('\n').slice(-1500).flatMap((l) => {
    try {
      return [JSON.parse(l)];
    } catch {
      return [];
    }
  });
}

const pidOf = (name: string) => {
  const path = join(runtime, 'pids', `${name}.pid`);
  return existsSync(path) ? readFileSync(path, 'utf8').trim() : null;
};

const alive = (pid: string | null) => {
  if (!pid) return false;
  try {
    process.kill(Number(pid), 0);
    return true;
  } catch {
    return false;
  }
};

const percentile = (values: number[], p: number) => {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];
};

export async function collect() {
  const policy = loadLocalAiConfig();
  const endpoint = policy.endpoint;
  const [version, tags, ps, status] = await Promise.all(['/api/version', '/api/tags', '/api/ps', '/api/status'].map((p) => localGet(endpoint, p)));
  const installed = tags?.models?.find((m: any) => m.name === policy.model);
  const loaded = ps?.models?.find((m: any) => m.name === policy.model);
  const brain = json(join(runtime, 'brain', 'ai-status.json'));
  const fresh = brain && Date.now() - brain.atMs < 10_000 && alive(String(brain.pid));
  const world = json(join(runtime, 'mailbox', 'world.json'));
  const log = brainLogTail();
  const journal = journalTail();
  const last = (kinds: string[], rows: any[]) => [...rows].reverse().find((r) => kinds.includes(r.kind));
  const decisions = log.filter((r) => r.kind === 'model_decision' && r.ok);
  const ms = decisions.slice(-20).map((r) => r.totalMs);
  const failure = last(['model_failed', 'model_skipped', 'model_unavailable_using_rules'], log);
  const timeout = last(['brain_reply_timeout'], journal);
  const fallbacks = [
    failure && { at: failure.ts, source: 'Brain', reason: failure.error ?? failure.reason ?? failure.kind },
    timeout && { at: timeout.ts, source: 'silnik', reason: `brak odpowiedzi Brain na czas (${timeout.agentKey})` },
  ].filter(Boolean).sort((a: any, b: any) => String(b.at).localeCompare(String(a.at)));
  const registry = AgentRegistry.load();
  const catalog = NpcCatalog.load();
  const agents = catalog.keys().map((key) => {
    const p = catalog.profile(key)!;
    const a = world?.agents?.[key];
    return {
      key, shownName: registry.displayName(key), role: p.roleTitle, variant: p.variantKey, policy: p.conversationPolicy, skills: registry.skills(key),
      state: a?.state ?? 'brak w swiecie', position: a?.position, moving: a?.moving, guide: a?.guide, alarm: a?.alarmActive ?? false,
    };
  });
  const ollamaPid = pidOf('ollama');
  return {
    ollama: {
      endpoint, pid: ollamaPid, processAlive: alive(ollamaPid), answers: version !== null, version: version?.version ?? null,
      cloud: cloudState(status), cloudSource: status?.cloud?.source ?? null,
    },
    model: {
      name: policy.model, contextTokens: policy.contextTokens,
      weights: tags === null ? 'UNKNOWN' : installed && !installed.remote_host ? 'lokalne' : installed ? 'ZDALNE' : 'BRAK',
      loaded: ps === null ? 'UNKNOWN' : loaded ? 'zaladowany' : 'niezaladowany',
      vramGb: loaded ? Math.round(loaded.size_vram / 1e8) / 10 : null, expiresAt: loaded?.expires_at ?? null,
    },
    brain: {
      pid: pidOf('brain'), online: Boolean(fresh), provider: fresh ? brain.provider : null,
      activeRequests: fresh ? brain.activeRequests ?? 0 : null, queued: fresh ? brain.queued ?? 0 : null, maxQueue: brain?.maxQueue ?? null,
      callsLastMinute: fresh ? brain.callsLastMinute ?? 0 : null, maxCallsPerMinute: brain?.maxCallsPerMinute ?? null,
    },
    answers: {
      lastOk: decisions.at(-1) ?? null, lastReply: brain?.lastReply ?? null, lastFallback: fallbacks[0] ?? null, count: ms.length,
      p50Ms: percentile(ms, 0.5), p90Ms: percentile(ms, 0.9), promptTokensMax: Math.max(0, ...decisions.slice(-20).map((r) => r.promptTokens ?? 0)),
      outputTokensMax: Math.max(0, ...decisions.slice(-20).map((r) => r.outputTokens ?? 0)),
    },
    world: world ? { session: world.worldSessionId, ageSeconds: Math.round((Date.now() - world.atMs) / 1000), brainOnline: world.brainOnline } : null,
    agents,
  };
}

function print(s: Awaited<ReturnType<typeof collect>>): void {
  const line = (label: string, value: unknown) => console.log(`  ${label.padEnd(24)} ${value ?? '-'}`);
  console.log('OLLAMA GRY');
  line('endpoint', s.ollama.endpoint);
  line('proces', s.ollama.pid ? `pid ${s.ollama.pid} ${s.ollama.processAlive ? '(dziala)' : '(nie dziala)'}` : 'zatrzymany');
  line('odpowiada', s.ollama.answers ? `tak, wersja ${s.ollama.version}` : 'nie');
  line('blokada chmury', s.ollama.cloud === 'CONFIRMED' ? `CONFIRMED (serwer zglasza cloud.disabled, zrodlo: ${s.ollama.cloudSource})` : s.ollama.cloud);
  console.log('MODEL');
  line('skonfigurowany', s.model.name);
  line('wagi', s.model.weights);
  line('stan', s.model.loaded + (s.model.vramGb ? `, ${s.model.vramGb} GB VRAM` : ''));
  line('kontekst', `${s.model.contextTokens} tokenow`);
  console.log('BRAIN');
  line('dostawca', s.brain.online ? s.brain.provider : 'Brain nie dziala');
  line('kolejka', s.brain.online ? `w toku ${s.brain.activeRequests}, czeka ${s.brain.queued}/${s.brain.maxQueue}` : '-');
  line('wywolania/min', s.brain.online ? `${s.brain.callsLastMinute}/${s.brain.maxCallsPerMinute}` : '-');
  console.log('ODPOWIEDZI (ostatnie 20)');
  const ok = s.answers.lastOk;
  line('ostatnia udana', ok ? `${ok.ts} ${ok.npc}, ${ok.totalMs} ms, tokeny ${ok.promptTokens}/${ok.outputTokens}` : '-');
  if (s.answers.lastReply) line('tekst', `${clock(s.answers.lastReply.atMs)}: ${s.answers.lastReply.text}`);
  const f = s.answers.lastFallback as any;
  line('ostatni fallback', f ? `${f.at} [${f.source}] ${f.reason}` : 'brak');
  line('czas P50 / P90', s.answers.count > 0 ? `${s.answers.p50Ms} / ${s.answers.p90Ms} ms` : '-');
  line('tokeny maks.', s.answers.count > 0 ? `wejscie ${s.answers.promptTokensMax}, wyjscie ${s.answers.outputTokensMax}` : '-');
  console.log('AGENCI');
  if (!s.world) console.log('  swiat nie dziala');
  else console.log(`  sesja ${s.world.session}, odczyt sprzed ${s.world.ageSeconds} s, Brain widziany przez swiat: ${s.world.brainOnline}`);
  for (const a of s.agents) {
    const place = a.position ? ` (${a.position.x},${a.position.y})` : '';
    const doing = a.guide ? `prowadzi guid ${a.guide.playerGuid} do ${a.guide.placeId}${a.guide.waiting ? ', czeka' : ''}` : a.moving ? `idzie: ${a.moving}` : a.state;
    console.log(`  ${a.shownName.padEnd(12)} ${a.role}, ${a.variant}, polityka ${a.policy}${a.skills.length ? `, umiejetnosci: ${a.skills.join(', ')}` : ''}`);
    console.log(`  ${' '.repeat(12)} ${doing}${place}`);
  }
  console.log(`\nStan z ${clock(Date.now())}. Ten podglad nie wysyla zadnych zapytan do modelu.`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const s = await collect();
  if (process.argv.includes('--json')) console.log(JSON.stringify(s, null, 2));
  else print(s);
  // Loopback fetch sockets must not keep this short-lived tool alive.
  process.exit(0);
}
