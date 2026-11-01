// Cloud models: budget, safety and failure behaviour, on a fake transport. No request leaves the machine.
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { Memory } from '../src/memory.ts';
import { CopilotModels, extractJson, schemaProblem, sdkTransport, type CallUsage, type CloudAiConfig, type Transport, type TransportReply, type TransportRequest } from '../src/providers/copilot-model.ts';
import { CreditLedger } from '../src/providers/ledger.ts';

const CFG: CloudAiConfig = {
  allowedModels: ['gpt-6-luna', 'claude-haiku-5.5'], maxCallsPerMinute: 6, maxConcurrent: 1, maxQueue: 2, maxPromptChars: 1000, maxOutputTokens: 500, timeoutMs: 1000,
  retries: 1, retryDelayMs: 1, failureCooldownMs: 30_000, reserveCredits: 0.05, runBudgetCredits: 5, dailyBudgetCredits: 20, monthlyBudgetCredits: 100,
};
const ROUTE = { provider: 'copilot', model: 'gpt-6-luna', effort: 'low' };
const SCHEMA = { type: 'object', properties: { choice: { type: 'string', enum: ['hunt', 'shop'] }, say: { type: 'string' } }, required: ['choice'] };
const USAGE: CallUsage = { inputTokens: 100, outputTokens: 50, cacheReadTokens: 0, credits: 0.01, durationMs: 5 };
const MSG = [{ role: 'system' as const, content: 'kim jestes' }, { role: 'user' as const, content: 'co dalej' }];

function fixture(cfg: Partial<CloudAiConfig> = {}, reply: (r: TransportRequest) => TransportReply | Promise<TransportReply> = () => ({ text: '{"choice":"hunt"}', usage: [USAGE] })) {
  const dir = mkdtempSync(join(tmpdir(), 'copilot-'));
  const memory = new Memory(':memory:');
  const ledger = new CreditLedger(memory.db);
  const seen: TransportRequest[] = [];
  const transport: Transport = { send: async (r) => { seen.push(r); return reply(r); }, stop: async () => undefined };
  const clock = { now: Date.parse('2026-11-01T12:00:00Z') };
  const stopFile = join(dir, 'ai-stop');
  const make = () => new CopilotModels({ ...CFG, ...cfg }, transport, ledger, stopFile, () => clock.now);
  return { memory, ledger, seen, clock, stopFile, make, models: make(), done: () => rmSync(dir, { recursive: true, force: true }) };
}

const row = (credits: number, atMs: number) => ({ atMs, agentKey: 'luna', model: 'gpt-6-luna', effort: 'low', purpose: 'decide', inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, credits, estimated: false, durationMs: 1, ok: true, error: '' });

test('an answer is reduced to its JSON object', () => {
  assert.equal(extractJson('```json\n{"a":1}\n```'), '{"a":1}');
  assert.throws(() => extractJson('nie wiem'));
});

test('an action outside the offered list is not an answer', () => {
  assert.equal(schemaProblem(SCHEMA, { choice: 'hunt' }), null);
  assert.match(String(schemaProblem(SCHEMA, { choice: 'rm -rf' })), /allowed/);
  assert.match(String(schemaProblem(SCHEMA, {})), /missing/);
});

test('allowed values may be numbers, as in the NPC answer', () => {
  const numbers = { properties: { sentiment: { type: 'integer', enum: [-1, 0, 1] } }, required: ['sentiment'] };
  assert.equal(schemaProblem(numbers, { sentiment: 0 }), null);
  assert.match(String(schemaProblem(numbers, { sentiment: 5 })), /allowed/);
  assert.match(String(schemaProblem(numbers, { sentiment: '0' })), /allowed/);
});

test('a call is recorded with the cost the service reported', async () => {
  const f = fixture();
  const client = f.models.forAgent('luna', ROUTE);
  const r = await client.chat(MSG, { schema: SCHEMA, purpose: 'decide' });
  assert.equal(r.text, '{"choice":"hunt"}');
  assert.deepEqual({ ...f.ledger.byPurpose(0)[0] }, { purpose: 'decide', calls: 1, credits: 0.01, good: 1 });
  assert.equal(f.ledger.summary(0)[0].inputTokens, 100);
  assert.match(f.seen[0].system, /JSON/);
  f.done();
});

test('a bad answer costs money, is counted as bad and is not retried', async () => {
  const f = fixture({}, () => ({ text: '{"choice":"steal"}', usage: [USAGE] }));
  await assert.rejects(f.models.forAgent('luna', ROUTE).chat(MSG, { schema: SCHEMA }), /bad answer/);
  assert.equal(f.seen.length, 1);
  assert.equal(f.ledger.byPurpose(0)[0].good, 0);
  assert.equal(f.ledger.spentSince(0), 0.01);
  f.done();
});

