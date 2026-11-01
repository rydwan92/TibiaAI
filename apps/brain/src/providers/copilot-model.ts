// Models from a GitHub Copilot account (ADR 0011). The agent engine behind the SDK can run a shell
// and edit files, so it gets none of that here: no tools, an empty folder, no config discovery, and
// every permission request refused. A model only ever returns text that the caller validates.
// Budgets live in this application: failures surface as errors so the caller falls back to rules.
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import type { ChatMessage, ChatOptions, ChatResult, DialogueClient, ModelClient } from './local-model.ts';
import { dayStartMs, monthStartMs, type CreditLedger } from './ledger.ts';

export interface CloudAiConfig {
  allowedModels: string[];
  maxCallsPerMinute: number;
  /** Calls running at once; each is a session of its own. */
  maxConcurrent: number;
  maxQueue: number;
  maxPromptChars: number;
  maxOutputTokens: number;
  timeoutMs: number;
  retries: number;
  retryDelayMs: number;
  failureCooldownMs: number;
  reserveCredits: number;
  runBudgetCredits: number;
  dailyBudgetCredits: number;
  monthlyBudgetCredits: number;
}

export interface ModelRoute { provider: string; model: string; effort: string }
export interface CallUsage { inputTokens: number; outputTokens: number; cacheReadTokens: number; credits: number; durationMs: number }
export interface TransportRequest { model: string; effort: string; system: string; prompt: string; timeoutMs: number; maxOutputTokens: number }
export interface TransportReply { text: string; usage: CallUsage[] }
export interface Transport {
  send(req: TransportRequest): Promise<TransportReply>;
  stop(): Promise<void>;
}

export const DEFAULT_CLOUD_AI_PATH = new URL('../../../../packages/contracts/cloud-ai.json', import.meta.url);

export function validateCloudAiConfig(cfg: CloudAiConfig): string[] {
  const errors: string[] = [];
  if (!Array.isArray(cfg.allowedModels) || cfg.allowedModels.length === 0) errors.push('allowedModels is empty');
  for (const k of ['maxCallsPerMinute', 'maxConcurrent', 'maxQueue', 'maxPromptChars', 'maxOutputTokens', 'timeoutMs', 'failureCooldownMs'] as const) {
    if (!Number.isInteger(cfg[k]) || cfg[k] <= 0) errors.push(`${k} must be a positive integer`);
  }
  for (const k of ['reserveCredits', 'runBudgetCredits', 'dailyBudgetCredits', 'monthlyBudgetCredits'] as const) {
    if (typeof cfg[k] !== 'number' || cfg[k] <= 0) errors.push(`${k} must be positive`);
  }
  return errors;
}

export function loadCloudAiConfig(path: URL | string = DEFAULT_CLOUD_AI_PATH): CloudAiConfig {
  const cfg = JSON.parse(readFileSync(path, 'utf8')) as CloudAiConfig;
  const errors = validateCloudAiConfig(cfg);
  if (errors.length > 0) throw new Error(`Invalid cloud AI policy:\n${errors.join('\n')}`);
  return cfg;
}

/** The object inside whatever wrapping a model puts around it. */
export function extractJson(text: string): string {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('no JSON object in the answer');
  return text.slice(start, end + 1);
}

interface Schema { properties?: Record<string, { enum?: unknown[]; type?: string }>; required?: string[] }

/** Returns what is wrong with an answer, so a bad one can be counted instead of acted on. */
export function schemaProblem(schema: Schema, value: unknown): string | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return 'not an object';
  const obj = value as Record<string, unknown>;
  for (const key of schema.required ?? []) if (!(key in obj)) return `missing ${key}`;
  for (const [key, prop] of Object.entries(schema.properties ?? {})) {
    const v = obj[key];
    if (v === undefined) continue;
    if (prop.enum && !prop.enum.includes(v)) return `${key} outside the allowed values`;
    if (prop.type === 'string' && typeof v !== 'string') return `${key} is not text`;
    if (prop.type === 'integer' && !Number.isInteger(v)) return `${key} is not an integer`;
  }
  return null;
}

const CREDIT_IN_NANO = 1e9;
const HARD_EFFORT = 'medium';

