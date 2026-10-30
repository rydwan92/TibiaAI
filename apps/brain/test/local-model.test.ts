import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadLocalAiConfig, LocalModelClient, validateLocalAiConfig, type LocalAiConfig } from '../src/providers/local-model.ts';

const base = loadLocalAiConfig();
const cfg = (over: Partial<LocalAiConfig> = {}): LocalAiConfig => ({ ...base, ...over });

function fakeOllama(reply: string, delayMs = 0, seen: RequestInit[] = []): typeof fetch {
  return (async (_url: string, init: RequestInit) => {
    seen.push(init);
    if (delayMs) await new Promise((r) => setTimeout(r, delayMs));
    return new Response(JSON.stringify({ message: { content: reply }, eval_count: 5 }));
  }) as unknown as typeof fetch;
}

test('policy rejects anything that is not local', () => {
  assert.deepEqual(validateLocalAiConfig(base), []);
  assert.equal(base.think, false, 'thinking truncates structured output at the token limit');
  assert.ok(validateLocalAiConfig(cfg({ endpoint: 'https://ollama.com' })).some((e) => e.includes('loopback')));
  assert.ok(validateLocalAiConfig(cfg({ endpoint: 'http://192.168.0.5:11434' })).some((e) => e.includes('not loopback')));
  assert.ok(validateLocalAiConfig(cfg({ model: 'glm-5.2:cloud', allowedModels: ['glm-5.2:cloud'] })).some((e) => e.includes('cloud model')));
  assert.ok(validateLocalAiConfig(cfg({ model: 'other:1b' })).some((e) => e.includes('not in allowedModels')));
  assert.throws(() => new LocalModelClient(cfg({ endpoint: 'https://api.example.com' })), /Invalid local AI policy/);
});

test('a model Ollama reports as remote is refused even if its name looks local', async () => {
  const fake = (async () => new Response(JSON.stringify({ models: [{ name: base.model, remote_host: 'https://ollama.com:443' }] }))) as unknown as typeof fetch;
  await assert.rejects(new LocalModelClient(base, fake).verifyModel(), /runs remotely/);
  const missing = (async () => new Response(JSON.stringify({ models: [] }))) as unknown as typeof fetch;
  await assert.rejects(new LocalModelClient(base, missing).verifyModel(), /not installed/);
});

test('requests never follow redirects and carry no credentials', async () => {
  const seen: RequestInit[] = [];
  await new LocalModelClient(base, fakeOllama('{"say":"x"}', 0, seen)).chat([{ role: 'user', content: 'a' }]);
  assert.equal(seen[0].redirect, 'error');
  assert.equal(new Headers(seen[0].headers).get('authorization'), null);
});

test('oversized prompts are refused before reaching the model', async () => {
  const client = new LocalModelClient(base, fakeOllama('{"say":"x"}'));
  await assert.rejects(client.chat([{ role: 'user', content: 'x'.repeat(base.maxPromptChars + 1) }]), /prompt too long/);
});
