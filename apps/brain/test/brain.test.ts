import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Brain } from '../src/brain.ts';
import { Mailbox } from '../src/mailbox.ts';
import { Memory } from '../src/memory.ts';
import { agentRegistry } from '../src/contracts.ts';
import { RulesProvider, sinceText } from '../src/providers/rules.ts';
import { makeEvent, tempDir, writeEvent, writeWorld } from './helpers.ts';

const quiet = () => {};

function commands(root: string) {
  return readdirSync(join(root, 'commands')).filter((f) => f.endsWith('.json')).sort()
    .map((f) => JSON.parse(readFileSync(join(root, 'commands', f), 'utf8')));
}

test('greeting event produces one say command correlated to the event', () => {
  const dir = tempDir();
  const mb = new Mailbox(join(dir, 'mailbox'));
  const brain = new Brain(mb, new Memory(join(dir, 'brain.sqlite')), quiet);
  writeWorld(mb.root, 'sessA', 3);
  const ev = makeEvent('sessA', { type: 'player_greeted', playerGuid: 7, playerName: 'GOD', text: 'hi' });
  writeEvent(mb.root, ev);
  brain.tick();
  const cmds = commands(mb.root);
  assert.equal(cmds.length, 1);
  assert.equal(cmds[0].correlationId, ev.messageId);
  assert.equal(cmds[0].payload.action, 'say');
  assert.match(cmds[0].payload.args.text, /Nie widzialem cie/);
  assert.ok(readdirSync(join(mb.root, 'commands')).includes('cmd-sessA-00000003.json'), 'uses next seq from world.json');
});

test('duplicate event id is stored once and answered once', () => {
  const dir = tempDir();
  const mb = new Mailbox(join(dir, 'mailbox'));
  const brain = new Brain(mb, new Memory(join(dir, 'brain.sqlite')), quiet);
  writeWorld(mb.root, 'sessB');
  const ev = makeEvent('sessB', { type: 'player_greeted', playerGuid: 9, playerName: 'Tester', text: 'hello' });
  writeEvent(mb.root, ev);
  brain.tick();
  writeEvent(mb.root, ev); // same messageId and sequence delivered again
  brain.tick();
  assert.equal(commands(mb.root).length, 1);
});

test('events from an old world session are remembered but never answered', () => {
  const dir = tempDir();
  const mb = new Mailbox(join(dir, 'mailbox'));
  const memory = new Memory(join(dir, 'brain.sqlite'));
  const brain = new Brain(mb, memory, quiet);
  writeWorld(mb.root, 'sessNew');
  writeEvent(mb.root, makeEvent('sessOld', { type: 'player_greeted', playerGuid: 5, playerName: 'Old', text: 'hi' }));
  brain.tick();
  assert.equal(commands(mb.root).length, 0);
  const row = memory.db.prepare("SELECT status FROM observations WHERE world_session_id = 'sessOld'").get() as { status: string };
  assert.equal(row.status, 'stale');
});

test('old observations are stored but not answered', () => {
  const dir = tempDir();
  const mb = new Mailbox(join(dir, 'mailbox'));
  const memory = new Memory(join(dir, 'brain.sqlite'));
  const brain = new Brain(mb, memory, quiet);
  writeWorld(mb.root, 'sessE');
  brain.tick();
  writeEvent(mb.root, makeEvent('sessE', { type: 'player_greeted', playerGuid: 3, playerName: 'Late', text: 'hi' }, { createdAtMs: Date.now() - 60_000 }));
  brain.tick();
  assert.equal(commands(mb.root).length, 0);
  assert.equal(memory.encounterStats('ardan', 3).count, 1, 'encounter is still remembered');
});

test('memory survives a Brain restart and recognises the player GUID', () => {
  const dir = tempDir();
  const dbFile = join(dir, 'brain.sqlite');
  const mb = new Mailbox(join(dir, 'mailbox'));
  writeWorld(mb.root, 'sessC');
  const first = new Memory(dbFile);
  new Brain(mb, first, quiet).tick();
  writeEvent(mb.root, makeEvent('sessC', { type: 'player_greeted', playerGuid: 42, playerName: 'Knight Sample', text: 'hi' }));
  new Brain(mb, first, quiet).tick();
  first.close();

  const second = new Memory(dbFile); // simulated restart: new process, same SQLite file
  const brain2 = new Brain(mb, second, quiet);
  writeEvent(mb.root, makeEvent('sessC', { type: 'player_greeted', playerGuid: 42, playerName: 'Knight Sample', text: 'witaj' }));
  brain2.tick();
  const texts = commands(mb.root).map((c) => c.payload.args.text);
  assert.equal(texts.length, 2);
  assert.match(texts[1], /Znowu ty, Knight Sample\. To nasze 2\. spotkanie/);
});

