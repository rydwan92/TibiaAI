// The toolbox, first version: one local page showing what each character is, knows and remembers, and
// what it costs. Brain writes a plain file into runtime/panel; there is no server and nothing is exposed.
// Only what Brain already holds about the game world. A person's notes with the helper never appear here.
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import type { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import { whenWords } from './players/story.ts';
import type { BodyState, Experience, PlayerDef } from './players/types.ts';
import { CreditLedger, dayStartMs, monthStartMs } from './providers/ledger.ts';

const DIARY_LINES = 8;
const OFFLINE_MS = 20_000;
const MAX_PEOPLE = 6;

const esc = (v: unknown) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function readJson<T>(path: string): T | null {
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as T;
  } catch {
    return null;
  }
}

function lastLines(path: string, count: number): string[] {
  if (!existsSync(path)) return [];
  return readFileSync(path, 'utf8').trimEnd().split('\n').slice(-count);
}

const bar = (label: string, value: number) => `<div class="bar"><span>${label}</span><i style="width:${Math.round(value * 100)}%"></i></div>`;
const list = (title: string, lines: string[]) => (lines.length > 0 ? `<h4>${title}</h4><ul>${lines.map((l) => `<li>${esc(l)}</li>`).join('')}</ul>` : '');

function card(key: string, def: PlayerDef, root: string, db: DatabaseSync, now: number): string {
  const dir = join(root, 'runtime', 'players', key);
  const s = readJson<BodyState>(join(dir, 'state.json'));
  const row = db.prepare(`SELECT value FROM npc_player_prefs WHERE npc_key = ? AND player_guid = 0 AND pref_key = 'mind'`).get(key) as { value: string } | undefined;
  const e = row ? JSON.parse(row.value) as Partial<Experience> : {};
  const online = s !== null && now - s.atMs <= OFFLINE_MS;
  const people = Object.entries(e.people ?? {}).sort(([, a], [, b]) => b.met + Math.abs(b.opinion) - a.met - Math.abs(a.opinion)).slice(0, MAX_PEOPLE)
    .map(([name, p]) => `<tr><td>${esc(name)}</td><td>${p.opinion.toFixed(1)}</td><td>${p.met}</td><td>${p.together}</td><td>${p.fights}</td></tr>`).join('');
  const moments = Object.entries(e.moments ?? {}).flatMap(([, list_]) => list_).sort((a, b) => b.atMs - a.atMs).slice(0, 6).map((m) => `${whenWords(m.atMs, now)}: ${m.text}`);
  const vows = (e.vows ?? []).map((v) => `${v.who === 'me' ? `obiecal(a) ${v.person}` : `${v.person} obiecal(a)`}: ${v.text}`);
  const spots = Object.values(e.places ?? {}).filter((p) => p.why === 'hunt' && p.kills > 0).sort((a, b) => b.exp - a.exp).slice(0, 4).map((p) => `${p.name}: ${p.exp} exp, ${p.kills} zabitych${p.deaths ? `, ${p.deaths} zgonow` : ''}`);
  return `<article class="${online ? 'on' : 'off'}">
<header><h3>${esc(def.character)}</h3><small>${esc(def.vocation)}, poziom ${esc(s?.level)}, ${online ? 'w grze' : 'poza gra'}</small></header>
<p class="meta">${esc(def.model?.model ?? 'lokalny')} · mapa: ${esc(def.mapKnowledge ?? 'all')} · exp ${esc(s?.experience)} · zgonow ${esc(e.deaths ?? 0)} · hp ${esc(s?.hp)}/${esc(s?.hpMax)} · ${esc(s?.x)},${esc(s?.y)},${esc(s?.z)}</p>
<p class="meta">Miasta: ${esc((e.towns ?? []).join(', ') || '-')} · kupiony sprzet: ${Object.keys(e.upgrades ?? {}).length}</p>
<p class="plan">${esc(e.plan || 'bez planu')}</p>
${e.strategy ? `<p class="meta">Proba: ${esc(e.strategy.text)}</p>` : ''}
<p class="meta">Decyzje: model ${esc(e.modelChoices ?? 0)}, reguly ${esc(e.ruleChoices ?? 0)}, odruch zmienil wybor modelu ${esc(e.overrides ?? 0)}x</p>
${def.ambition ? `<p class="meta">Cel: ${esc(def.ambition)}</p>` : ''}
<div class="bars">${bar('strach', e.fear ?? 0)}${bar('pewnosc', e.confidence ?? 0)}${bar('nuda', e.boredom ?? 0)}${bar('samotnosc', e.loneliness ?? 0)}</div>
${list('Przekonania', e.beliefs ?? [])}
${vows.length > 0 ? list('Obietnice', vows) : ''}
${list('Pamietne chwile', moments)}
${people ? `<h4>Ludzie</h4><table><tr><th></th><th>opinia</th><th>spotkan</th><th>wypraw</th><th>walk</th></tr>${people}</table>` : ''}
${list('Miejscowki', spots)}
${list('Proby i wyniki', (e.trials ?? []).slice(-3).map((t) => `${t.text}: ${t.expPerHour} exp/h, ${t.moneyPerHour} zl/h, zgonow ${t.deaths}`))}
${list('Tygodnie', (e.chronicle ?? []).slice(-3).map((c) => c.text))}
<details><summary>Ostatnie zapisy</summary><pre>${esc(lastLines(join(dir, 'diary.log'), DIARY_LINES).join('\n'))}</pre></details>
</article>`;
}

