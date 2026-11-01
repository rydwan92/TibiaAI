// What the cloud models cost so far, read from SQLite. Calls no model. --quota asks the account.
import { DatabaseSync } from 'node:sqlite';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CreditLedger, dayStartMs, monthStartMs } from '../providers/ledger.ts';
import { loadCloudAiConfig } from '../providers/copilot-model.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
const db = new DatabaseSync(join(root, 'runtime', 'brain', 'brain.sqlite'), { readOnly: true });
const ledger = new CreditLedger(db);
const cfg = loadCloudAiConfig();
const now = Date.now();
const today = ledger.spentSince(dayStartMs(now));

console.log(`Dzisiaj ${today.toFixed(3)} z ${cfg.dailyBudgetCredits} kredytow, w tym miesiacu ${ledger.spentSince(monthStartMs(now)).toFixed(3)} z ${cfg.monthlyBudgetCredits}`);
for (const r of ledger.summary(dayStartMs(now))) {
  console.log(`${r.agentKey.padEnd(16)} ${r.model.padEnd(18)} ${r.effort.padEnd(6)} wywolan ${String(r.calls).padStart(4)}, bledow ${r.failed}, tokeny ${r.inputTokens}/${r.outputTokens}, ${r.credits.toFixed(3)} kr, sr. ${r.avgMs} ms, maks. ${r.maxMs} ms`);
}
for (const r of ledger.byPurpose(dayStartMs(now))) {
  const perGood = r.good > 0 ? (r.credits / r.good).toFixed(4) : '-';
  console.log(`${r.purpose.padEnd(10)} wywolan ${r.calls}, dobrych ${r.good}, koszt dobrej odpowiedzi ${perGood} kr`);
}
if (process.argv.includes('--quota')) {
  const { CopilotClient } = await import('@github/copilot-sdk');
  const client = new CopilotClient({ logLevel: 'error' });
  await client.start();
  const quota = await client.rpc.account.getQuota({});
  for (const [name, q] of Object.entries(quota.quotaSnapshots ?? {})) {
    if (!q) continue;
    console.log(`Limit ${name}: pozostalo ${q.remainingPercentage}%, odnowienie ${q.resetDate ?? '?'}, ponad limit ${q.overageAllowedWithExhaustedQuota ? 'dozwolone' : 'zablokowane'}`);
  }
  await client.stop();
}
