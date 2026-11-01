// The body is Lua in a client, where a local function used above its definition is a nil global: it
// fails only when that line finally runs. This reads the source, so the mistake is caught here.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../../../tools/otclient-agent/agent.lua', import.meta.url), 'utf8').split(/\r?\n/).map((line) => line.replace(/--.*$/, ''));

test('every local function of the body is defined above its first use', () => {
  const declared = new Map<string, number>();
  source.forEach((line, i) => {
    const fn = /^\s*local function (\w+)/.exec(line);
    if (fn && !declared.has(fn[1])) declared.set(fn[1], i);
    const names = /^local ([\w, ]+)$/.exec(line.trim());
    for (const name of names?.[1].split(',').map((n) => n.trim()) ?? []) if (!declared.has(name)) declared.set(name, i);
  });
  const late: string[] = [];
  for (const [name, at] of declared) {
    source.slice(0, at).forEach((line, i) => {
      if (new RegExp(`(^|[^\\w.:"])${name}\\(`).test(line)) late.push(`${name} used on line ${i + 1}, defined on ${at + 1}`);
    });
  }
  assert.deepEqual(late, []);
});
