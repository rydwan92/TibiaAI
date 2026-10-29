import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { allowlist } from '../src/contracts.ts';

// The Lua config is the engine-side allowlist; Brain must not reference ids the engine lacks.
const luaConfig = readFileSync(new URL('../../../game/overlays/tibia-ai/scripts/tibia-ai/ardan_config.lua', import.meta.url), 'utf8');

function luaBlockKeys(block: string): string[] {
  const m = luaConfig.match(new RegExp(`${block} = \\{([\\s\\S]*?)\\n\\t\\},`));
  assert.ok(m, `block ${block} not found`);
  return [...m[1].matchAll(/^\t\t(\w+) = /gm)].map((x) => x[1]).sort();
}

test('waypoints and routes match the Lua config', () => {
  assert.deepEqual(luaBlockKeys('waypoints'), [...allowlist.agents.ardan.waypoints].sort());
  assert.deepEqual(luaBlockKeys('routes'), [...allowlist.agents.ardan.routes].sort());
});
