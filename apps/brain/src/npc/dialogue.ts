// NPC dialogue provider (ADR 0008). All NPCs share one loaded model; each request is built from
// that NPC's own profile and memory. The model proposes words and an allowed intent; nothing it
// says is stored until the engine confirms the speech (see applyConfirmedReply). Every failure
// returns the rules decision, so the game never depends on the model.
import { agentRegistry, type Envelope, type EventPayload } from '../contracts.ts';
import type { LocalModelClient } from '../providers/local-model.ts';
import type { Intent, Provider, ProviderContext } from '../providers/provider.ts';
import { RulesProvider, sinceText } from '../providers/rules.ts';
import type { NpcCatalog } from './config.ts';
import { buildContext } from './context.ts';
import { isConversationTurn } from './perception.ts';
import { normalise, tokens, type MemoryRetriever } from './retrieval.ts';
import type { NpcMemoryStore } from './store.ts';

export interface DialoguePlan {
  conversationId: string;
  version: number;
  playerGuid: number;
  playerName: string;
  remember: string;
  promise: string;
  sentiment: number;
  selectedRefs: string[];
  origin: 'model' | 'rules';
}

export interface ModelDecision {
  say: string;
  action: string;
  remember: string;
  promise: string;
  sentiment: number;
}

const PL: Record<string, string> = { ą: 'a', ć: 'c', ę: 'e', ł: 'l', ń: 'n', ó: 'o', ś: 's', ź: 'z', ż: 'z', Ą: 'A', Ć: 'C', Ę: 'E', Ł: 'L', Ń: 'N', Ó: 'O', Ś: 'S', Ź: 'Z', Ż: 'Z' };

/** Client encoding of diacritics is unverified, so in-game text stays printable ASCII. */
export function toGameAscii(text: string): string {
  return text.replace(/[ąćęłńóśźżĄĆĘŁŃÓŚŹŻ]/g, (c) => PL[c]).replace(/[‘’]/g, "'").replace(/[“”„]/g, '"').replace(/[–—]/g, '-').replace(/…/g, '...');
}

export function responseSchema(allowedIntents: string[]): object {
  return {
    type: 'object',
    properties: {
      say: { type: 'string' },
      action: { type: 'string', enum: allowedIntents },
      remember: { type: 'string' },
      promise: { type: 'string' },
      sentiment: { type: 'integer', enum: [-1, 0, 1] },
    },
    required: ['say', 'action', 'remember', 'promise', 'sentiment'],
  };
}

function fitSentences(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  const cut = text.slice(0, maxChars).match(/^.*[.!?]/);
  return cut && cut[0].length >= 20 ? cut[0] : text;
}

const EMPTY_FILLER = /^(brak|nic|nie ma|none|n\/a|no|nie|-|\.)\b/i;
const PROMISE_WORDS = /obiecuj|przyrzek|zalatw|pomog|przyniose|wroce|sprawdze|dopilnuj|poszukam|dam ci|zrobie|przekaze/i;

/** Validates the structured reply. Optional fields the model fills with noise are blanked. */
export function parseDecision(raw: string, allowedIntents: string[], maxChars: number, playerText: string):
  { ok: true; decision: ModelDecision; rejectedIntent?: string } | { ok: false; error: string } {
  let v: Record<string, unknown>;
  try {
    v = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return { ok: false, error: 'not_json' };
  }
  if (typeof v.say !== 'string' || !v.say.trim()) return { ok: false, error: 'no_say' };
  const say = fitSentences(toGameAscii(v.say).replace(/\s+/g, ' ').trim(), maxChars);
  if (say.length > maxChars) return { ok: false, error: 'too_long' };
  if (/[^\x20-\x7e]/.test(say)) return { ok: false, error: 'non_ascii' };
  if (/^[/!]/.test(say)) return { ok: false, error: 'looks_like_command' };

  const clean = (x: unknown) => (typeof x === 'string' ? toGameAscii(x).replace(/\s+/g, ' ').trim().slice(0, 120) : '');
  let remember = clean(v.remember);
  let promise = clean(v.promise);
  // A memory about the player must come from the player's own statement; a question states nothing.
  const said = tokens(playerText);
  if (playerText.includes('?') || EMPTY_FILLER.test(remember) || remember.length < 4 || ![...tokens(remember)].some((t) => [...said].some((w) => w.startsWith(t.slice(0, 4))))) remember = '';
  if (EMPTY_FILLER.test(promise) || promise.length < 4 || !PROMISE_WORDS.test(say)) promise = '';

  const action = typeof v.action === 'string' ? v.action : 'none';
  const allowed = allowedIntents.includes(action);
  const sentiment = v.sentiment === 1 || v.sentiment === -1 ? v.sentiment : 0;
  return {
    ok: true,
    decision: { say, action: allowed ? action : 'none', remember, promise, sentiment },
    ...(allowed ? {} : { rejectedIntent: String(action).slice(0, 40) }),
  };
}

