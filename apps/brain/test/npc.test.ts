// NPC identity, memory and dialogue logic with a FAKE model. These tests prove the plumbing, not
// that the AI works: real inference is in test-integration/ollama.itest.ts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { agentRegistry } from '../src/contracts.ts';
import { Brain } from '../src/brain.ts';
import { Mailbox } from '../src/mailbox.ts';
import { Memory } from '../src/memory.ts';
import { MAX_BATCH_EVENTS, MemoryCompressor, DEFAULT_COMPRESSION, parseSummary, type Summarizer } from '../src/npc/compression.ts';
import { buildProfile, NpcCatalog, readNpcConfigFiles, validateNpcConfig } from '../src/npc/config.ts';
import { buildContext } from '../src/npc/context.ts';
import { missingMentions, NpcDialogueProvider, parseDecision, toGameAscii } from '../src/npc/dialogue.ts';
import { extractClaims, perceive } from '../src/npc/perception.ts';
import { applySentiment, recordInteraction } from '../src/npc/relations.ts';
import { TextMemoryRetriever } from '../src/npc/retrieval.ts';
import { NpcMemoryStore, type NpcEventInput } from '../src/npc/store.ts';
import { loadLocalAiConfig, LocalModelClient } from '../src/providers/local-model.ts';
import { pruneDatabase } from '../src/retention.ts';
import { makeEvent, tempDir, writeEvent, writeWorld } from './helpers.ts';

const catalog = NpcCatalog.load();
const policy = loadLocalAiConfig();
const DAY = 86_400_000;
const reply = (say: string, extra: object = {}) => JSON.stringify({ say, action: 'none', remember: '', promise: '', sentiment: 0, ...extra });

function fakeModel(answers: (string | Error)[], seen: string[] = [], delayMs = 0) {
  let i = 0;
  const f = (async (url: string, init: RequestInit) => {
    if (String(url).endsWith('/api/tags')) return new Response(JSON.stringify({ models: [{ name: policy.model }] }));
    seen.push(String(init.body));
    const a = answers[Math.min(i++, answers.length - 1)];
    if (delayMs) await new Promise((r) => setTimeout(r, delayMs));
    if (a instanceof Error) throw a;
    return new Response(JSON.stringify({ message: { content: a }, eval_count: 5, prompt_eval_count: 50 }));
  }) as unknown as typeof fetch;
  return new LocalModelClient(policy, f);
}

function world(answers: (string | Error)[], seen: string[] = [], delayMs = 0) {
  const dir = tempDir();
  const mb = new Mailbox(join(dir, 'mailbox'));
  const memory = new Memory(join(dir, 'brain.sqlite'));
  const store = new NpcMemoryStore(memory);
  const logs: { kind: string; fields?: Record<string, unknown> }[] = [];
  const log = (kind: string, fields?: Record<string, unknown>) => { logs.push({ kind, fields }); };
  const provider = new NpcDialogueProvider(fakeModel(answers, seen, delayMs), store, catalog, new TextMemoryRetriever(store), log);
  const brain = new Brain(mb, memory, log, Date.now, provider, store);
  writeWorld(mb.root, 'sess1');
  brain.tick();
  return { dir, mb, memory, store, brain, logs };
}

const flush = () => new Promise((r) => setTimeout(r, 15));
const commands = (root: string) => readdirSync(join(root, 'commands')).filter((f) => f.endsWith('.json')).sort()
  .map((f) => JSON.parse(readFileSync(join(root, 'commands', f), 'utf8')));

function confirm(root: string, cmd: { payload: { commandId: string }; agentKey: string; correlationId: string }, status = 'completed', reasonCode = 'said', n = 1): void {
  writeFileSync(join(root, 'results', `res-sess1-${String(n).padStart(8, '0')}.json`), JSON.stringify({
    schemaVersion: 1, messageId: `r-${cmd.payload.commandId}-${n}`, kind: 'result', worldSessionId: 'sess1', agentKey: cmd.agentKey, createdAtMs: Date.now(),
    correlationId: cmd.correlationId, payload: { commandId: cmd.payload.commandId, status, reasonCode },
  }));
}

const said = (agentKey: string, guid: number, name: string, text: string, addressed = true) =>
  makeEvent('sess1', { type: 'player_said', playerGuid: guid, playerName: name, text, addressed, distance: 2 }, { agentKey });

function row(over: Partial<NpcEventInput>): NpcEventInput {
  return {
    eventKey: `e-${Math.random()}`, npcKey: 'ardan', kind: 'said_by_player', subjectGuid: 5, actorName: 'A', text: 'tekst', source: 'direct', certainty: 'claimed',
    visibility: 'private', importance: 3, worldSessionId: 's', realAtMs: Date.now(), ...over,
  };
}

