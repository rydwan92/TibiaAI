// Live bridge test against the running Canary world (stop Brain first: both would allocate
// command sequence numbers). Writes crafted commands into runtime/mailbox, waits for the results
// produced by the Lua bridge inside Canary and checks them. Report: runtime/logs/itest-*.json.
//   node --disable-warning=ExperimentalWarning apps/brain/test-integration/bridge.itest.ts
import { randomUUID } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Mailbox, commandFileName } from '../src/mailbox.ts';
import type { CommandPayload, Envelope, ResultPayload } from '../src/contracts.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const mb = new Mailbox(join(root, 'runtime', 'mailbox'));
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const world = mb.readWorld();
if (!world || Date.now() - world.atMs > 10_000) {
  console.error('world.json missing or stale: is Canary running?');
  process.exit(2);
}
if (existsSync(join(root, 'runtime', 'pids', 'brain.pid'))) {
  console.warn('warning: runtime/pids/brain.pid exists; make sure Brain is stopped');
}
const session = world.worldSessionId;
let seq = world.nextCommandSeq;

function command(action: string, args: Record<string, string>, opts: { commandId?: string; planRevision?: number; session?: string; createdAtMs?: number; ttlMs?: number; agentKey?: string } = {}): Envelope<CommandPayload> {
  const createdAtMs = opts.createdAtMs ?? Date.now();
  return {
    schemaVersion: 1, messageId: randomUUID(), kind: 'command', worldSessionId: opts.session ?? session, agentKey: opts.agentKey ?? 'ardan',
    createdAtMs, correlationId: `itest-${randomUUID()}`,
    payload: { commandId: opts.commandId ?? randomUUID(), planRevision: opts.planRevision ?? 0, expiresAtMs: createdAtMs + (opts.ttlMs ?? 5000), action: action as CommandPayload['action'], args },
  };
}

function writeRaw(content: string): void {
  while (mb.commandSlotTaken(session, seq)) seq++;
  mb.writeAtomic(join(mb.root, 'commands', commandFileName(session, seq)), content);
  seq++;
}

const seen: Envelope<ResultPayload>[] = [];
function collect(): void {
  for (const f of readdirSync(join(mb.root, 'results')).filter((n) => n.startsWith(`res-${session}-`) && n.endsWith('.json')).sort()) {
    seen.push(JSON.parse(readFileSync(join(mb.root, 'results', f), 'utf8')));
    renameSync(join(mb.root, 'results', f), join(mb.root, 'brain-processed', f));
  }
}

async function waitFor(pred: (r: Envelope<ResultPayload>) => boolean, timeoutMs: number): Promise<Envelope<ResultPayload> | null> {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    collect();
    const hit = seen.find(pred);
    if (hit) return hit;
    await sleep(200);
  }
  return null;
}

