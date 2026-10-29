import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, utimesSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Mailbox } from '../src/mailbox.ts';
import { pruneMailbox } from '../src/retention.ts';
import { tempDir } from './helpers.ts';

test('keeps the newest files and never removes the current session', () => {
  const mb = new Mailbox(join(tempDir(), 'mailbox'));
  const dir = join(mb.root, 'brain-processed');
  const base = Date.now() / 1000 - 1000;
  for (let i = 1; i <= 6; i++) {
    const old = join(dir, `evt-oldsess-${String(i).padStart(8, '0')}.json`);
    writeFileSync(old, '{}');
    utimesSync(old, base + i, base + i);
  }
  const live = join(dir, 'evt-livesess-00000001.json');
  writeFileSync(live, '{}');
  utimesSync(live, base - 500, base - 500); // oldest of all, but protected

  const removed = pruneMailbox(mb.root, 'livesess', { 'brain-processed': 2, processed: 2, quarantine: 2 });
  assert.equal(removed['brain-processed'], 4);
  assert.deepEqual(readdirSync(dir).sort(), ['evt-livesess-00000001.json', 'evt-oldsess-00000005.json', 'evt-oldsess-00000006.json']);
});