test('the daily budget survives a restart', async () => {
  const f = fixture();
  f.ledger.record(row(19.96, f.clock.now - 1000));
  const restarted = f.make();
  assert.equal(restarted.blockedBy(), 'daily budget used');
  assert.equal(restarted.available(), false);
  await assert.rejects(restarted.forAgent('luna', ROUTE).chat(MSG), /daily budget/);
  assert.equal(f.seen.length, 0);
  f.done();
});

test('the monthly limit holds even when each day was within budget', () => {
  const f = fixture();
  for (let day = 1; day <= 6; day++) f.ledger.record(row(19, Date.parse(`2026-11-0${day}T01:00:00`)));
  f.clock.now = Date.parse('2026-11-06T12:00:00');
  f.ledger.record(row(0, f.clock.now));
  assert.equal(f.make().blockedBy(), 'monthly budget used');
  f.done();
});

test('yesterday does not count against today', () => {
  const f = fixture();
  f.ledger.record(row(19.96, f.clock.now - 86_400_000));
  assert.equal(f.make().blockedBy(), null);
  f.done();
});

test('the run budget stops a test even with credits left for the day', async () => {
  const f = fixture({ runBudgetCredits: 0.07 });
  const client = f.models.forAgent('luna', ROUTE);
  await client.chat(MSG);
  f.ledger.record(row(0.02, f.clock.now));
  assert.equal(f.models.blockedBy(), 'run budget used');
  f.done();
});

test('the stop switch blocks new calls at once', async () => {
  const f = fixture();
  writeFileSync(f.stopFile, 'x');
  assert.equal(f.models.available(), false);
  await assert.rejects(f.models.forAgent('luna', ROUTE).chat(MSG), /operator/);
  rmSync(f.stopFile);
  assert.equal(f.models.available(), true);
  f.done();
});

test('calls per minute are limited and the limit passes with time', async () => {
  const f = fixture({ maxCallsPerMinute: 2 });
  const client = f.models.forAgent('luna', ROUTE);
  await client.chat(MSG);
  await client.chat(MSG);
  assert.equal(f.models.available(), false);
  await assert.rejects(client.chat(MSG), /too many/);
  f.clock.now += 61_000;
  assert.equal(f.models.available(), true);
  f.done();
});

test('one call at a time across all characters', async () => {
  let inside = 0;
  let most = 0;
  const f = fixture({}, async () => {
    most = Math.max(most, ++inside);
    await new Promise((resolve) => setTimeout(resolve, 5));
    inside--;
    return { text: '{"choice":"hunt"}', usage: [USAGE] };
  });
  await Promise.all([f.models.forAgent('luna', ROUTE).chat(MSG), f.models.forAgent('haiku', { ...ROUTE, model: 'claude-haiku-5.5' }).chat(MSG)]);
  assert.equal(most, 1);
  f.done();
});

test('a failure is retried once, every attempt is recorded, then it cools down', async () => {
  const f = fixture({}, () => { throw new Error('service down'); });
  await assert.rejects(f.models.forAgent('luna', ROUTE).chat(MSG), /service down/);
  assert.equal(f.seen.length, 2);
  assert.equal(f.ledger.byPurpose(0)[0].calls, 2);
  assert.equal(f.ledger.spentSince(0), 0.1, 'unknown cost is charged at the reserve');
  assert.match(String(f.models.blockedBy()), /cooling/);
  f.clock.now += 31_000;
  assert.equal(f.models.blockedBy(), null);
  f.done();
});

test('a timeout is not retried', async () => {
  const f = fixture({}, () => { throw new Error('Timeout after 1000ms'); });
  await assert.rejects(f.models.forAgent('luna', ROUTE).chat(MSG));
  assert.equal(f.seen.length, 1);
  f.done();
});

test('only allowed models and short prompts', async () => {
  const f = fixture();
  assert.throws(() => f.models.forAgent('luna', { ...ROUTE, model: 'gpt-5.3-codex' }), /allowedModels/);
  await assert.rejects(f.models.forAgent('luna', ROUTE).chat([{ role: 'user', content: 'x'.repeat(1001) }]), /too long/);
  f.done();
});

