import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { rotateIfLarger } from '../src/logrotate.ts';
import { tempDir } from './helpers.ts';

test('rotates only above the limit and never overwrites an earlier rotation', () => {
  const file = join(tempDir(), 'brain.log');
  writeFileSync(file, 'x'.repeat(100));
  assert.equal(rotateIfLarger(file, 1000), null);
  const now = new Date('2026-10-29T22:00:00Z');
  const first = rotateIfLarger(file, 50, now);
  assert.ok(first?.endsWith('brain.20261029-220000.log'));
  assert.equal(existsSync(file), false);
  writeFileSync(file, 'y'.repeat(100));
  const second = rotateIfLarger(file, 50, now);
  assert.ok(second?.endsWith('brain.20261029-220000-1.log'));
  assert.equal(readFileSync(first!, 'utf8')[0], 'x');
});