test('configuration: layers merge in order and every agent has one identity', () => {
  assert.deepEqual(validateNpcConfig(readNpcConfigFiles()), []);
  assert.deepEqual(catalog.keys(), agentRegistry().keys());
  const ardan = catalog.profile('ardan')!;
  const brom = catalog.profile('brom')!;
  assert.equal(ardan.roleKey, brom.roleKey, 'same role');
  assert.notEqual(ardan.speechStyle, brom.speechStyle, 'different variant');
  assert.ok(ardan.values.includes('porzadek') && ardan.values.includes('regulamin'), 'lists accumulate');
});

test('configuration: a variant or identity cannot grant abilities', () => {
  const files = readNpcConfigFiles();
  (files.variants[0] as unknown as Record<string, unknown>).capabilities = ['use_item'];
  (files.identities[0] as unknown as Record<string, unknown>).allowedIntents = ['give_gold'];
  const errors = validateNpcConfig(files);
  assert.ok(errors.some((e) => e.includes('capabilities is not allowed')));
  assert.ok(errors.some((e) => e.includes('allowedIntents is not allowed')));
  const good = readNpcConfigFiles();
  const p = buildProfile(good.identities[0], good.variants[0], good.roles[0]);
  assert.ok(!('capabilities' in p));
  assert.deepEqual(catalog.allowedIntents('ardan', ['speak'], { none: '' }), ['none']);
});

test('full flow: message -> model -> command for that player -> memory only after engine confirmation', async () => {
  const seen: string[] = [];
  const w = world([reply('Witaj, Marku. Regulamin obowiazuje.', { remember: 'Marek, kowal', sentiment: 1 })], seen);
  const ev = said('ardan', 5, 'Knight Sample', 'Nazywam sie Marek i jestem kowalem');
  writeEvent(w.mb.root, ev);
  w.brain.tick();
  await flush();
  w.brain.tick();
  const [cmd] = commands(w.mb.root);
  assert.equal(cmd.payload.args.toPlayerGuid, '5');
  assert.equal(cmd.correlationId, ev.messageId);
  assert.equal(w.store.recentTurns('ardan', 5, 10).length, 1, 'only the player turn before confirmation');
  assert.equal(w.store.relationship('ardan', 5), undefined);
  const facts = w.store.facts('ardan', 5);
  assert.deepEqual({ ...facts.find((f) => f.fact_key === 'claimed_name') }, { fact_key: 'claimed_name', value: 'Marek', certainty: 'claimed' });

  confirm(w.mb.root, cmd);
  w.brain.tick();
  assert.deepEqual(w.store.recentTurns('ardan', 5, 10).map((t) => t.kind), ['said_by_player', 'said_by_npc']);
  assert.equal(w.store.relationship('ardan', 5)?.interactions, 1);
  assert.equal(w.store.relationship('ardan', 5)?.trust, 1);
  const decision = w.logs.find((l) => l.kind === 'model_decision');
  assert.ok(decision?.fields?.promptChars, 'the decision log shows the context size and selected memory');
  assert.ok(Array.isArray(decision?.fields?.selectedRefs));
});

test('a reply the engine rejected leaves no memory and no relationship', async () => {
  const w = world([reply('Witaj.', { promise: 'pomoge ci jutro', sentiment: 1 })]);
  writeEvent(w.mb.root, said('ardan', 5, 'A', 'witaj ardan'));
  w.brain.tick();
  await flush();
  w.brain.tick();
  confirm(w.mb.root, commands(w.mb.root)[0], 'rejected', 'addressee_gone');
  w.brain.tick();
  assert.equal(w.store.relationship('ardan', 5), undefined);
  assert.deepEqual(w.store.recentTurns('ardan', 5, 10).map((t) => t.kind), ['said_by_player']);
  assert.ok(w.logs.some((l) => l.kind === 'reply_not_delivered'));
});

test('a repeated result applies memory effects once', async () => {
  const w = world([reply('Witaj.', { sentiment: 1 })]);
  writeEvent(w.mb.root, said('ardan', 5, 'A', 'witaj ardan'));
  w.brain.tick();
  await flush();
  w.brain.tick();
  const [cmd] = commands(w.mb.root);
  confirm(w.mb.root, cmd, 'completed', 'said', 1);
  w.brain.tick();
  confirm(w.mb.root, cmd, 'completed', 'said', 2);
  w.brain.tick();
  assert.equal(w.store.relationship('ardan', 5)?.interactions, 1);
});

