import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildTimeline, parseJsonLines } from '../src/timeline.ts';

const world = [
  { ts: '2026-10-29T22:47:46Z', kind: 'event', agentKey: 'ardan', eventType: 'training_alarm_started', eventId: 'E1', delivered: true, payload: { type: 'training_alarm_started', zoneId: 'montag_gate' } },
  { ts: '2026-10-29T22:47:46Z', kind: 'state_changed', agentKey: 'ardan', from: 'PATROL', to: 'ALERT' },
  { ts: '2026-10-29T22:47:50Z', kind: 'command_accepted', agentKey: 'ardan', commandId: 'C1', correlationId: 'E1', action: 'say', planRevision: 0 },
  { ts: '2026-10-29T22:47:50Z', kind: 'npc_said', agentKey: 'ardan', text: 'To 2. alarm', source: 'brain', commandId: 'C1', correlationId: 'E1' },
  { ts: '2026-10-29T22:47:50Z', kind: 'command_result', agentKey: 'ardan', commandId: 'C1', status: 'completed', reasonCode: 'said' },
  { ts: '2026-10-29T22:48:00Z', kind: 'event', agentKey: 'mira', eventType: 'player_greeted', delivered: false, payload: { type: 'player_greeted' } },
];
const brain = [
  { ts: '2026-10-29T22:47:46.300Z', kind: 'event_received', eventId: 'E1', type: 'training_alarm_started', stale: false },
  { ts: '2026-10-29T22:47:50.100Z', kind: 'command_sent', commandId: 'C1', correlationId: 'E1', action: 'say', args: { text: 'To 2. alarm' }, seq: 15 },
  { ts: '2026-10-29T22:47:50.900Z', kind: 'result_received', commandId: 'C1', correlationId: 'E1', status: 'completed', reasonCode: 'said' },
  { ts: '2026-10-29T22:47:51.000Z', kind: 'result_received', commandId: 'OTHER', correlationId: 'X', status: 'completed', reasonCode: 'said' },
];

test('joins world and brain logs into one chain per originating event', () => {
  const chains = buildTimeline(world, brain);
  assert.equal(chains.length, 1, 'undelivered event without id and unrelated brain results are not chains');
  const c = chains[0];
  assert.equal(c.key, 'E1');
  assert.equal(c.agentKey, 'ardan');
  assert.deepEqual(c.steps.map((s) => `${s.source}:${s.kind}`), [
    'world:event', 'brain:event_received', 'brain:command_sent', 'world:command_accepted', 'world:npc_said',
    'world:command_result', 'brain:result_received',
  ]);
  assert.deepEqual(c.steps.map((s) => s.phase), ['observation', 'decision', 'decision', 'execution', 'execution', 'execution', 'outcome']);
});

test('within one second causal phase order wins over coarse world timestamps', () => {
  const steps = buildTimeline(world, brain)[0].steps;
  const seconds = steps.map((s) => Math.floor(s.atMs / 1000));
  for (let i = 1; i < seconds.length; i++) assert.ok(seconds[i] >= seconds[i - 1]);
  assert.equal(steps[0].kind, 'event');
});

test('parseJsonLines skips partial lines', () => {
  assert.equal(parseJsonLines('{"ts":"a","kind":"k"}\n{"ts":"b","ki').length, 1);
});
