// Decision timeline CLI (read-only):
//   node --disable-warning=ExperimentalWarning apps/brain/src/cli/timeline.ts [--session current|<id>]
//        [--agent <key>] [--id <eventId|correlationId>] [--last <n>] [--json]
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { buildTimeline, formatChain, parseJsonLines } from '../timeline.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
const logs = join(root, 'runtime', 'logs');
const { values } = parseArgs({
  options: {
    session: { type: 'string', default: 'current' },
    agent: { type: 'string' },
    id: { type: 'string' },
    last: { type: 'string', default: '10' },
    json: { type: 'boolean', default: false },
  },
});

const read = (file: string) => (existsSync(file) ? parseJsonLines(readFileSync(file, 'utf8')) : []);
let session = values.session!;
if (session === 'current') {
  const worldFile = join(root, 'runtime', 'mailbox', 'world.json');
  if (!existsSync(worldFile)) {
    console.error('runtime/mailbox/world.json not found; pass --session <id>');
    process.exit(2);
  }
  session = JSON.parse(readFileSync(worldFile, 'utf8')).worldSessionId;
}

const world = read(join(logs, 'world-journal.jsonl')).filter((e) => e.worldSessionId === session);
const brain = read(join(logs, 'brain.log'));
let chains = buildTimeline(world, brain);
if (values.agent) chains = chains.filter((c) => c.agentKey === values.agent);
if (values.id) chains = chains.filter((c) => c.key === values.id);
chains = chains.slice(-Number(values.last));

if (values.json) {
  console.log(JSON.stringify({ session, chains }, null, 2));
} else {
  console.log(`world session ${session}: ${chains.length} chain(s)`);
  for (const c of chains) console.log(formatChain(c));
}
