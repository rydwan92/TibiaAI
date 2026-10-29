// Entry point: node --disable-warning=ExperimentalWarning apps/brain/src/main.ts
// Paths are fixed relative to the repository root; provider is "rules" (offline).
import { appendFileSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Brain } from './brain.ts';
import { agentRegistry } from './contracts.ts';
import { Mailbox } from './mailbox.ts';
import { Memory } from './memory.ts';
import { createProvider } from './providers/rules.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const runtime = join(root, 'runtime');
const logFile = join(runtime, 'logs', 'brain.log');
const stopFile = join(runtime, 'control', 'brain-stop.request');
mkdirSync(dirname(logFile), { recursive: true });

let provider;
let agents: string[];
try {
  provider = createProvider(process.env.TIBIAAI_BRAIN_PROVIDER ?? 'rules');
  agents = agentRegistry().keys(); // fails fast on invalid packages/contracts/agents.json
} catch (err) {
  console.error((err as Error).message);
  process.exit(2);
}

function log(kind: string, fields: Record<string, unknown> = {}): void {
  const line = JSON.stringify({ ts: new Date().toISOString(), kind, ...fields });
  appendFileSync(logFile, `${line}\n`);
  console.log(line);
}

const memory = new Memory(join(runtime, 'brain', 'brain.sqlite'));
const brain = new Brain(new Mailbox(join(runtime, 'mailbox')), memory, log, Date.now, provider);
log('brain_started', { provider: provider.name, agents, pid: process.pid });

function shutdown(reason: string): void {
  clearInterval(timer);
  memory.close();
  log('brain_stopped', { reason });
  process.exit(0);
}

const timer = setInterval(() => {
  if (existsSync(stopFile)) {
    rmSync(stopFile, { force: true });
    shutdown('control_file');
  }
  try {
    brain.tick();
  } catch (err) {
    log('brain_tick_error', { error: (err as Error).message });
  }
}, 250);

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