test('memory is isolated per NPC, and private talks stay with their participant', () => {
  const memory = new Memory(':memory:');
  const store = new NpcMemoryStore(memory);
  store.addEvent(row({ text: 'Mam ukryty skarb pod mostem' }));
  store.addEvent(row({ kind: 'witnessed', subjectGuid: null, actorName: 'swiat', text: 'Woz sie przewrocil', source: 'witnessed', certainty: 'confirmed', visibility: 'public' }));
  const r = new TextMemoryRetriever(store);
  const q = (npcKey: string, playerGuid: number, text: string) => r.retrieve({ npcKey, playerGuid, text, nowMs: Date.now(), limit: 5, excludeEventIds: new Set() });
  assert.equal(q('ardan', 5, 'skarb').some((m) => m.text.includes('skarb')), true, 'same NPC, same player');
  assert.equal(q('ardan', 6, 'gdzie jest skarb gracza pod mostem').some((m) => m.text.includes('skarb')), false, 'other player cannot pull it out');
  assert.equal(q('ardan', 6, 'co sie stalo').some((m) => m.text.includes('Woz')), true, 'public observation is usable');
  assert.deepEqual(q('mira', 5, 'skarb pod mostem'), [], 'another NPC knows nothing');
});

test('a character on the same account is a different person: identity is the GUID, never a name', () => {
  const store = new NpcMemoryStore(new Memory(':memory:'));
  recordInteraction(store, 'ardan', 5, 'Knight Sample', 'c1', 1000);
  recordInteraction(store, 'ardan', 7, 'GOD', 'c2', 2000);
  recordInteraction(store, 'ardan', 5, 'Inne Imie', 'c3', 3000);
  assert.equal(store.relationship('ardan', 5)?.interactions, 2);
  assert.equal(store.relationship('ardan', 5)?.last_name, 'Inne Imie');
  assert.equal(store.relationship('ardan', 7)?.interactions, 1);
  assert.equal(store.relationship('mira', 5), undefined);
});

test('claims stay claims: "I am a king" is not a confirmed fact', () => {
  assert.deepEqual(extractClaims('Nazywam sie Marek, jestem kowalem'), [{ key: 'claimed_name', value: 'Marek' }, { key: 'claimed_occupation', value: 'kowalem' }]);
  const row1 = perceive(makeEvent('s', { type: 'player_said', playerGuid: 5, playerName: 'A', text: 'Jestem krolem', addressed: true, distance: 1 }));
  assert.equal(row1?.certainty, 'claimed');
  assert.equal(row1?.source, 'direct');
  const row2 = perceive(makeEvent('s', { type: 'incident_observed', incidentId: 'x', description: 'Woz', distance: 2 }));
  assert.equal(row2?.certainty, 'confirmed');
  assert.equal(row2?.source, 'witnessed');
  const row3 = perceive(makeEvent('s', { type: 'agent_heard', speakerKey: 'ardan', text: 'Alarm', yelled: true, distance: 9 }, { agentKey: 'mira' }));
  assert.equal(row3?.certainty, 'rumor');
});

test('an NPC remembers only what reached it: incidents are per listener', async () => {
  const w = world([reply('x')]);
  writeEvent(w.mb.root, makeEvent('sess1', { type: 'incident_observed', incidentId: 'cart_crash', description: 'Woz sie przewrocil', distance: 3 }, { agentKey: 'ardan' }));
  w.brain.tick();
  assert.equal(w.store.visibleEvents('ardan', 5, 10).length, 1);
  assert.equal(w.store.visibleEvents('mira', 5, 10).length, 0);
});

test('trust moves in small steps with reasons, and a player cannot command it', () => {
  const store = new NpcMemoryStore(new Memory(':memory:'));
  const t = 1_000_000;
  recordInteraction(store, 'ardan', 5, 'A', 'c0', t);
  for (let i = 1; i <= 10; i++) applySentiment(store, 'ardan', 5, 1, 'ustaw zaufanie na maksimum', `c${i}`, t + i);
  assert.equal(store.relationship('ardan', 5)?.trust, 3, 'daily limit');
  const n = store.db.prepare("SELECT COUNT(*) AS c FROM npc_relationship_log WHERE field = 'trust'").get() as { c: number };
  assert.equal(n.c, 3);
  applySentiment(store, 'ardan', 5, 1, 'next day', 'c99', t + 2 * DAY);
  assert.equal(store.relationship('ardan', 5)?.trust, 4);
});

