import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { AgentRegistry, DEFAULT_AGENTS_PATH, validateAgentsDocument } from '../src/agents.ts';

const doc = JSON.parse(readFileSync(DEFAULT_AGENTS_PATH, 'utf8'));
const clone = () => JSON.parse(JSON.stringify(doc));

test('packages/contracts/agents.json is valid', () => {
  assert.deepEqual(validateAgentsDocument(doc), []);
  const reg = AgentRegistry.load();
  assert.deepEqual(reg.keys(), ['ardan', 'mira']);
  assert.equal(reg.get('ardan')!.key, 'ardan');
});

test('invalid definitions are reported precisely', () => {
  const bad = clone();
  bad.agents.ardan.spawn = 'nowhere';
  bad.agents.ardan.routes.montag_square.push('ghost');
  bad.agents.mira.behavior = { type: 'fight' };
  bad.agents.mira.texts.greetFirst = 'Dzień dobry'; // non-ASCII
  bad.agents.mira.alarm.zones = ['elsewhere'];
  const errors = validateAgentsDocument(bad);
  assert.ok(errors.includes('ardan: spawn must be a waypoint id'));
  assert.ok(errors.includes('ardan: route montag_square -> ghost'));
  assert.ok(errors.includes('mira: behavior.type'));
  assert.ok(errors.some((e) => e.startsWith('mira: texts.greetFirst')));
  assert.ok(errors.includes('mira: alarm zone elsewhere not in alarmZones'));
  assert.throws(() => new AgentRegistry(bad), /Invalid agent definitions/);
});

test('every agent can be added by data only: a minimal stationary agent validates', () => {
  const d = clone();
  d.agents.kael = {
    npcName: 'Kael', actor: 'npc', spawn: 'post', behavior: { type: 'stationary', home: 'post' },
    waypoints: { post: { x: 5012, y: 5006, z: 7 } }, routes: {},
    greeting: { words: ['hi'], range: 3 }, texts: { greetFallback: 'Czesc, {name}.' },
  };
  assert.deepEqual(validateAgentsDocument(d), []);
  assert.deepEqual(new AgentRegistry(d).keys(), ['ardan', 'kael', 'mira']);
});
