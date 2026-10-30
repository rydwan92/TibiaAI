// Rules provider: deterministic, offline, default. Texts come from the agent definition
// (agents.json "texts"); an empty template means "no reply" and the engine keeps its local rules.
import type { Envelope, EventPayload } from '../contracts.ts';
import type { Intent, Provider, ProviderContext } from './provider.ts';

export function sinceText(fromMs: number, nowMs: number): string {
  const s = Math.max(0, Math.round((nowMs - fromMs) / 1000));
  if (s < 90) return 'przed chwila';
  const min = Math.round(s / 60);
  if (min < 90) return `${min} min temu`;
  const h = Math.round(min / 60);
  if (h < 36) return `${h} h temu`;
  return `${Math.round(h / 24)} dni temu`;
}

export function fillTemplate(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (all, k: string) => (k in vars ? String(vars[k]) : all));
}

const safeName = (name: string) => name.replace(/[^A-Za-z0-9 '\-]/g, '').slice(0, 30) || 'wedrowcze';

/** Delay before commenting an alarm: the engine already spoke and enforces a 3 s say cooldown. */
export const ALARM_COMMENT_DELAY_MS = 4000;
/** Delay of a rumor after the greeting reply (same 3 s engine cooldown for non-reply speech). */
export const RUMOR_DELAY_MS = 3500;

const quote = (text: string) => (text.length > 60 ? `${text.slice(0, 57)}...` : text).replace(/"/g, "'");

export class RulesProvider implements Provider {
  readonly name = 'rules';

  decide(event: Envelope<EventPayload>, ctx: ProviderContext): Intent[] {
    const p = event.payload;
    const texts = ctx.agent.texts;
    const say = (template: string | undefined, vars: Record<string, string | number>, delayMs = 0): Intent[] =>
      template ? [{ action: 'say', text: fillTemplate(template, vars), delayMs }] : [];

    switch (p.type) {
      case 'player_greeted': {
        const name = safeName(p.playerName);
        const before = ctx.encounterBefore ?? { count: 0, lastAtMs: null };
        const greeting = before.count === 0 || before.lastAtMs === null
          ? say(texts.greetFirst, { name })
          : say(texts.greetRepeat, { name, nth: before.count + 1, since: sinceText(before.lastAtMs, ctx.nowMs) });
        const h = ctx.latestHeard;
        const rumor = h && greeting.length > 0
          ? say(texts.greetRumor, { speaker: h.speakerName, quote: quote(h.text), since: sinceText(h.atMs, ctx.nowMs) }, RUMOR_DELAY_MS)
          : [];
        return [...greeting, ...rumor];
      }
      case 'player_said':
        // Without a model only direct address gets a short acknowledgement.
        return p.addressed ? say(texts.busyReply, { name: safeName(p.playerName) }) : [];
      case 'agent_heard':
        // Never answer another agent's speech (ADR 0005: no agent<->agent loops); it is memory only.
        return [];
      case 'training_alarm_started':
        return say(texts.alarmComment, { n: ctx.alarmsThisSession ?? 1 }, ALARM_COMMENT_DELAY_MS);
      default:
        return [];
    }
  }
}

export function createProvider(name: string): Provider {
  if (name === 'rules') return new RulesProvider();
  throw new Error(`Provider "${name}" is not implemented; available: rules`);
}