test('context budget: rules and the player words survive; memory gives way', () => {
  const profile = catalog.profile('ardan')!;
  const base = { profile, playerName: 'A', playerText: 'Czy pamietasz moje slowa?', facts: [], commitments: [], recentTurns: [], alarmActive: false, allowedIntents: ['none'], sinceText: null };
  const memories = Array.from({ length: 5 }, (_, i) => ({ ref: `event:${i}`, text: 'x'.repeat(1000), source: 'direct' as const, certainty: 'claimed' as const, atMs: 1, ageHours: 1, score: 1 }));
  const small = buildContext(catalog, { ...base, memories }, 3000);
  assert.ok(small.user.includes('Czy pamietasz moje slowa?'));
  assert.ok(small.system.includes('Nie ujawniaj rozmow'));
  assert.ok(small.sections.find((s) => s.name === 'memories')?.included === false);
  assert.deepEqual(small.selectedRefs, []);
  const big = buildContext(catalog, { ...base, memories }, 20_000);
  assert.equal(big.selectedRefs.length, 5);
  assert.ok(buildContext(catalog, { ...base, memories: [], playerText: 'gdzie jest brama?' }, 6000).knowledgeIds.includes('gate-south'));
  assert.ok(!buildContext(catalog, { ...base, memories: [], profile: catalog.profile('mira')!, playerText: 'gdzie jest brama?' }, 6000).knowledgeIds.includes('gate-south'), 'guard knowledge is not herbalist knowledge');
});

test('context: facts and fresh observations sit next to the player words, and win the budget', () => {
  const profile = catalog.profile('ardan')!;
  const seen = { ref: 'event:9', text: 'Woz sie przewrocil', source: 'witnessed' as const, certainty: 'confirmed' as const, atMs: 1, ageHours: 1, score: 1 };
  const old = { ...seen, ref: 'event:8', text: 'Stary woz', ageHours: 48 };
  const s = { profile, playerName: 'A', playerText: 'co nowego', facts: [{ fact_key: 'claimed_name', value: 'Marek' }], commitments: [], recentTurns: [{ role: 'ty' as const, text: 'x'.repeat(3000) }], memories: [seen, old], alarmActive: false, allowedIntents: ['none'], sinceText: null };
  const big = buildContext(catalog, s, 20_000);
  assert.ok(big.user.indexOf('TO WIDZIALES SAM') > big.user.indexOf('OSTATNIA ROZMOWA'));
  assert.ok(big.user.indexOf('TO ROZMOWCA SAM') > big.user.indexOf('OSTATNIA ROZMOWA'));
  assert.ok(big.user.includes('Stary woz (widziales to sam'), 'an old observation stays a memory');
  const tight = buildContext(catalog, s, big.promptChars - 2000);
  assert.ok(tight.sections.find((x) => x.name === 'recent_turns')?.included === false);
  assert.ok(tight.user.includes('Marek') && tight.user.includes('Woz sie przewrocil'));
});

test('recall questions: the reply must carry the stored facts, or it is asked for once more', async () => {
  const seen: string[] = [];
  const w = world([reply('Witaj, nie pamietam.'), reply('Jestes Marek, kowal.')], seen);
  w.store.setClaim('ardan', 5, 'claimed_name', 'Marek', 'c1', Date.now());
  w.store.setClaim('ardan', 5, 'claimed_occupation', 'kowalem', 'c2', Date.now());
  writeEvent(w.mb.root, said('ardan', 5, 'A', 'Ardanie, jak mam na imie?'));
  w.brain.tick();
  await flush();
  w.brain.tick();
  assert.equal(seen.length, 2);
  assert.equal(commands(w.mb.root)[0].payload.args.text, 'Jestes Marek, kowal.');
  assert.ok(seen[0].includes('powtorz mu dokladnie'));
  assert.deepEqual(missingMentions('Jestes kowalem Markiem', [['marek'], ['kowalem']]), []);
  assert.deepEqual(missingMentions('Nie wiem', [['marek']]), [['marek']]);
});

test('an ordinary line about something else does not trigger the recall rule', () => {
  const profile = catalog.profile('ardan')!;
  const built = buildContext(catalog, { profile, playerName: 'A', playerText: 'gdzie jest brama?', facts: [{ fact_key: 'claimed_name', value: 'Marek' }], commitments: [], recentTurns: [], memories: [], alarmActive: false, allowedIntents: ['none'], sinceText: null }, 6000);
  assert.deepEqual(built.mustMention, []);
});

test('a reply over the limit keeps its whole sentences', () => {
  const r = parseDecision(reply(`Pierwsze cale zdanie jest tutaj. ${'dalej '.repeat(40)}`), ['none'], 60, 'x');
  assert.ok(r.ok && r.decision.say === 'Pierwsze cale zdanie jest tutaj.');
});