/** One SDK client and a fresh session per call: a session would otherwise resend its history. */
export function sdkTransport(boxDir: string, load: () => Promise<any> = () => import('@github/copilot-sdk')): Transport {
  mkdirSync(boxDir, { recursive: true });
  let started: Promise<any> | null = null; // the SDK is loaded only when a character really uses it
  const client = () => {
    started ??= load().then(async ({ CopilotClient }) => {
      const c = new CopilotClient({ mode: 'empty', baseDirectory: boxDir, workingDirectory: boxDir, logLevel: 'error' });
      await c.start();
      return c;
    });
    return started;
  };
  return {
    async send(req) {
      const c = await client();
      const session = await c.createSession({
        model: req.model,
        reasoningEffort: req.effort,
        modelCapabilities: { limits: { max_output_tokens: req.maxOutputTokens } },
        availableTools: [],
        onPermissionRequest: () => ({ kind: 'reject', feedback: 'no tools here' }),
        systemMessage: { mode: 'replace', content: req.system },
        infiniteSessions: { enabled: false },
      });
      const usage: CallUsage[] = [];
      session.on('assistant.usage', (e: { data: { inputTokens?: number; outputTokens?: number; cacheReadTokens?: number; duration?: number; copilotUsage?: { totalNanoAiu?: number } } }) => {
        usage.push({
          inputTokens: e.data.inputTokens ?? 0,
          outputTokens: e.data.outputTokens ?? 0,
          cacheReadTokens: e.data.cacheReadTokens ?? 0,
          credits: (e.data.copilotUsage?.totalNanoAiu ?? 0) / CREDIT_IN_NANO,
          durationMs: e.data.duration ?? 0,
        });
      });
      try {
        const reply = await session.sendAndWait({ prompt: req.prompt }, req.timeoutMs);
        if (reply?.data?.toolRequests?.length) throw new Error('model asked for a tool');
        return { text: String(reply?.data?.content ?? ''), usage };
      } catch (err) {
        await session.abort().catch(() => undefined);
        throw Object.assign(err as Error, { usage });
      } finally {
        await session.disconnect().catch(() => undefined);
        await c.deleteSession(session.sessionId).catch(() => undefined);
      }
    },
    async stop() {
      if (started) await (await started).stop().catch(() => undefined);
    },
  };
}

/** Shared by all characters on the account: one call at a time, one budget. */
export class CopilotModels {
  readonly cfg: CloudAiConfig;
  private readonly transport: Transport;
  private readonly ledger: CreditLedger;
  private readonly now: () => number;
  private readonly stopFile: string;
  private readonly runStartedAt: number;
  private running = 0;
  private waiting: (() => void)[] = [];
  private pending = 0;
  private calls: number[] = [];
  private coolUntil = 0;

  constructor(cfg: CloudAiConfig, transport: Transport, ledger: CreditLedger, stopFile: string, now: () => number = Date.now) {
    const errors = validateCloudAiConfig(cfg);
    if (errors.length > 0) throw new Error(`Invalid cloud AI policy:\n${errors.join('\n')}`);
    this.cfg = cfg;
    this.transport = transport;
    this.ledger = ledger;
    this.stopFile = stopFile;
    this.now = now;
    this.runStartedAt = now();
  }

  /** Why no new call may start, or null when one may. */
  blockedBy(): string | null {
    if (existsSync(this.stopFile)) return 'stopped by the operator';
    const reserve = this.cfg.reserveCredits;
    if (this.ledger.spentSince(monthStartMs(this.now())) + reserve > this.cfg.monthlyBudgetCredits) return 'monthly budget used';
    if (this.ledger.spentSince(dayStartMs(this.now())) + reserve > this.cfg.dailyBudgetCredits) return 'daily budget used';
    if (this.ledger.spentSince(this.runStartedAt) + reserve > this.cfg.runBudgetCredits) return 'run budget used';
    if (this.now() < this.coolUntil) return 'cooling down after a failure';
    return null;
  }

  private hasRoom(): boolean {
    this.calls = this.calls.filter((t) => this.now() - t < 60_000);
    return this.calls.length < this.cfg.maxCallsPerMinute && this.pending < this.cfg.maxQueue;
  }

  available(): boolean {
    return this.blockedBy() === null && this.hasRoom();
  }

  busyForNow(): boolean {
    return this.blockedBy() === null && !this.hasRoom();
  }

  /** Room for what can wait: small talk gives way to decisions and to people. */
  spare(): boolean {
    return this.available() && this.calls.length < this.cfg.maxCallsPerMinute / 2 && this.pending < this.cfg.maxConcurrent;
  }

  status(): Record<string, unknown> {
    return {
      creditsToday: Number(this.ledger.spentSince(dayStartMs(this.now())).toFixed(4)),
      creditsRun: Number(this.ledger.spentSince(this.runStartedAt).toFixed(4)),
      creditsMonth: Number(this.ledger.spentSince(monthStartMs(this.now())).toFixed(4)),
      dailyBudget: this.cfg.dailyBudgetCredits,
      monthlyBudget: this.cfg.monthlyBudgetCredits,
      runBudget: this.cfg.runBudgetCredits,
      blockedBy: this.blockedBy(),
    };
  }

  forAgent(agentKey: string, route: ModelRoute): ModelClient {
    if (!this.cfg.allowedModels.includes(route.model)) throw new Error(`model ${route.model} is not in allowedModels`);
    return {
      available: () => this.available(),
      busyForNow: () => this.busyForNow(),
      spare: () => this.spare(),
      chat: (messages, options = {}) => this.chat(agentKey, route, messages, options),
    };
  }