test('the session has no tools, no folder of ours and refuses every permission', async () => {
  const seen: Record<string, any> = {};
  const usage: ((e: unknown) => void)[] = [];
  class CopilotClient {
    constructor(o: unknown) { seen.client = o; }
    async start() {}
    async stop() {}
    async deleteSession(id: string) { seen.deleted = id; }
    async createSession(o: unknown) {
      seen.session = o;
      return {
        sessionId: 's1',
        on: (_: string, fn: (e: unknown) => void) => usage.push(fn),
        sendAndWait: async () => {
          usage[0]({ data: { inputTokens: 107, outputTokens: 100, duration: 9, copilotUsage: { totalNanoAiu: 6_070_000 } } });
          return { data: { content: '{"a":1}' } };
        },
        abort: async () => undefined,
        disconnect: async () => undefined,
      };
    }
  }
  const dir = mkdtempSync(join(tmpdir(), 'box-'));
  const t = sdkTransport(dir, async () => ({ CopilotClient }));
  const reply = await t.send({ model: 'gpt-6-luna', effort: 'low', system: 's', prompt: 'p', timeoutMs: 100, maxOutputTokens: 300 });
  assert.equal(reply.usage[0].credits, 0.00607);
  assert.equal(seen.session.modelCapabilities.limits.max_output_tokens, 300);
  assert.equal(seen.client.mode, 'empty');
  assert.equal(seen.client.workingDirectory, dir);
  assert.deepEqual(seen.session.availableTools, []);
  assert.equal(seen.session.systemMessage.mode, 'replace');
  assert.equal(seen.session.onPermissionRequest().kind, 'reject');
  assert.equal(seen.deleted, 's1');
  rmSync(dir, { recursive: true, force: true });
});

test('an answer that asks for a tool is refused', async () => {
  class CopilotClient {
    async start() {}
    async stop() {}
    async deleteSession() {}
    async createSession() {
      return { sessionId: 's', on: () => undefined, sendAndWait: async () => ({ data: { content: '', toolRequests: [{ name: 'bash' }] } }), abort: async () => undefined, disconnect: async () => undefined };
    }
  }
  const dir = mkdtempSync(join(tmpdir(), 'box-'));
  const t = sdkTransport(dir, async () => ({ CopilotClient }));
  await assert.rejects(t.send({ model: 'm', effort: 'low', system: 's', prompt: 'p', timeoutMs: 100, maxOutputTokens: 100 }), /tool/);
  rmSync(dir, { recursive: true, force: true });
});

test('a full queue means wait, an empty budget means rules', async () => {
  const f = fixture({ maxCallsPerMinute: 1 });
  await f.models.forAgent('luna', ROUTE).chat(MSG);
  assert.equal(f.models.busyForNow(), true);
  f.ledger.record(row(19.96, f.clock.now));
  assert.equal(f.models.busyForNow(), false);
  assert.equal(f.models.available(), false);
  f.done();
});

test('a hard decision thinks longer and the ledger shows it', async () => {
  const f = fixture();
  const client = f.models.forAgent('luna', ROUTE);
  await client.chat(MSG);
  await client.chat(MSG, { hard: true });
  assert.deepEqual(f.seen.map((r) => r.effort), ['low', 'medium']);
  assert.deepEqual(f.ledger.summary(0).map((r) => r.effort).sort(), ['low', 'medium']);
  f.done();
});

test('NPC conversations count against the same budget', async () => {
  const f = fixture();
  const client = f.models.forDialogue(ROUTE, 120);
  assert.equal(client.cfg.maxReplyChars, 120);
  await client.chat(MSG, { purpose: 'npc' });
  assert.equal(f.ledger.summary(0)[0].agentKey, 'npc');
  writeFileSync(f.stopFile, 'x');
  await assert.rejects(client.chat(MSG), /operator/);
  f.done();
});

test('several calls run at once up to the limit, and small talk gives way before decisions do', async () => {
  let running = 0;
  let peak = 0;
  const f = fixture({ maxConcurrent: 2, maxQueue: 4, maxCallsPerMinute: 8 }, async () => {
    running++;
    peak = Math.max(peak, running);
    await new Promise((r) => setTimeout(r, 15));
    running--;
    return { text: '{}', usage: [] };
  });
  const client = f.models.forAgent('kael', { provider: 'copilot', model: 'gpt-6-luna', effort: 'low' });
  assert.equal(client.spare?.(), true);
  const calls = [client.chat([{ role: 'user', content: 'a' }]), client.chat([{ role: 'user', content: 'b' }]), client.chat([{ role: 'user', content: 'c' }])];
  assert.equal(client.spare?.(), false, 'three waiting is more than small talk may add to');
  assert.equal(client.available?.(), true, 'a decision still gets through');
  await Promise.all(calls);
  assert.equal(peak, 2);
});