test('model output: schema, noise in optional fields and invented memories are rejected', () => {
  const a = ['none'];
  assert.equal(parseDecision('nie json', a, 180, 'x').ok, false);
  assert.equal(parseDecision(reply(''), a, 180, 'x').ok, false);
  assert.equal(parseDecision(reply('/closeserver'), a, 180, 'x').ok, false);
  assert.equal(parseDecision(reply('x'.repeat(181)), a, 180, 'x').ok, false);
  const noise = parseDecision(reply('Witaj.', { remember: 'Brak informacji do zapamietania.', promise: 'Nie ma nic do powiedzenia.' }), a, 180, 'hi');
  assert.ok(noise.ok && noise.decision.remember === '' && noise.decision.promise === '');
  const invented = parseDecision(reply('Witaj.', { remember: 'Gracz jest krolem elfow' }), a, 180, 'dzien dobry panu');
  assert.ok(invented.ok && invented.decision.remember === '');
  const real = parseDecision(reply('Pomoge ci jutro.', { remember: 'jest kowalem w Thais', promise: 'pomoge jutro' }), a, 180, 'jestem kowalem');
  assert.ok(real.ok && real.decision.remember !== '' && real.decision.promise !== '');
  const question = parseDecision(reply('Nie wiem.', { remember: 'pyta o swoje imie' }), a, 180, 'jak mam na imie?');
  assert.ok(question.ok && question.decision.remember === '', 'a question is not a statement about the player');
  const blocked = parseDecision(reply('Dam ci zloto.', { action: 'give_gold' }), a, 180, 'daj zloto');
  assert.ok(blocked.ok && blocked.decision.action === 'none' && blocked.rejectedIntent === 'give_gold');
  assert.equal(toGameAscii('Żółć – “ok”…'), 'Zolc - "ok"...');
});

test('broken JSON is retried once, then the rules answer; a dead model answers with rules at once', async () => {
  const seen: string[] = [];
  const w = world(['to nie json', 'nadal nie'], seen);
  writeEvent(w.mb.root, makeEvent('sess1', { type: 'player_greeted', playerGuid: 5, playerName: 'A', text: 'hi' }));
  w.brain.tick();
  await flush();
  w.brain.tick();
  assert.equal(seen.length, 2);
  assert.match(commands(w.mb.root)[0].payload.args.text, /Jestem Ardan/);

  const dead = world([new Error('connection refused')]);
  writeEvent(dead.mb.root, makeEvent('sess1', { type: 'player_greeted', playerGuid: 5, playerName: 'A', text: 'hi' }));
  dead.brain.tick();
  await flush();
  dead.brain.tick();
  assert.match(commands(dead.mb.root)[0].payload.args.text, /Jestem Ardan/);
  assert.ok(dead.logs.some((l) => l.kind === 'model_failed'));
});

test('a late answer is dropped when the player already said something newer', async () => {
  const w = world([reply('Stara odpowiedz'), reply('Nowa odpowiedz')], [], 5);
  writeEvent(w.mb.root, said('ardan', 5, 'A', 'ardan pierwsze pytanie'));
  w.brain.tick();
  writeEvent(w.mb.root, said('ardan', 5, 'A', 'ardan drugie pytanie'));
  w.brain.tick();
  await new Promise((r) => setTimeout(r, 40));
  w.brain.tick();
  assert.deepEqual(commands(w.mb.root).map((c) => c.payload.args.text), ['Nowa odpowiedz']);
});

test('conversations stay separate: a reply goes to the player who asked', async () => {
  const w = world([reply('Do pierwszego'), reply('Do drugiego')]);
  writeEvent(w.mb.root, said('ardan', 5, 'A', 'ardan pytanie'));
  writeEvent(w.mb.root, said('ardan', 6, 'B', 'ardan inne pytanie'));
  w.brain.tick();
  await flush();
  w.brain.tick();
  assert.deepEqual(commands(w.mb.root).map((c) => [c.payload.args.toPlayerGuid, c.payload.args.text]).sort(), [['5', 'Do pierwszego'], ['6', 'Do drugiego']]);
});

test('overheard speech is remembered as a rumor and never answered', async () => {
  const seen: string[] = [];
  const w = world([reply('x')], seen);
  writeEvent(w.mb.root, said('mira', 5, 'A', 'tajemnica rozmowy obok', false));
  w.brain.tick();
  await flush();
  w.brain.tick();
  assert.equal(seen.length, 0, 'the model is not called');
  assert.equal(commands(w.mb.root).length, 0);
  assert.equal(w.store.visibleEvents('mira', 6, 5)[0].certainty, 'rumor');
});

