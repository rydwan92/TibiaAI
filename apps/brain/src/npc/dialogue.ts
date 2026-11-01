// NPC dialogue provider (ADR 0008, 0009). All NPCs share one loaded model; each request is built
// from that NPC's own profile and memory. The model proposes words and an allowed intent; nothing it
// says is stored until the engine confirms the speech (see applyConfirmedReply), and an action
// starts only from a request found in the player's own words. Every failure returns the rules
// decision, so the game never depends on the model.
import { taskDefinitions } from '../agents.ts';
import { agentRegistry, type Envelope, type EventPayload } from '../contracts.ts';
import type { DialogueClient } from '../providers/local-model.ts';
import type { Intent, Provider, ProviderContext } from '../providers/provider.ts';
import { guideRequest, RulesProvider, sinceText } from '../providers/rules.ts';
import type { ConversationPolicy, NpcCatalog } from './config.ts';
import { buildContext, unusedPhrases, type LessonState, type WalkRequest } from './context.ts';
import { isConversationTurn } from './perception.ts';
import { parseGuideCancel, parseGuideRequest, parseLanguagePreference, parseLessonCommand, withoutAddress } from './requests.ts';
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
  /** Second chat line of one reply: stored as speech, dropped when the player moved on. */
  continuation?: boolean;
}

export interface ModelDecision {
  say: string;
  action: string;
  target: string;
  remember: string;
  promise: string;
  sentiment: number;
}

const PL: Record<string, string> = { ą: 'a', ć: 'c', ę: 'e', ł: 'l', ń: 'n', ó: 'o', ś: 's', ź: 'z', ż: 'z', Ą: 'A', Ć: 'C', Ę: 'E', Ł: 'L', Ń: 'N', Ó: 'O', Ś: 'S', Ź: 'Z', Ż: 'Z' };

/** Client encoding of diacritics is unverified, so in-game text stays printable ASCII. */
export function toGameAscii(text: string): string {
  return text.replace(/\s+/g, ' ').replace(/[ąćęłńóśźżĄĆĘŁŃÓŚŹŻ]/g, (c) => PL[c]).replace(/[‘’]/g, "'").replace(/[“”„]/g, '"').replace(/[–—]/g, '-').replace(/…/g, '...')
    .normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^\x20-\x7e]/g, '');
}

export function responseSchema(allowedIntents: string[], placeIds: string[] = []): object {
  const target = placeIds.length > 0 ? { target: { type: 'string', enum: ['', ...placeIds] } } : {};
  return {
    type: 'object',
    properties: {
      say: { type: 'string' },
      action: { type: 'string', enum: allowedIntents },
      ...target,
      remember: { type: 'string' },
      promise: { type: 'string' },
      sentiment: { type: 'integer', enum: [-1, 0, 1] },
    },
    required: ['say', 'action', ...Object.keys(target), 'remember', 'promise', 'sentiment'],
  };
}

function fitSentences(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  const cut = text.slice(0, maxChars).match(/^.*[.!?]/);
  return cut && cut[0].length >= 20 ? cut[0] : text;
}

