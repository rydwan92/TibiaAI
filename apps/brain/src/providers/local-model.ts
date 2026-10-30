// Local model access (ADR 0007). Everything here is deny-by-default: only a loopback endpoint,
// only allowlisted models that Ollama itself reports as local, no redirects, no keys, no cloud
// fallback. Failures surface as errors so the caller can fall back to the rules provider.
import { readFileSync } from 'node:fs';

export interface LocalAiConfig {
  endpoint: string;
  allowedModels: string[];
  model: string;
  timeoutMs: number;
  maxConcurrent: number;
  maxQueue: number;
  maxCallsPerMinute: number;
  maxPromptChars: number;
  maxOutputTokens: number;
  maxReplyChars: number;
  keepAlive: string;
}

const LOOPBACK = new Set(['127.0.0.1', 'localhost', '[::1]', '::1']);
const CLOUD_NAME = /(:|-)cloud$/i;

export const DEFAULT_LOCAL_AI_PATH = new URL('../../../../packages/contracts/local-ai.json', import.meta.url);

/** Returns a list of problems; empty when the policy is valid. */
export function validateLocalAiConfig(cfg: LocalAiConfig): string[] {
  const errors: string[] = [];
  let url: URL | null = null;
  try {
    url = new URL(cfg.endpoint);
  } catch {
    errors.push('endpoint is not a URL');
  }
  if (url) {
    if (url.protocol !== 'http:') errors.push('endpoint must use http on loopback');
    if (!LOOPBACK.has(url.hostname)) errors.push(`endpoint ${url.hostname} is not loopback`);
    if (url.username || url.password) errors.push('endpoint must not carry credentials');
  }
  if (!Array.isArray(cfg.allowedModels) || cfg.allowedModels.length === 0) errors.push('allowedModels is empty');
  for (const m of cfg.allowedModels ?? []) if (CLOUD_NAME.test(m)) errors.push(`cloud model not allowed: ${m}`);
  if (!cfg.allowedModels?.includes(cfg.model)) errors.push(`model ${cfg.model} is not in allowedModels`);
  for (const k of ['timeoutMs', 'maxConcurrent', 'maxQueue', 'maxCallsPerMinute', 'maxPromptChars', 'maxOutputTokens', 'maxReplyChars'] as const) {
    if (!Number.isInteger(cfg[k]) || cfg[k] <= 0) errors.push(`${k} must be a positive integer`);
  }
  return errors;
}

export function loadLocalAiConfig(path: URL | string = DEFAULT_LOCAL_AI_PATH): LocalAiConfig {
  const cfg = JSON.parse(readFileSync(path, 'utf8')) as LocalAiConfig;
  const errors = validateLocalAiConfig(cfg);
  if (errors.length > 0) throw new Error(`Invalid local AI policy:\n${errors.join('\n')}`);
  return cfg;
}

export interface ChatMessage { role: 'system' | 'user'; content: string }
export interface ChatResult { text: string; totalMs: number; evalCount: number; evalMs: number; loadMs: number }

export class LocalModelClient {
  readonly cfg: LocalAiConfig;
  private readonly fetchFn: typeof fetch;

  constructor(cfg: LocalAiConfig, fetchFn: typeof fetch = fetch) {
    const errors = validateLocalAiConfig(cfg);
    if (errors.length > 0) throw new Error(`Invalid local AI policy:\n${errors.join('\n')}`);
    this.cfg = cfg;
    this.fetchFn = fetchFn;
  }

  private async post(path: string, body: unknown | undefined, timeoutMs: number): Promise<any> {
    const res = await this.fetchFn(`${this.cfg.endpoint}${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      redirect: 'error', // never follow a redirect to a remote service
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) throw new Error(`ollama ${path}: HTTP ${res.status}`);
    return res.json();
  }

  /** Confirms the configured model exists and that Ollama reports it as local. */
  async verifyModel(): Promise<void> {
    const { models } = await this.post('/api/tags', undefined, 3000) as { models: { name: string; remote_host?: string }[] };
    const m = models.find((x) => x.name === this.cfg.model);
    if (!m) throw new Error(`model ${this.cfg.model} is not installed`);
    if (m.remote_host) throw new Error(`model ${this.cfg.model} runs remotely (${m.remote_host})`);
  }

  async chat(messages: ChatMessage[], options: { json?: boolean; timeoutMs?: number; maxTokens?: number } = {}): Promise<ChatResult> {
    const chars = messages.reduce((n, m) => n + m.content.length, 0);
    if (chars > this.cfg.maxPromptChars) throw new Error(`prompt too long: ${chars} chars`);
    const t0 = Date.now();
    const data = await this.post('/api/chat', {
      model: this.cfg.model,
      messages,
      stream: false,
      keep_alive: this.cfg.keepAlive,
      ...(options.json ? { format: 'json' } : {}),
      options: { num_predict: options.maxTokens ?? this.cfg.maxOutputTokens, temperature: 0.4 },
    }, options.timeoutMs ?? this.cfg.timeoutMs);
    return {
      text: String(data.message?.content ?? ''),
      totalMs: Date.now() - t0,
      evalCount: data.eval_count ?? 0,
      evalMs: Math.round((data.eval_duration ?? 0) / 1e6),
      loadMs: Math.round((data.load_duration ?? 0) / 1e6),
    };
  }
}