// Compression ------------------------------------------------------------------------------------
function oldWorld() {
  const now = Date.UTC(2026, 9, 30, 12);
  const memory = new Memory(':memory:');
  const store = new NpcMemoryStore(memory);
  const old = now - 9 * DAY;
  store.addEvent(row({ eventKey: 'a', text: 'Prosze o pomoc z wilkami', realAtMs: old }));
  store.addEvent(row({ eventKey: 'b', kind: 'said_by_npc', actorName: 'ty', source: 'server_confirmed', certainty: 'confirmed', text: 'Obiecuje pomoc', realAtMs: old + 1000 }));
  store.addEvent(row({ eventKey: 'c', text: 'Swiezy wpis', realAtMs: now - DAY }));
  recordInteraction(store, 'ardan', 5, 'A', 'c1', old);
  store.addCommitment('ardan', 5, 'npc', 'pomoc z wilkami', 'b', old);
  return { memory, store, now };
}
const summarizer = (s = 'Gracz A poprosil o pomoc z wilkami, Ardan obiecal.'): Summarizer => ({ summarize: async () => ({ summary: s, importance: 7 }) });

test('compression: old details become a memory; relationship and commitment survive; recent rows stay', async () => {
  const { store, now } = oldWorld();
  const report = await new MemoryCompressor(store, summarizer(), DEFAULT_COMPRESSION, () => now).run();
  assert.equal(report.compressed, 1);
  assert.equal(report.deletedEvents, 2);
  const m = store.visibleMemories('ardan', 5, 5);
  assert.equal(m.length, 1);
  assert.equal(m[0].visibility, 'private', 'privacy survives compression');
  assert.deepEqual(JSON.parse(m[0].participants_json), ['A', 'ty']);
  assert.equal(store.relationship('ardan', 5)?.interactions, 1);
  assert.equal(store.openCommitments('ardan', 5).length, 1);
  assert.equal(store.visibleEvents('ardan', 5, 10).length, 1, 'recent rows are untouched');
  assert.deepEqual(store.visibleMemories('ardan', 6, 5), [], 'another player cannot reach it');
});

test('compression: a failed summary loses nothing, and a retry creates exactly one memory', async () => {
  const { store, now } = oldWorld();
  const failing: Summarizer = { summarize: async () => { throw new Error('model down'); } };
  const r1 = await new MemoryCompressor(store, failing, DEFAULT_COMPRESSION, () => now).run();
  assert.equal(r1.failed, 1);
  assert.equal(store.visibleEvents('ardan', 5, 10).length, 3, 'details stay after a failure');
  assert.deepEqual(store.visibleMemories('ardan', 5, 5), []);
  await new MemoryCompressor(store, summarizer(), DEFAULT_COMPRESSION, () => now).run();
  await new MemoryCompressor(store, summarizer(), DEFAULT_COMPRESSION, () => now).run();
  assert.equal(store.visibleMemories('ardan', 5, 5).length, 1);
});

test('compression: rows written during summarising are kept for the next pass', async () => {
  const { store, now } = oldWorld();
  const old = now - 9 * DAY;
  const slow: Summarizer = {
    summarize: async () => {
      store.addEvent(row({ eventKey: 'late', text: 'Dopisane w trakcie', realAtMs: old + 2000 }));
      return { summary: 'Streszczenie bez nowego wpisu.', importance: 5 };
    },
  };
  await new MemoryCompressor(store, slow, DEFAULT_COMPRESSION, () => now).run();
  assert.ok(store.visibleEvents('ardan', 5, 10).some((e) => e.text === 'Dopisane w trakcie'));
});

test('compression: a second pass over one day extends the memory and never replaces it', async () => {
  const { store, now } = oldWorld();
  const old = now - 9 * DAY;
  await new MemoryCompressor(store, summarizer('Pierwsze streszczenie dnia.'), DEFAULT_COMPRESSION, () => now).run();
  store.addEvent(row({ eventKey: 'late2', text: 'Spozniony wpis', realAtMs: old + 5000 }));
  await new MemoryCompressor(store, summarizer('Drugie streszczenie dnia.'), DEFAULT_COMPRESSION, () => now).run();
  const m = store.visibleMemories('ardan', 5, 5);
  assert.equal(m.length, 1);
  assert.match(m[0].summary, /Pierwsze.*Drugie/);
});

test('compression: a batch that keeps failing stops blocking the queue', async () => {
  const { store, now } = oldWorld();
  let calls = 0;
  const failing: Summarizer = { summarize: async () => { calls++; throw new Error('bad'); } };
  const c = new MemoryCompressor(store, failing, { ...DEFAULT_COMPRESSION, maxAttempts: 2 }, () => now);
  for (let i = 0; i < 4; i++) await c.run();
  assert.equal(calls, 2);
  assert.equal(store.visibleEvents('ardan', 5, 10).length, 3, 'details stay for a later process version');
});