/** Word groups from a recall question that the reply left out (Polish endings tolerated: Marek, Markiem). */
export function missingMentions(say: string, mustMention: string[][]): string[][] {
  const text = normalise(say);
  return mustMention.filter((group) => group.length > 0 && !group.some((word) => text.includes(word.slice(0, 3))));
}

export type DialogueLog = (kind: string, fields?: Record<string, unknown>) => void;

const INTENT_CAPABILITY: Record<string, string> = {};
const RECENT_TURNS = 6;
const MEMORY_LIMIT = 5;

export class NpcDialogueProvider implements Provider {
  readonly name = 'npc-dialogue';
  private readonly client: LocalModelClient;
  private readonly store: NpcMemoryStore;
  private readonly catalog: NpcCatalog;
  private readonly retriever: MemoryRetriever;
  private readonly rules = new RulesProvider();
  private readonly log: DialogueLog;
  private readonly now: () => number;
  private active = 0;
  private waiting: (() => void)[] = [];
  private callTimes: number[] = [];
  private versions = new Map<string, number>();
  private lastTurnAtMs = 0;

  constructor(client: LocalModelClient, store: NpcMemoryStore, catalog: NpcCatalog, retriever: MemoryRetriever, log: DialogueLog = () => {}, now: () => number = Date.now) {
    this.client = client;
    this.store = store;
    this.catalog = catalog;
    this.retriever = retriever;
    this.log = log;
    this.now = now;
  }

  /** Background model work waits for this, so a summary never delays a player's reply. */
  idleForMs(): number {
    return this.active > 0 ? 0 : this.now() - this.lastTurnAtMs;
  }

  decide(event: Envelope<EventPayload>, ctx: ProviderContext): Intent[] | Promise<Intent[]> {
    const fallback = this.rules.decide(event, ctx);
    const p = event.payload;
    if (!isConversationTurn(event) || (p.type !== 'player_greeted' && p.type !== 'player_said')) return fallback;
    this.lastTurnAtMs = this.now();
    const conversationId = `${event.agentKey}:${p.playerGuid}`;
    const version = (this.versions.get(conversationId) ?? 0) + 1;
    this.versions.set(conversationId, version);
    const plan = (origin: 'model' | 'rules', d?: ModelDecision, selectedRefs: string[] = []): DialoguePlan => ({
      conversationId, version, playerGuid: p.playerGuid, playerName: p.playerName, origin, selectedRefs,
      remember: d?.remember ?? '', promise: d?.promise ?? '', sentiment: d?.sentiment ?? 0,
    });
    const rulesReply = fallback.map((i) => ({ ...i, toPlayerGuid: p.playerGuid, plan: plan('rules') }));

    const cfg = this.client.cfg;
    this.callTimes = this.callTimes.filter((t) => this.now() - t < 60_000);
    if (this.callTimes.length >= cfg.maxCallsPerMinute) {
      this.log('model_skipped', { reason: 'budget', eventId: event.messageId });
      return rulesReply;
    }
    if (this.active >= cfg.maxConcurrent && this.waiting.length >= cfg.maxQueue) {
      this.log('model_skipped', { reason: 'queue_full', eventId: event.messageId });
      return rulesReply;
    }
    this.callTimes.push(this.now());
    return this.schedule(() => this.ask(event, ctx, p, conversationId, version, plan, rulesReply));
  }

