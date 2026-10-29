// Rules provider: deterministic, offline, default. Proposes only contract actions; the engine
// decides whether they can run. Texts avoid diacritics (client font/encoding not verified yet).
import type { Envelope, EventPayload } from './contracts.ts';
import type { EncounterStats } from './memory.ts';

export interface Intent {
  action: 'say';
  text: string;
  delayMs: number;
}

export interface RulesContext {
  encounterBefore?: EncounterStats;
  alarmsThisSession?: number;
  nowMs: number;
}

export function sinceText(fromMs: number, nowMs: number): string {
  const s = Math.max(0, Math.round((nowMs - fromMs) / 1000));
  if (s < 90) return 'przed chwila';
  const min = Math.round(s / 60);
  if (min < 90) return `${min} min temu`;
  const h = Math.round(min / 60);
  if (h < 36) return `${h} h temu`;
  return `${Math.round(h / 24)} dni temu`;
}

const safeName = (name: string) => name.replace(/[^A-Za-z0-9 '\-]/g, '').slice(0, 30) || 'wedrowcze';

export function decide(event: Envelope<EventPayload>, ctx: RulesContext): Intent[] {
  const p = event.payload;
  switch (p.type) {
    case 'player_greeted': {
      const name = safeName(p.playerName);
      const before = ctx.encounterBefore ?? { count: 0, lastAtMs: null };
      if (before.count === 0 || before.lastAtMs === null) {
        return [{ action: 'say', text: `Witaj, ${name}. Jestem Ardan, straznik Montag. Nie widzialem cie tu wczesniej.`, delayMs: 0 }];
      }
      const nth = before.count + 1;
      return [{ action: 'say', text: `Znowu ty, ${name}. To nasze ${nth}. spotkanie, ostatnio ${sinceText(before.lastAtMs, ctx.nowMs)}.`, delayMs: 0 }];
    }
    case 'training_alarm_started': {
      // The engine already yelled the warning; comment after its 3 s say cooldown.
      const n = ctx.alarmsThisSession ?? 1;
      return [{ action: 'say', text: `To ${n}. alarm cwiczebny w tej zmianie. Zachowajcie spokoj.`, delayMs: 4000 }];
    }
    default:
      return [];
  }
}