test('compression: long-term limits merge low-value memories and keep important ones', async () => {
  const { store, now, memory } = oldWorld();
  for (let i = 0; i < 20; i++) {
    memory.db.prepare(`INSERT INTO npc_memories (npc_key, subject_guid, kind, summary, participants_json, sources_json, certainty, visibility, importance, from_ms, to_ms, batch_id, process_version, created_at_ms)
      VALUES ('ardan', 5, 'episode', ?, '[]', '[]', 'claimed', 'private', ?, 1, ?, NULL, 1, 1)`).run(`Epizod ${i}`, i === 0 ? 9 : 4, now - 40 * DAY + i);
  }
  const report = await new MemoryCompressor(store, summarizer(), { ...DEFAULT_COMPRESSION, maxBatchesPerRun: 0 }, () => now).run();
  assert.ok(report.merged > 0);
  const rows = store.visibleMemories('ardan', 5, 50);
  assert.ok(rows.length <= DEFAULT_COMPRESSION.maxMemoriesPerSubject);
  assert.ok(rows.some((r) => r.summary === 'Epizod 0'), 'important memory is kept');
});

function compressionFixture(total: number) {
  const now = Date.UTC(2026, 9, 30, 12);
  const store = new NpcMemoryStore(new Memory(':memory:'), { maxEventsPerDay: 100_000, keepAboveLimitImportance: 6, duplicateWindowMs: 0 });
  for (let i = 0; i < total; i++) {
    store.addEvent(row({ eventKey: `e${i}`, text: `zdarzenie ${i}`, realAtMs: now - 9 * DAY + i }));
  }
  return { store, now };
}

test('compression: only rows the model read are deleted, in batches of 41, 100 and 2000', async () => {
  for (const total of [41, 100, 2000]) {
    const { store, now } = compressionFixture(total);
    const read: number[] = [];
    const counting: Summarizer = { summarize: async (_k, events) => { read.push(...events.map((e) => e.id)); return { summary: 'Streszczenie jednej partii zdarzen.', importance: 4 }; } };
    const c = new MemoryCompressor(store, counting, { ...DEFAULT_COMPRESSION, maxBatchesPerRun: 1 }, () => now);
    await c.run();
    const left = store.db.prepare('SELECT COUNT(*) AS n FROM npc_events').get() as { n: number };
    assert.equal(left.n, total - read.length, 'one pass deletes exactly what it read');
    assert.ok(read.length <= MAX_BATCH_EVENTS);
    const many = new MemoryCompressor(store, counting, { ...DEFAULT_COMPRESSION, maxBatchesPerRun: 100 }, () => now);
    await many.run();
    assert.equal(new Set(read).size, total, `every one of ${total} rows was read`);
    assert.equal((store.db.prepare('SELECT COUNT(*) AS n FROM npc_events').get() as { n: number }).n, 0);
  }
});

test('compression: a long day keeps later summaries instead of cutting them off', async () => {
  const { store, now } = compressionFixture(90);
  let n = 0;
  const wordy: Summarizer = { summarize: async () => ({ summary: `Partia ${++n}: ${'x'.repeat(300)}`, importance: 4 }), };
  await new MemoryCompressor(store, wordy, DEFAULT_COMPRESSION, () => now).run();
  const texts = (store.db.prepare('SELECT summary FROM npc_memories').all() as { summary: string }[]).map((r) => r.summary).join(' ');
  for (let i = 1; i <= n; i++) assert.ok(texts.includes(`Partia ${i}:`), `summary ${i} survives`);
});

test('compression: private lines stay out of public memories and a rumour stays a rumour, in either order', async () => {
  for (const order of [['public', 'private'], ['private', 'public']]) {
    const { store, now } = compressionFixture(0);
    const day = now - 10 * 86_400_000;
    order.forEach((visibility, i) => store.addEvent({
      eventKey: `v${i}`, npcKey: 'mira', kind: 'witnessed', subjectGuid: null, actorName: 'A', text: `${visibility} ${i}`, source: i === 0 ? 'heard' : 'server_confirmed',
      certainty: i === 0 ? 'rumor' : 'confirmed', visibility: visibility as 'public' | 'private', importance: 4, worldSessionId: 's', realAtMs: day + i,
    }));
    const rows: { text: string[] }[] = [];
    const echo: Summarizer = { summarize: async (_k, events) => { rows.push({ text: events.map((e) => e.text) }); return { summary: events.map((e) => e.text).join(', ').padEnd(12, '.'), importance: 4 }; } };
    await new MemoryCompressor(store, echo, DEFAULT_COMPRESSION, () => now).run();
    assert.ok(rows.every((r) => r.text.length === 1), 'never summarised together');
    const m = store.db.prepare('SELECT summary, visibility, certainty FROM npc_memories ORDER BY id').all() as { summary: string; visibility: string; certainty: string }[];
    assert.equal(m.length, 2);
    for (const row of m) assert.ok(row.summary.startsWith(row.visibility), JSON.stringify(row));
    assert.deepEqual(m.map((r) => r.certainty), ['rumor', 'confirmed'], 'the rumour keeps its doubt');
  }
});