  private async schedule<T>(task: () => Promise<T>): Promise<T> {
    if (this.active >= this.client.cfg.maxConcurrent) await new Promise<void>((resolve) => this.waiting.push(resolve));
    this.active++;
    try {
      return await task();
    } finally {
      this.active--;
      this.waiting.shift()?.();
    }
  }

  private superseded(conversationId: string, version: number): boolean {
    return (this.versions.get(conversationId) ?? 0) !== version;
  }

  private async ask(event: Envelope<EventPayload>, ctx: ProviderContext, p: Extract<EventPayload, { type: 'player_greeted' | 'player_said' }>,
    conversationId: string, version: number, plan: (o: 'model' | 'rules', d?: ModelDecision, refs?: string[]) => DialoguePlan, rulesReply: Intent[]): Promise<Intent[]> {
    // The player already said something newer in this conversation: answer that one instead.
    if (this.superseded(conversationId, version)) return [];
    const profile = this.catalog.profile(event.agentKey);
    if (!profile) return rulesReply;
    const cfg = this.client.cfg;
    const turns = this.store.recentTurns(event.agentKey, p.playerGuid, RECENT_TURNS + 1).filter((t) => t.text !== p.text).slice(-RECENT_TURNS);
    const memories = this.retriever.retrieve({
      npcKey: event.agentKey, playerGuid: p.playerGuid, text: p.text, nowMs: ctx.nowMs, limit: MEMORY_LIMIT, excludeEventIds: new Set(turns.map((t) => t.id)),
    });
    const relationship = this.store.relationship(event.agentKey, p.playerGuid);
    const allowedIntents = this.catalog.allowedIntents(event.agentKey, agentRegistry().capabilities(event.agentKey), INTENT_CAPABILITY);
    const built = buildContext(this.catalog, {
      profile, playerName: p.playerName, playerText: p.text, relationship, facts: this.store.facts(event.agentKey, p.playerGuid),
      commitments: this.store.openCommitments(event.agentKey, p.playerGuid),
      recentTurns: turns.map((t) => ({ role: t.kind === 'said_by_player' ? 'gracz' as const : 'ty' as const, text: t.text })),
      memories, alarmActive: ctx.alarmActive ?? false, allowedIntents,
      sinceText: relationship ? sinceText(relationship.last_seen_ms, ctx.nowMs) : null,
    }, cfg.maxPromptChars);

    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        const r = await this.client.chat([{ role: 'system', content: built.system }, { role: 'user', content: built.user }], { schema: responseSchema(allowedIntents) });
        const parsed = parseDecision(r.text, allowedIntents, cfg.maxReplyChars, p.text);
        this.log('model_decision', {
          eventId: event.messageId, npc: event.agentKey, playerGuid: p.playerGuid, version, attempt, ok: parsed.ok,
          error: parsed.ok ? undefined : parsed.error, rejectedIntent: parsed.ok ? parsed.rejectedIntent : undefined,
          totalMs: r.totalMs, promptTokens: r.promptCount, outputTokens: r.evalCount, promptChars: built.promptChars,
          sections: built.sections, selectedRefs: built.selectedRefs, knowledgeIds: built.knowledgeIds,
        });
        if (!parsed.ok) continue;
        if (attempt === 1 && missingMentions(parsed.decision.say, built.mustMention).length > 0) {
          this.log('model_decision_retry', { eventId: event.messageId, reason: 'missing_recall', say: parsed.decision.say });
          continue;
        }
        if (this.superseded(conversationId, version)) {
          this.log('model_decision_superseded', { eventId: event.messageId, version });
          return [];
        }
        return [{ action: 'say', text: parsed.decision.say, delayMs: 0, toPlayerGuid: p.playerGuid, plan: plan('model', parsed.decision, built.selectedRefs) }];
      } catch (err) {
        this.log('model_failed', { eventId: event.messageId, attempt, error: (err as Error).message });
        break; // a timeout or a dead server will not be better a moment later
      }
    }
    return rulesReply;
  }
}