/** One chat line carries at most limit characters; a reply takes two lines at most. */
export function splitReply(text: string, limit: number): string[] {
  if (text.length <= limit) return [text];
  const head = text.slice(0, limit);
  const sentence = head.match(/^.*[.!?]["']?/)?.[0];
  const first = sentence && sentence.length >= 20 ? sentence : head.slice(0, Math.max(head.lastIndexOf(' '), 1));
  const rest = fitSentences(text.slice(first.length).trim(), limit);
  return rest && rest.length <= limit ? [first, rest] : [first];
}

const EMPTY_FILLER = /^(brak|nic|nie ma|none|n\/a|no|nie|-|\.)\b/i;
const PROMISE_WORDS = /obiecuj|przyrzek|zalatw|pomog|przyniose|wroce|sprawdze|dopilnuj|poszukam|dam ci|zrobie|przekaze/i;

/** Validates the structured reply. Optional fields the model fills with noise are blanked. */
export function parseDecision(raw: string, allowedIntents: string[], maxChars: number, playerText: string, placeIds: string[] = []):
  { ok: true; decision: ModelDecision; rejectedIntent?: string } | { ok: false; error: string } {
  let v: Record<string, unknown>;
  try {
    v = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return { ok: false, error: 'not_json' };
  }
  if (typeof v.say !== 'string' || !v.say.trim()) return { ok: false, error: 'no_say' };
  const say = fitSentences(toGameAscii(v.say).replace(/\s+/g, ' ').trim(), maxChars);
  if (!say) return { ok: false, error: 'no_say' };
  if (say.length > maxChars) return { ok: false, error: 'too_long' };
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
  const target = typeof v.target === 'string' && placeIds.includes(v.target) ? v.target : '';
  const sentiment = v.sentiment === 1 || v.sentiment === -1 ? v.sentiment : 0;
  return {
    ok: true,
    decision: { say, action: allowed ? action : 'none', target, remember, promise, sentiment },
    ...(allowed ? {} : { rejectedIntent: String(action).slice(0, 40) }),
  };
}

/** Word groups from a recall question that the reply left out (Polish endings tolerated: Marek, Markiem). */
export function missingMentions(say: string, mustMention: string[][]): string[][] {
  const text = normalise(say);
  return mustMention.filter((group) => group.length > 0 && !group.some((word) => text.includes(word.slice(0, 3))));
}

/** A reply to "are you an AI?" must say so and must not claim to be human. */
export function dodgesMarker(say: string): boolean {
  const text = normalise(say);
  return !/sztuczn|\bai\b|artificial/.test(text) || /jestem (prawdziwym )?(czlowiekiem|czlowiek)|i am (a )?human/.test(text);
}

const DUTY_DODGE = /(poza|wykracza\w* poza) (moje|moimi|obowiazk|zakres)|nie (jest )?moja sprawa|nie moja rzecz|nie nalezy do moich|nie dotyczy moich|nie pilnuje nieba/;

/** Character sets the tone, not the topics: a reply that hides behind the job gets one more try. */
export function hidesBehindDuty(say: string): boolean {
  return DUTY_DODGE.test(normalise(say));
}

const CLAIMS_WALK = /(?<!nie )\b(ruszamy|idziemy|prowadze cie|zaprowadze cie|chodz za mna|juz prowadze|let'?s go|follow me|come with me)\b/;

/** Words of setting off, said when no walk is starting: speech must not promise what is not happening. */
export function claimsWalk(say: string): boolean {
  return CLAIMS_WALK.test(normalise(say));
}

/** Drops a sentence repeating a phrase from the last lines, if another sentence remains. */
export function dropRepeatedPhrases(say: string, phrases: string[], recentLines: string[]): string {
  const fresh = new Set(unusedPhrases(phrases, recentLines));
  const stale = phrases.filter((phrase) => !fresh.has(phrase)).map(normalise);
  if (stale.length === 0) return say;
  const sentences = say.split(/(?<=[.!?])\s+/);
  const kept = sentences.filter((s) => !stale.some((phrase) => normalise(s).includes(phrase)));
  return kept.length > 0 ? kept.join(' ') : say;
}

const sentencesOf = (text: string) => text.split(/(?<=[.!?])\s*/).map((s) => s.trim()).filter(Boolean);

function sameSentence(a: string, b: string): boolean {
  const x = tokens(a);
  const y = tokens(b);
  if (x.size === 0 || y.size === 0) return normalise(a) === normalise(b);
  const shared = [...x].filter((w) => y.has(w)).length;
  return shared / Math.min(x.size, y.size) >= 0.7;
}

/** Sentences already said in the last lines. A small model copies them from the conversation history. */
export function dropRepeatedSentences(say: string, recentLines: string[]): { text: string; dropped: number } {
  const recent = recentLines.flatMap(sentencesOf);
  const sentences = sentencesOf(say);
  const kept = sentences.filter((s) => !recent.some((r) => sameSentence(s, r)));
  return { text: kept.join(' '), dropped: sentences.length - kept.length };
}

export type DialogueLog = (kind: string, fields?: Record<string, unknown>) => void;

// Which skill lets a model propose an intent. A role lists intents, the agent must own the skill.
const INTENT_SKILL: Record<string, string> = { guide_to: 'guide', guide_cancel: 'guide', task_step: 'tasks' };
const RECENT_TURNS = 4;
const MEMORY_LIMIT = 5;
const CONTINUATION_DELAY_MS = 3300; // the engine allows one unsolicited line per 3 s
const DEFAULT_LEVEL = 'A2';
const RECENT_CALLS = 20;

interface RecentCall {
  atMs: number;
  npc: string;
  totalMs: number;
  promptTokens?: number;
  outputTokens?: number;
  promptChars: number;
  ok: boolean;
}

export class NpcDialogueProvider implements Provider {
  readonly name = 'npc-dialogue';
  private readonly client: DialogueClient;
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
  private recent: RecentCall[] = [];
  private lastReply: { atMs: number; npc: string; attempt: number; text: string } | null = null;
  private lastFallback: { atMs: number; npc: string; reason: string } | null = null;

  constructor(client: DialogueClient, store: NpcMemoryStore, catalog: NpcCatalog, retriever: MemoryRetriever, log: DialogueLog = () => {}, now: () => number = Date.now) {
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

  status(): Record<string, unknown> {
    return {
      model: this.client.cfg.model, activeRequests: this.active, queued: this.waiting.length, maxQueue: this.client.cfg.maxQueue,
      callsLastMinute: this.callTimes.filter((t) => this.now() - t < 60_000).length, maxCallsPerMinute: this.client.cfg.maxCallsPerMinute,
      lastReply: this.lastReply, lastFallback: this.lastFallback, recent: this.recent,
    };
  }

  private fallback(npc: string, reason: string): void {
    this.lastFallback = { atMs: this.now(), npc, reason };
  }

  /** Settings a player chose stay with this NPC and this character, across restarts. */
  private applyChoices(npcKey: string, policy: ConversationPolicy, playerGuid: number, text: string): void {
    const atMs = this.now();
    const language = parseLanguagePreference(text);
    if (language) this.store.setPref(npcKey, playerGuid, 'language', language, atMs);
    if (policy !== this.catalog.world.conversationPolicies.tutor) return;
    const lesson = parseLessonCommand(text);
    if (!lesson) return;
    if (lesson.level) this.store.setPref(npcKey, playerGuid, 'lesson_level', lesson.level, atMs);
    if (lesson.kind === 'start') this.store.setPref(npcKey, playerGuid, 'lesson', 'on', atMs);
    if (lesson.kind === 'end') this.store.setPref(npcKey, playerGuid, 'lesson', 'off', atMs);
  }

  decide(event: Envelope<EventPayload>, ctx: ProviderContext): Intent[] | Promise<Intent[]> {
    const fallback = this.rules.decide(event, ctx);
    const p = event.payload;
    if (!isConversationTurn(event) || (p.type !== 'player_greeted' && p.type !== 'player_said')) return fallback;
    this.lastTurnAtMs = this.now();
    const profile = this.catalog.profile(event.agentKey);
    if (profile) this.applyChoices(event.agentKey, this.catalog.policy(profile), p.playerGuid, p.text);
    // Changing one's mind about a walk needs no model, and only the guided player can do it.
    if (ctx.guide?.playerGuid === p.playerGuid && parseGuideCancel(p.text)) {
      return [{ action: 'guide_cancel', text: '', delayMs: 0, toPlayerGuid: p.playerGuid }];
    }
    const conversationId = `${event.agentKey}:${p.playerGuid}`;
    const version = (this.versions.get(conversationId) ?? 0) + 1;
    this.versions.set(conversationId, version);
    const plan = (origin: 'model' | 'rules', d?: ModelDecision, selectedRefs: string[] = []): DialoguePlan => ({
      conversationId, version, playerGuid: p.playerGuid, playerName: p.playerName, origin, selectedRefs,
      remember: d?.remember ?? '', promise: d?.promise ?? '', sentiment: d?.sentiment ?? 0,
    });
    const rulesReply = fallback.map((i) => ({ ...i, toPlayerGuid: p.playerGuid, plan: plan('rules') }));
    // An errand step is game logic with a fixed line: it needs no model and must not sound vague.
    if (rulesReply[0]?.action === 'task_step') return rulesReply;

    const cfg = this.client.cfg;
    this.callTimes = this.callTimes.filter((t) => this.now() - t < 60_000);
    if (this.callTimes.length >= cfg.maxCallsPerMinute) {
      this.log('model_skipped', { reason: 'budget', eventId: event.messageId });
      this.fallback(event.agentKey, 'budget');
      return rulesReply;
    }
    if (this.active >= cfg.maxConcurrent && this.waiting.length >= cfg.maxQueue) {
      this.log('model_skipped', { reason: 'queue_full', eventId: event.messageId });
      this.fallback(event.agentKey, 'queue_full');
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

  /** The reply as commands: one walk, or one or two chat lines addressed to this player. */
  private intents(p: { playerGuid: number; playerName: string; text: string }, ctx: ProviderContext, decision: ModelDecision, plan: DialoguePlan, canGuide: boolean): Intent[] {
    if (canGuide) {
      // The player asked and the skill allows it. A refusal in the model's words would contradict the walk.
      const walk = guideRequest(ctx, p.text, p.playerGuid, p.playerName)!;
      return [{ ...walk, text: decision.action === 'guide_to' ? splitReply(decision.say, agentRegistry().limits.maxSayLength)[0] : walk.text, plan }];
    }
    if (decision.action === 'guide_cancel' && ctx.guide?.playerGuid === p.playerGuid) {
      return [{ action: 'guide_cancel', text: '', delayMs: 0, toPlayerGuid: p.playerGuid }];
    }
    const [first, second] = splitReply(decision.say, agentRegistry().limits.maxSayLength);
    const line = (text: string, delayMs: number, linePlan: DialoguePlan): Intent => ({ action: 'say', text, delayMs, toPlayerGuid: p.playerGuid, plan: linePlan });
    return second
      ? [line(first, 0, plan), line(second, CONTINUATION_DELAY_MS, { ...plan, remember: '', promise: '', sentiment: 0, continuation: true })]
      : [line(first, 0, plan)];
  }

  private async ask(event: Envelope<EventPayload>, ctx: ProviderContext, p: Extract<EventPayload, { type: 'player_greeted' | 'player_said' }>,
    conversationId: string, version: number, plan: (o: 'model' | 'rules', d?: ModelDecision, refs?: string[]) => DialoguePlan, rulesReply: Intent[]): Promise<Intent[]> {
    // The player already said something newer in this conversation: answer that one instead.
    if (this.superseded(conversationId, version)) return [];
    const profile = this.catalog.profile(event.agentKey);
    if (!profile) return rulesReply;
    const cfg = this.client.cfg;
    const registry = agentRegistry();
    const npc = event.agentKey;
    const turns = this.store.recentTurns(npc, p.playerGuid, RECENT_TURNS + 1).filter((t) => t.text !== p.text).slice(-RECENT_TURNS);
    const plainName = (text: string) => withoutAddress(text, ctx.agent.npcName, ctx.agent.addressNames);
    const memories = this.retriever.retrieve({
      npcKey: npc, playerGuid: p.playerGuid, text: p.text, nowMs: ctx.nowMs, limit: MEMORY_LIMIT, excludeEventIds: new Set(turns.map((t) => t.id)),
    });
    const relationship = this.store.relationship(npc, p.playerGuid);
    const abilities = [...registry.capabilities(npc), ...registry.skills(npc)];
    // An errand step is decided by the player's words and the engine's state, never proposed by a model.
    const allowedIntents = this.catalog.allowedIntents(npc, abilities, INTENT_SKILL).filter((i) => i !== 'task_step');
    const placeIds = allowedIntents.includes('guide_to') ? ctx.agent.guidePlaces ?? [] : [];
    const asked = parseGuideRequest(p.text, registry.places);
    const canGuide = asked !== null && placeIds.includes(asked);
    const walkRequest: WalkRequest | null = asked ? { placeId: asked, label: registry.places[asked].label, allowed: canGuide } : null;
    const errands = Object.entries(p.tasks ?? {}).filter(([, state]) => state > 0).map(([id, state]) => {
      const task = taskDefinitions()[id];
      return `${task?.label ?? id}: ${task && state >= task.steps[task.steps.length - 1].to ? 'zakonczone' : 'w trakcie'}`;
    });
    const prefs = this.store.prefs(npc, p.playerGuid);
    const lesson: LessonState | null = prefs.lesson === 'on' ? { level: prefs.lesson_level ?? DEFAULT_LEVEL } : null;
    const walking = ctx.guide ? `prowadzisz ${ctx.guide.playerGuid === p.playerGuid ? 'te osobe' : 'kogos innego'} do miejsca: ${registry.places[ctx.guide.placeId]?.label ?? ctx.guide.placeId}` : null;
    const policy = this.catalog.policy(profile);
    const maxChars = Math.min(policy.maxReplyChars, cfg.maxReplyChars);
    const built = buildContext(this.catalog, {
      profile, playerName: p.playerName, playerText: plainName(p.text), relationship, facts: this.store.facts(npc, p.playerGuid),
      commitments: this.store.openCommitments(npc, p.playerGuid),
      recentTurns: turns.map((t) => (t.kind === 'said_by_player' ? { role: 'gracz' as const, text: plainName(t.text) } : { role: 'ty' as const, text: t.text })),
      memories, alarmActive: ctx.alarmActive ?? false, allowedIntents, placeIds, walkRequest, activity: walking, language: prefs.language ?? null, lesson, errands,
      sinceText: relationship ? sinceText(relationship.last_seen_ms, ctx.nowMs) : null,
    }, cfg.maxPromptChars);

    let nudge = '';
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        const r = await this.client.chat([{ role: 'system', content: built.system }, { role: 'user', content: `${built.user}${nudge}` }], { schema: responseSchema(allowedIntents, placeIds), purpose: 'npc' });
        const parsed = parseDecision(r.text, allowedIntents, maxChars, p.text, placeIds);
        this.log('model_decision', {
          eventId: event.messageId, npc, playerGuid: p.playerGuid, version, attempt, ok: parsed.ok,
          error: parsed.ok ? undefined : parsed.error, rejectedIntent: parsed.ok ? parsed.rejectedIntent : undefined, action: parsed.ok ? parsed.decision.action : undefined,
          totalMs: r.totalMs, promptTokens: r.promptCount, outputTokens: r.evalCount, promptChars: built.promptChars,
          sections: built.sections, selectedRefs: built.selectedRefs, knowledgeIds: built.knowledgeIds,
        });
        this.recent = [...this.recent, { atMs: this.now(), npc, totalMs: r.totalMs, promptTokens: r.promptCount, outputTokens: r.evalCount, promptChars: built.promptChars, ok: parsed.ok }].slice(-RECENT_CALLS);
        if (!parsed.ok) continue;
        const d = parsed.decision;
        if (d.action === 'guide_to' && !canGuide) {
          this.log('intent_refused', { eventId: event.messageId, npc, reason: 'no_request_from_player', target: d.target });
          d.action = 'none';
        }
        if (attempt === 1 && canGuide && d.action !== 'guide_to') {
          this.log('model_decision_retry', { eventId: event.messageId, reason: 'missing_guide_action', say: d.say });
          continue;
        }
        if (attempt === 1 && !walkRequest && policy !== this.catalog.world.conversationPolicies.immersive && hidesBehindDuty(d.say)) {
          this.log('model_decision_retry', { eventId: event.messageId, reason: 'hid_behind_duty', say: d.say });
          nudge = '\n\nTo nie jest prosba o dzialanie. Odpowiedz na to pytanie z wlasnej wiedzy, w swoim stylu, bez wspominania o obowiazkach.';
          continue;
        }
        if (!canGuide && !ctx.guide && claimsWalk(d.say)) {
          this.log('model_decision_retry', { eventId: event.messageId, reason: 'claimed_walk', say: d.say });
          if (attempt === 2) {
            this.fallback(npc, 'claimed_walk');
            return rulesReply;
          }
          nudge = '\n\nNigdzie teraz nie idziesz i nikogo nie prowadzisz. Nie mow, ze ruszacie.';
          continue;
        }
        if (missingMentions(d.say, built.mustMention).length > 0) {
          this.log('model_decision_retry', { eventId: event.messageId, reason: 'missing_recall', say: d.say });
          if (attempt === 1) continue;
          // Memory is ours, not the model's: what the player said is told from the store.
          if (built.recallLine) d.say = built.recallLine;
        }
        if (attempt === 1 && lesson && !ctx.alarmActive && !d.say.includes('?')) {
          this.log('model_decision_retry', { eventId: event.messageId, reason: 'lesson_without_question', say: d.say });
          nudge = '\n\nZakoncz jednym prostym pytaniem po angielsku.';
          continue;
        }
        if (built.asksAboutMarker && dodgesMarker(d.say)) {
          this.log('model_decision_retry', { eventId: event.messageId, reason: 'dodged_ai_question', say: d.say });
          if (attempt === 1) continue;
          d.say = this.catalog.world.aiDisclosureLine;
        }
        if (this.superseded(conversationId, version)) {
          this.log('model_decision_superseded', { eventId: event.messageId, version });
          return [];
        }
        const ownLines = turns.filter((t) => t.kind === 'said_by_npc').map((t) => t.text);
        // A fact the player asked for may be said twice; only small talk has to stay new.
        const mustKeep = built.mustMention.length > 0 || built.asksAboutMarker;
        const fresh = mustKeep ? { text: d.say, dropped: 0 } : dropRepeatedSentences(d.say, ownLines);
        if (fresh.text === '' && attempt === 1) {
          this.log('model_decision_retry', { eventId: event.messageId, reason: 'repeated_itself', say: d.say });
          nudge = '\n\nPowtarzasz swoje wczesniejsze zdania. Powiedz cos nowego, co odpowiada na ostatnia wypowiedz gracza.';
          continue;
        }
        d.say = dropRepeatedPhrases(fresh.text || d.say, profile.phrases, ownLines);
        this.lastReply = { atMs: this.now(), npc, attempt, text: d.say };
        return this.intents(p, ctx, d, plan('model', d, built.selectedRefs), canGuide);
      } catch (err) {
        this.log('model_failed', { eventId: event.messageId, attempt, error: (err as Error).message });
        this.fallback(npc, `model_failed: ${(err as Error).message}`.slice(0, 120));
        return rulesReply; // a timeout or a dead server will not be better a moment later
      }
    }
    this.fallback(npc, 'invalid_model_output');
    return rulesReply;
  }
}