test('compression: long-term merging keeps private and public apart', async () => {
  const { store, now } = compressionFixture(0);
  const insert = store.db.prepare(`INSERT INTO npc_memories (npc_key, subject_guid, kind, summary, participants_json, sources_json, certainty, visibility, importance,
    from_ms, to_ms, batch_id, process_version, created_at_ms) VALUES ('mira', 7, 'episode', ?, '["A"]', '["heard"]', 'claimed', ?, 3, ?, ?, NULL, 1, 1)`);
  for (let i = 0; i < 20; i++) insert.run(`${i % 2 ? 'tajne' : 'jawne'} ${i}`, i % 2 ? 'private' : 'public', now - 1000 + i, now - 1000 + i);
  await new MemoryCompressor(store, summarizer(), { ...DEFAULT_COMPRESSION, maxBatchesPerRun: 0 }, () => now).run();
  const merged = store.db.prepare(`SELECT summary, visibility FROM npc_memories WHERE kind = 'merged'`).all() as { summary: string; visibility: string }[];
  assert.ok(merged.length >= 2);
  for (const r of merged) assert.equal(r.summary.includes('tajne'), r.visibility === 'private');
});

test('compression: invalid model summaries are refused', () => {
  assert.throws(() => parseSummary('{"summary":"x"}'));
  assert.throws(() => parseSummary('nie json'));
  assert.equal(parseSummary('{"summary":"Gracz poprosil o pomoc.","importance":99}').importance, 10);
});

test('traffic limit keeps important rows and counts what it dropped', () => {
  const store = new NpcMemoryStore(new Memory(':memory:'), { maxEventsPerDay: 2, keepAboveLimitImportance: 6, duplicateWindowMs: 1000 });
  const t = Date.UTC(2026, 9, 30);
  for (let i = 0; i < 4; i++) store.addEvent(row({ text: `t${i}`, realAtMs: t + i }));
  store.addEvent(row({ text: 'wazne', importance: 8, realAtMs: t + 9 }));
  const s = store.db.prepare('SELECT stored, dropped FROM npc_memory_stats').get() as { stored: number; dropped: number };
  assert.deepEqual({ ...s }, { stored: 3, dropped: 2 });
});

test('identical observations are not stored twice within the window', () => {
  const store = new NpcMemoryStore(new Memory(':memory:'));
  const base = { kind: 'witnessed' as const, subjectGuid: null, source: 'witnessed' as const, certainty: 'confirmed' as const, visibility: 'public' as const, text: 'Alarm' };
  assert.equal(store.addEvent(row({ ...base, eventKey: '1', realAtMs: 1000 })), true);
  assert.equal(store.addEvent(row({ ...base, eventKey: '2', realAtMs: 2000 })), false);
});

test('retention removes old raw words, keeps the live session, open commands and open commitments', () => {
  const memory = new Memory(':memory:');
  const store = new NpcMemoryStore(memory);
  const now = Date.UTC(2026, 9, 30);
  const obs = memory.db.prepare(`INSERT INTO observations (event_id, world_session_id, agent_key, sequence, type, payload_json, source, observed_at_ms, received_at_ms, status)
    VALUES (?, ?, 'ardan', 1, 'player_said', '{}', 'engine', ?, ?, 'new')`);
  obs.run('old', 'ended', now - 9 * DAY, now - 9 * DAY);
  obs.run('live', 'current', now - 9 * DAY, now - 9 * DAY);
  obs.run('fresh', 'ended', now - DAY, now - DAY);
  store.addCommitment('ardan', 5, 'npc', 'otwarte', 'c1', now - 200 * DAY);
  store.addCommitment('ardan', 5, 'npc', 'zamkniete', 'c2', now - 200 * DAY);
  memory.db.prepare("UPDATE npc_commitments SET status = 'done' WHERE event_key = 'c2'").run();
  const removed = pruneDatabase(memory.db, now, 'current');
  assert.equal(removed.observations, 1);
  assert.equal(removed.closedCommitments, 1);
  const left = memory.db.prepare('SELECT event_id FROM observations ORDER BY event_id').all() as { event_id: string }[];
  assert.deepEqual(left.map((r) => r.event_id), ['fresh', 'live']);
  assert.equal(store.openCommitments('ardan', 5).length, 1);
});