export function renderPanel(root: string, db: DatabaseSync, agents: Record<string, PlayerDef>, now: number, monthlyBudget: number): string {
  const ledger = new CreditLedger(db);
  const today = ledger.spentSince(dayStartMs(now));
  const month = ledger.spentSince(monthStartMs(now));
  const costs = ledger.byPurpose(dayStartMs(now)).sort((a, b) => b.credits - a.credits).slice(0, 8).map((r) => `<tr><td>${esc(r.purpose)}</td><td>${r.calls}</td><td>${r.credits.toFixed(2)}</td></tr>`).join('');
  const players = Object.entries(agents).filter(([, def]) => def.role !== 'assistant');
  const cards = players.map(([key, def]) => card(key, def, root, db, now)).join('\n');
  const spent = new Map(ledger.summary(dayStartMs(now)).map((r) => [r.agentKey, r.credits]));
  const ranking = players.map(([key, def]) => ({ key, def, s: readJson<BodyState>(join(root, 'runtime', 'players', key, 'state.json')), m: readJson<{ kills?: number; deaths?: number; towns?: string[] }>(join(root, 'runtime', 'players', key, 'metrics.json')) }))
    .sort((a, b) => (b.s?.experience ?? 0) - (a.s?.experience ?? 0))
    .map((r, i) => `<tr><td>${i + 1}. ${esc(r.def.character)}</td><td>${esc(r.s?.level)}</td><td>${esc(r.s?.experience)}</td><td>${esc(r.m?.kills ?? 0)}</td><td>${esc(r.m?.deaths ?? 0)}</td><td>${r.m?.towns?.length ?? 0}</td><td>${esc(r.def.model?.model ?? 'lokalny')}</td><td>${(spent.get(r.key) ?? 0).toFixed(1)}</td></tr>`).join('');
  return `<!doctype html><html lang="pl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="refresh" content="30"><title>Stevium narzedziownik</title>
<style>
:root{--bg:#14161a;--card:#1d2026;--line:#2e333c;--text:#e6e3dc;--dim:#9aa0aa;--accent:#d9a441;--good:#6fbf73}
body{margin:0;background:var(--bg);color:var(--text);font:15px/1.45 system-ui,sans-serif;padding:16px}
h1{font-size:22px;margin:0 0 4px}h3{margin:0;font-size:18px;color:var(--accent)}h4{margin:12px 0 4px;font-size:13px;color:var(--dim);text-transform:uppercase;letter-spacing:.04em}
.top{display:flex;flex-wrap:wrap;gap:24px;align-items:flex-start;margin-bottom:16px}
main{display:grid;grid-template-columns:repeat(auto-fill,minmax(320px,1fr));gap:12px}
article{background:var(--card);border:1px solid var(--line);border-radius:8px;padding:12px}article.off{opacity:.6}
article header{display:flex;justify-content:space-between;align-items:baseline;gap:8px}small,.meta{color:var(--dim);font-size:13px}.meta{margin:4px 0}.plan{margin:8px 0}
ul{margin:0;padding-left:18px}li{margin:2px 0}
table{border-collapse:collapse;width:100%;font-size:13px}td,th{padding:2px 6px;text-align:right;border-bottom:1px solid var(--line)}td:first-child,th:first-child{text-align:left}
.bars{display:grid;grid-template-columns:1fr 1fr;gap:4px 12px;margin:8px 0}.bar{position:relative;background:#262a31;border-radius:3px;height:18px;overflow:hidden}.bar i{position:absolute;inset:0 auto 0 0;background:#3c5a78}.bar span{position:relative;z-index:1;font-size:12px;padding-left:6px;line-height:18px}
pre{white-space:pre-wrap;font-size:12px;color:var(--dim);margin:6px 0 0}summary{cursor:pointer;color:var(--dim);font-size:13px;margin-top:10px}
</style></head><body>
<div class="top"><div><h1>Stevium: narzedziownik</h1><small>Odswieza sie co 30 s. Stan z ${esc(new Date(now).toLocaleString('pl-PL'))}.</small><p class="meta">Kredyty: dzisiaj ${today.toFixed(1)}, w tym miesiacu ${month.toFixed(1)} z ${monthlyBudget}.</p></div>
<table style="width:auto"><tr><th>ranking</th><th>poziom</th><th>exp</th><th>zabite</th><th>zgony</th><th>miasta</th><th>model</th><th>kredyty dzis</th></tr>${ranking}</table>
${costs ? `<table style="width:auto"><tr><th>na co</th><th>wywolan</th><th>kredyty</th></tr>${costs}</table>` : ''}</div>
<main>${cards}</main></body></html>`;
}

export function writePanel(root: string, db: DatabaseSync, agents: Record<string, PlayerDef>, now: number, monthlyBudget: number): void {
  const dir = join(root, 'runtime', 'panel');
  mkdirSync(dir, { recursive: true });
  const path = join(dir, 'index.html');
  writeFileSync(`${path}.tmp`, renderPanel(root, db, agents, now, monthlyBudget));
  renameSync(`${path}.tmp`, path);
}