test('engine results update command status; duplicates do not overwrite it', () => {
  const dir = tempDir();
  const mb = new Mailbox(join(dir, 'mailbox'));
  const memory = new Memory(join(dir, 'brain.sqlite'));
  const brain = new Brain(mb, memory, quiet);
  writeWorld(mb.root, 'sessD');
  brain.tick();
  const commandId = brain.sendCommand('sessD', 'ardan', 'corr-1', 'move_to', { waypointId: 'gate_watch' }, 1, Date.now());
  assert.ok(commandId);
  const result = (id: string, status: string, reasonCode: string, duplicate = false) => ({
    schemaVersion: 1, messageId: id, kind: 'result', worldSessionId: 'sessD', agentKey: 'ardan', createdAtMs: Date.now(),
    correlationId: 'corr-1', payload: { commandId, status, reasonCode, duplicate },
  });
  writeFileSync(join(mb.root, 'results', 'res-sessD-00000001.json'), JSON.stringify(result('r1', 'accepted', 'moving')));
  writeFileSync(join(mb.root, 'results', 'res-sessD-00000002.json'), JSON.stringify(result('r2', 'failed', 'no_path')));
  writeFileSync(join(mb.root, 'results', 'res-sessD-00000003.json'), JSON.stringify(result('r3', 'accepted', 'moving', true)));
  brain.tick();
  assert.deepEqual({ ...memory.commandStatus(commandId!) }, { status: 'failed', reason_code: 'no_path' });
});

test('rules: persona texts come from the agent definition', () => {
  const now = Date.now();
  const rules = new RulesProvider();
  const ardan = agentRegistry().get('ardan')!;
  const mira = agentRegistry().get('mira')!;
  const ev = makeEvent('s', { type: 'player_greeted', playerGuid: 1, playerName: 'Ann<script>', text: 'hi' });
  assert.match(rules.decide(ev, { agent: ardan, nowMs: now })[0].text, /^Witaj, Annscript\. Jestem Ardan/);
  assert.match(rules.decide(ev, { agent: ardan, nowMs: now, encounterBefore: { count: 2, lastAtMs: now - 3 * 3600_000 } })[0].text,
    /3\. spotkanie, ostatnio 3 h temu/);
  assert.match(rules.decide({ ...ev, agentKey: 'mira' }, { agent: mira, nowMs: now })[0].text, /Jestem Mira/);
  const alarm = makeEvent('s', { type: 'training_alarm_started', zoneId: 'montag_gate' });
  assert.equal(rules.decide(alarm, { agent: ardan, nowMs: now, alarmsThisSession: 2 })[0].delayMs, 4000);
  assert.deepEqual(rules.decide(alarm, { agent: mira, nowMs: now }), [], 'empty alarmComment means no reply');
  assert.equal(sinceText(now - 30_000, now), 'przed chwila');
});

test('alarm count is per agent', () => {
  const dir = tempDir();
  const mb = new Mailbox(join(dir, 'mailbox'));
  const brain = new Brain(mb, new Memory(join(dir, 'brain.sqlite')), quiet);
  writeWorld(mb.root, 'sessF');
  brain.tick();
  writeEvent(mb.root, makeEvent('sessF', { type: 'training_alarm_started', zoneId: 'montag_gate' }, { agentKey: 'mira' }));
  writeEvent(mb.root, makeEvent('sessF', { type: 'training_alarm_started', zoneId: 'montag_gate' }));
  let t = Date.now();
  const late = new Brain(mb, new Memory(join(dir, 'brain.sqlite')), quiet, () => t);
  late.tick();
  t += 5000; // past the alarm comment delay
  late.tick();
  const texts = commands(mb.root).map((c) => `${c.agentKey}:${c.payload.args.text}`);
  assert.deepEqual(texts, ['ardan:To 1. alarm cwiczebny w tej zmianie. Zachowajcie spokoj.']);
});

function commandFixture() {
  const dir = tempDir();
  const mailbox = new Mailbox(join(dir, 'mailbox'));
  const memory = new Memory(join(dir, 'brain.sqlite'));
  return { mailbox, memory, brain: new Brain(mailbox, memory, quiet) };
}

test('a command that cannot be written spends no number, so Lua is never left waiting', () => {
  const { brain, mailbox, memory } = commandFixture();
  const real = mailbox.writeCommand.bind(mailbox);
  mailbox.writeCommand = () => { throw new Error('disk full'); };
  assert.equal(brain.sendCommand('sessZ', 'ardan', 'c1', 'stop', {}, 1, Date.now()), null);
  assert.equal(memory.maxCommandSeq('sessZ'), 0, 'the failed attempt left no row');
  mailbox.writeCommand = real;
  assert.ok(brain.sendCommand('sessZ', 'ardan', 'c2', 'stop', {}, 1, Date.now()));
  assert.equal(memory.maxCommandSeq('sessZ'), 1, 'the next command takes the same number');
});

test('reply effects and their marker commit together: a failure retries and applies once', () => {
  const { memory } = commandFixture();
  const env = { schemaVersion: 1, messageId: 'm', kind: 'command', worldSessionId: 's', agentKey: 'mira', createdAtMs: 1, correlationId: 'c', payload: { commandId: 'cmd', planRevision: 0, expiresAtMs: 2, action: 'say', args: { text: 'hej' } } };
  memory.insertCommand(env as never, 1, { playerGuid: 1 });
  assert.throws(() => memory.tx(() => {
    memory.tx(() => memory.markPlanApplied('cmd'));
    throw new Error('crash before commit');
  }));
  assert.ok(memory.pendingPlan('cmd', 'completed'), 'the marker rolled back with the effects');
  memory.tx(() => memory.markPlanApplied('cmd'));
  assert.equal(memory.pendingPlan('cmd', 'completed'), null, 'applied exactly once');
});