const report: { name: string; pass: boolean; detail: unknown; latencyMs?: number }[] = [];
function check(name: string, pass: boolean, detail: unknown, latencyMs?: number): void {
  report.push({ name, pass, detail, latencyMs });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}  ${JSON.stringify(detail)}${latencyMs !== undefined ? `  (${latencyMs} ms)` : ''}`);
}

const byId = (id: string, status?: string, dup?: boolean) => (r: Envelope<ResultPayload>) =>
  r.payload.commandId === id && (status === undefined || r.payload.status === status) && (dup === undefined || Boolean(r.payload.duplicate) === dup);

collect(); // drop leftovers from earlier runs into brain-processed
seen.length = 0;

// 1. valid say -> completed
const say = command('say', { text: 'Test integracyjny: slysze was.' });
let t0 = Date.now();
writeRaw(JSON.stringify(say));
let r = await waitFor(byId(say.payload.commandId), 5000);
check('say executes', r?.payload.status === 'completed' && r.correlationId === say.correlationId, r?.payload, Date.now() - t0);

// 2. duplicate commandId -> earlier result, no second effect
const dup = { ...command('say', { text: 'Test integracyjny: slysze was.' }), payload: { ...say.payload, expiresAtMs: Date.now() + 5000 } };
writeRaw(JSON.stringify(dup));
r = await waitFor(byId(say.payload.commandId, undefined, true), 5000);
check('duplicate returns earlier result', r?.payload.duplicate === true && r.payload.status === 'completed', r?.payload);

// 3. stale world session inside the envelope
const stale = command('say', { text: 'stara sesja' }, { session: 'deadbeef00000000' });
writeRaw(JSON.stringify(stale));
r = await waitFor(byId(stale.payload.commandId), 5000);
check('stale session rejected', r?.payload.status === 'rejected' && r.payload.reasonCode === 'stale_session', r?.payload);

// 4. unknown action
const unknown = command('spawn_monster', { name: 'dragon' } as Record<string, string>);
writeRaw(JSON.stringify(unknown));
r = await waitFor(byId(unknown.payload.commandId), 5000);
check('unknown action rejected', r?.payload.status === 'rejected' && r.payload.reasonCode === 'unknown_action', r?.payload);

// 5. expired TTL
const expired = command('say', { text: 'za pozno' }, { createdAtMs: Date.now() - 20_000, ttlMs: 5000 });
writeRaw(JSON.stringify(expired));
r = await waitFor(byId(expired.payload.commandId), 5000);
check('expired command not executed', r?.payload.status === 'expired', r?.payload);

// 6. TTL longer than 10 s
const longTtl = command('stop', {}, { ttlMs: 60_000 });
writeRaw(JSON.stringify(longTtl));
r = await waitFor(byId(longTtl.payload.commandId), 5000);
check('ttl over 10 s rejected', r?.payload.status === 'rejected' && r.payload.reasonCode === 'ttl_too_long', r?.payload);

// 7. invalid JSON -> quarantine
const before = seen.length;
writeRaw('{"schemaVersion":1, broken');
r = await waitFor((x) => seen.indexOf(x) >= before && x.payload.reasonCode === 'invalid_json', 5000);
check('invalid JSON rejected', r?.payload.status === 'rejected', r?.payload);

// 8. waypoint outside allowlist (raw coordinates) -> invalid_args
const coords = command('move_to', { waypointId: '5000,5000,7' });
writeRaw(JSON.stringify(coords));
r = await waitFor(byId(coords.payload.commandId), 5000);
check('non-allowlisted waypoint rejected', r?.payload.status === 'rejected' && r.payload.reasonCode === 'invalid_args', r?.payload);

// 9. unreachable waypoint -> accepted, then failed after timeout, no teleport
const unreachable = command('move_to', { waypointId: 'test_unreachable' }, { planRevision: 1 });
t0 = Date.now();
writeRaw(JSON.stringify(unreachable));
const acc = await waitFor(byId(unreachable.payload.commandId, 'accepted'), 5000);
const failed = await waitFor(byId(unreachable.payload.commandId, 'failed'), 20_000);
const statusAfter = mb.readWorld();
check('unreachable move fails without teleport', Boolean(acc) && failed?.payload.reasonCode !== undefined &&
  statusAfter?.agents.ardan?.position?.y !== 4994, { accepted: acc?.payload.reasonCode, failed: failed?.payload, positionAfter: statusAfter?.agents.ardan?.position }, Date.now() - t0);

// 10. older planRevision after a newer one -> stale_plan
const old = command('patrol', { routeId: 'montag_square' }, { planRevision: 0 });
writeRaw(JSON.stringify(old));
r = await waitFor(byId(old.payload.commandId), 5000);
check('older plan revision rejected', r?.payload.status === 'rejected' && r.payload.reasonCode === 'stale_plan', r?.payload);

// 11. resume patrol with the current revision
const patrol = command('patrol', { routeId: 'montag_square' }, { planRevision: 2 });
writeRaw(JSON.stringify(patrol));
r = await waitFor(byId(patrol.payload.commandId), 5000);
check('patrol resumes', r?.payload.status === 'completed' && r.payload.reasonCode === 'patrol_started', r?.payload);

// 12. multi-agent: a second agent defined only by data accepts its own commands
const miraSay = command('say', { text: 'Test integracyjny: tu Mira.' }, { agentKey: 'mira' });
writeRaw(JSON.stringify(miraSay));
r = await waitFor(byId(miraSay.payload.commandId), 5000);
check('second agent executes say', r?.payload.status === 'completed' && r.agentKey === 'mira', r?.payload);

// 13. waypoints are per agent: Ardan's gate_watch is not on Mira's allowlist
const foreign = command('move_to', { waypointId: 'gate_watch' }, { agentKey: 'mira' });
writeRaw(JSON.stringify(foreign));
r = await waitFor(byId(foreign.payload.commandId), 5000);
check("another agent's waypoint rejected", r?.payload.status === 'rejected' && r.payload.reasonCode === 'invalid_args', r?.payload);

// 14. unknown agent
const nobody = command('say', { text: 'kto tu?' }, { agentKey: 'nobody' });
writeRaw(JSON.stringify(nobody));
r = await waitFor(byId(nobody.payload.commandId), 5000);
check('unknown agent rejected', r?.payload.status === 'rejected' && r.payload.reasonCode === 'unknown_agent', r?.payload);

const quarantined = readdirSync(join(mb.root, 'quarantine')).length;
const out = join(root, 'runtime', 'logs', `itest-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
writeFileSync(out, JSON.stringify({ session, at: new Date().toISOString(), quarantined, report }, null, 2));
const failedCount = report.filter((x) => !x.pass).length;
console.log(`${report.length - failedCount}/${report.length} passed; report ${out}`);
process.exit(failedCount === 0 ? 0 : 1);