  /** NPC conversations when the local model is off. The dialogue layer keeps its own limits on top. */
  forDialogue(route: ModelRoute, maxReplyChars: number): DialogueClient {
    return { ...this.forAgent('npc', route), cfg: { model: route.model, maxQueue: this.cfg.maxQueue, maxCallsPerMinute: this.cfg.maxCallsPerMinute, maxConcurrent: this.cfg.maxConcurrent, maxReplyChars, maxPromptChars: this.cfg.maxPromptChars } };
  }

  private chat(agentKey: string, route: ModelRoute, messages: ChatMessage[], options: ChatOptions): Promise<ChatResult> {
    const chars = messages.reduce((n, m) => n + m.content.length, 0);
    if (chars > this.cfg.maxPromptChars) return Promise.reject(new Error(`prompt too long: ${chars} chars`));
    const blocked = this.blockedBy();
    if (blocked) return Promise.reject(new Error(blocked));
    if (!this.hasRoom()) return Promise.reject(new Error('too many calls'));
    this.calls.push(this.now());
    this.pending++;
    return this.inTurn(() => this.call(agentKey, route, messages, options)).finally(() => { this.pending--; });
  }

  private async inTurn<T>(work: () => Promise<T>): Promise<T> {
    if (this.running >= this.cfg.maxConcurrent) await new Promise<void>((go) => this.waiting.push(go));
    this.running++;
    try {
      return await work();
    } finally {
      this.running--;
      this.waiting.shift()?.();
    }
  }

  private note(agentKey: string, base: ModelRoute, effort: string, purpose: string, startedAt: number, usage: CallUsage[], ok: boolean, error: string): void {
    const sum = (pick: (u: CallUsage) => number) => usage.reduce((n, u) => n + pick(u), 0);
    const estimated = usage.length === 0;
    this.ledger.record({
      atMs: this.now(), agentKey, model: base.model, effort, purpose,
      inputTokens: sum((u) => u.inputTokens), outputTokens: sum((u) => u.outputTokens), cacheReadTokens: sum((u) => u.cacheReadTokens),
      credits: estimated ? this.cfg.reserveCredits : sum((u) => u.credits), estimated,
      durationMs: this.now() - startedAt, ok, error: error.slice(0, 160),
    });
  }

  private async call(agentKey: string, route: ModelRoute, messages: ChatMessage[], options: ChatOptions): Promise<ChatResult> {
    const purpose = options.purpose ?? 'chat';
    const effort = options.hard ? HARD_EFFORT : route.effort;
    const schema = options.schema as Schema | undefined;
    const answerAs = schema ? `\n\nOdpowiedz wylacznie jednym obiektem JSON, bez komentarza i bez znacznikow kodu. Schemat: ${JSON.stringify(schema)}` : '';
    const system = messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n') + answerAs;
    const prompt = messages.filter((m) => m.role === 'user').map((m) => m.content).join('\n\n');
    for (let attempt = 0; ; attempt++) {
      const blocked = this.blockedBy();
      if (blocked) throw new Error(blocked); // the budget can run out while a call waits in the queue
      const startedAt = this.now();
      try {
        const reply = await this.transport.send({ model: route.model, effort, system, prompt, timeoutMs: options.timeoutMs ?? this.cfg.timeoutMs, maxOutputTokens: this.cfg.maxOutputTokens });
        let text = reply.text;
        try {
          if (schema) {
            text = extractJson(text);
            const problem = schemaProblem(schema, JSON.parse(text));
            if (problem) throw new Error(problem);
          }
        } catch (err) {
          this.note(agentKey, route, effort, purpose, startedAt, reply.usage, false, `bad answer: ${(err as Error).message}`);
          throw Object.assign(new Error(`bad answer: ${(err as Error).message}`), { final: true });
        }
        this.note(agentKey, route, effort, purpose, startedAt, reply.usage, true, '');
        const sum = (pick: (u: CallUsage) => number) => reply.usage.reduce((n, u) => n + pick(u), 0);
        return { text, totalMs: this.now() - startedAt, evalCount: sum((u) => u.outputTokens), promptCount: sum((u) => u.inputTokens), evalMs: sum((u) => u.durationMs), loadMs: 0 };
      } catch (err) {
        const e = err as Error & { usage?: CallUsage[]; final?: boolean };
        if (e.final) throw e;
        this.note(agentKey, route, effort, purpose, startedAt, e.usage ?? [], false, e.message);
        if (attempt >= this.cfg.retries || /timeout/i.test(e.message)) {
          this.coolUntil = this.now() + this.cfg.failureCooldownMs;
          throw e;
        }
        await new Promise((resolve) => setTimeout(resolve, this.cfg.retryDelayMs));
      }
    }
  }

  stop(): Promise<void> {
    return this.transport.stop();
  }
}
