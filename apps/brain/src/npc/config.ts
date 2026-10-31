// NPC configuration layers (ADR 0008): world < role < variant < identity, plus knowledge entries.
// Files are read-only for Brain and the model; changing state lives in SQLite. Character layers can
// never grant abilities: capabilities come only from actorTypes, and allowedIntents is defined by
// the role and always intersected with them, so a variant cannot widen what the engine permits.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const DEFAULT_NPC_DIR = fileURLToPath(new URL('../../../../packages/contracts/npc', import.meta.url));

export interface ConversationPolicy {
  /** Default language of this policy; a player's wish or their own language can change it. */
  language: string;
  maxReplyChars: number;
  rules: string[];
  /** Repeated right before the player's words: a small model follows what stands closest. */
  reminder: string;
  /** The NPC speaks from the model's own knowledge of the real world. */
  generalKnowledge: boolean;
}

export interface WorldConfig {
  worldName: string;
  /** Rules that hold for every NPC under every policy. */
  safety: string[];
  conversationPolicies: Record<string, ConversationPolicy>;
  /** Said in place of a reply that dodges a direct question about being an AI. */
  aiDisclosureLine: string;
  incidents: Record<string, string>;
}

export interface RoleConfig {
  key: string;
  title: string;
  duties: string[];
  values: string[];
  motivations: string[];
  competencies: string[];
  knowledgeScopes: string[];
  goals: string[];
  constraints: string[];
  allowedIntents: string[];
  conversationPolicy: string;
}

export interface VariantConfig {
  key: string;
  role: string;
  temperament: string;
  speechStyle: string;
  /** Favourite phrases, used occasionally. */
  phrases?: string[];
  values?: string[];
  motivations?: string[];
  constraints?: string[];
}

export interface IdentityConfig {
  npcKey: string;
  variant: string;
  displayName: string;
  gender: 'm' | 'f';
  biography: string;
  goals?: string[];
  /** Overrides the role's policy. A way of talking, not an ability. */
  conversationPolicy?: string;
  initialRelationships?: { npc: string; note: string }[];
}

export interface KnowledgeEntry {
  id: string;
  category: 'lore' | 'mechanics' | 'geography' | 'factions' | 'social' | 'economy';
  scope: string;
  tags: string[];
  text: string;
  /** Where this fact comes from. Required for mechanics. */
  source?: string;
  serverVersion?: string;
}

/** Merged, read-only view of one NPC. Contains no state and no capabilities. */
export interface NpcProfile {
  npcKey: string;
  displayName: string;
  gender: 'm' | 'f';
  biography: string;
  roleKey: string;
  roleTitle: string;
  variantKey: string;
  temperament: string;
  speechStyle: string;
  phrases: string[];
  conversationPolicy: string;
  duties: string[];
  values: string[];
  motivations: string[];
  competencies: string[];
  goals: string[];
  constraints: string[];
  knowledgeScopes: string[];
  allowedIntents: string[];
  initialRelationships: { npc: string; note: string }[];
}

const CATEGORIES = ['lore', 'mechanics', 'geography', 'factions', 'social', 'economy'];
const FORBIDDEN_CHARACTER_FIELDS = ['capabilities', 'allowedIntents', 'actions', 'actor', 'skills'];
const isStr = (v: unknown): v is string => typeof v === 'string' && v.length > 0;
const isStrList = (v: unknown): v is string[] => Array.isArray(v) && v.every((x) => typeof x === 'string');
const unique = (...lists: (string[] | undefined)[]) => [...new Set(lists.flatMap((l) => l ?? []))];

function readDir<T>(dir: string): T[] {
  return readdirSync(dir).filter((f) => f.endsWith('.json')).sort()
    .map((f) => JSON.parse(readFileSync(join(dir, f), 'utf8')) as T);
}

export interface NpcConfigFiles {
  world: WorldConfig;
  roles: RoleConfig[];
  variants: VariantConfig[];
  identities: IdentityConfig[];
  knowledge: KnowledgeEntry[];
}

export function readNpcConfigFiles(dir: string = DEFAULT_NPC_DIR): NpcConfigFiles {
  return {
    world: JSON.parse(readFileSync(join(dir, 'world.json'), 'utf8')) as WorldConfig,
    roles: readDir<RoleConfig>(join(dir, 'roles')),
    variants: readDir<VariantConfig>(join(dir, 'variants')),
    identities: readDir<IdentityConfig>(join(dir, 'identities')),
    knowledge: readDir<{ source?: string; serverVersion?: string; entries: KnowledgeEntry[] }>(join(dir, 'knowledge'))
      .flatMap((f) => f.entries.map((e) => ({ source: f.source, serverVersion: f.serverVersion, ...e }))),
  };
}

/** Returns a list of problems; empty when all layers are valid and consistent. */
export function validateNpcConfig(files: NpcConfigFiles): string[] {
  const errors: string[] = [];
  const { world, roles, variants, identities, knowledge } = files;
  if (!isStr(world.worldName) || !isStrList(world.safety) || world.safety.length === 0) errors.push('world: worldName and safety are required');
  const policies = world.conversationPolicies ?? {};
  for (const [key, p] of Object.entries(policies)) {
    if (!isStr(p.language) || !isStrList(p.rules) || p.rules.length === 0 || !(p.maxReplyChars > 0) || !isStr(p.reminder)) errors.push(`policy ${key}: language, rules, reminder and maxReplyChars are required`);
  }
  if (!isStr(world.aiDisclosureLine)) errors.push('world: aiDisclosureLine is required');
  const roleKeys = new Set(roles.map((r) => r.key));
  const variantKeys = new Set(variants.map((v) => v.key));
  const scopes = new Set(roles.flatMap((r) => r.knowledgeScopes ?? []));

  for (const r of roles) {
    const e = (m: string) => errors.push(`role ${r.key}: ${m}`);
    if (!isStr(r.key) || !isStr(r.title)) e('key and title are required');
    for (const k of ['duties', 'values', 'motivations', 'competencies', 'knowledgeScopes', 'goals', 'constraints', 'allowedIntents'] as const) {
      if (!isStrList(r[k])) e(`${k} must be a list of strings`);
    }
    if (!r.allowedIntents?.includes('none')) e('allowedIntents must include none');
    if (!(r.conversationPolicy in policies)) e(`unknown conversationPolicy ${r.conversationPolicy}`);
  }
  for (const v of variants) {
    const e = (m: string) => errors.push(`variant ${v.key}: ${m}`);
    if (!roleKeys.has(v.role)) e(`unknown role ${v.role}`);
    if (!isStr(v.temperament) || !isStr(v.speechStyle)) e('temperament and speechStyle are required');
    for (const f of FORBIDDEN_CHARACTER_FIELDS) if (f in v) e(`${f} is not allowed: character layers cannot grant abilities`);
  }
  for (const i of identities) {
    const e = (m: string) => errors.push(`identity ${i.npcKey}: ${m}`);
    if (!/^[a-z][a-z0-9_]*$/.test(i.npcKey ?? '')) e('npcKey format');
    if (!variantKeys.has(i.variant)) e(`unknown variant ${i.variant}`);
    if (!isStr(i.displayName) || !isStr(i.biography)) e('displayName and biography are required');
    if (i.gender !== 'm' && i.gender !== 'f') e('gender must be m or f');
    if (i.conversationPolicy !== undefined && !(i.conversationPolicy in policies)) e(`unknown conversationPolicy ${i.conversationPolicy}`);
    for (const f of FORBIDDEN_CHARACTER_FIELDS) if (f in i) e(`${f} is not allowed: character layers cannot grant abilities`);
  }
  const ids = new Set<string>();
  for (const k of knowledge) {
    const e = (m: string) => errors.push(`knowledge ${k.id}: ${m}`);
    if (ids.has(k.id)) e('duplicate id');
    ids.add(k.id);
    if (!CATEGORIES.includes(k.category)) e(`unknown category ${k.category}`);
    if (!scopes.has(k.scope)) e(`scope ${k.scope} is not used by any role`);
    if (!isStrList(k.tags) || k.tags.length === 0 || !isStr(k.text)) e('tags and text are required');
    if (k.category === 'mechanics' && (!isStr(k.source) || !isStr(k.serverVersion))) e('mechanics need a source and a server version');
  }
  return errors;
}

/** Merge rule: scalars come from the most specific layer, lists accumulate without duplicates. */
export function buildProfile(identity: IdentityConfig, variant: VariantConfig, role: RoleConfig): NpcProfile {
  return {
    npcKey: identity.npcKey,
    displayName: identity.displayName,
    gender: identity.gender,
    biography: identity.biography,
    roleKey: role.key,
    roleTitle: role.title,
    variantKey: variant.key,
    temperament: variant.temperament,
    speechStyle: variant.speechStyle,
    phrases: variant.phrases ?? [],
    conversationPolicy: identity.conversationPolicy ?? role.conversationPolicy,
    duties: role.duties,
    values: unique(role.values, variant.values),
    motivations: unique(role.motivations, variant.motivations),
    competencies: role.competencies,
    goals: unique(role.goals, identity.goals),
    constraints: unique(role.constraints, variant.constraints),
    knowledgeScopes: role.knowledgeScopes,
    allowedIntents: role.allowedIntents,
    initialRelationships: identity.initialRelationships ?? [],
  };
}

export class NpcCatalog {
  readonly world: WorldConfig;
  readonly knowledge: KnowledgeEntry[];
  private readonly profiles = new Map<string, NpcProfile>();

  constructor(files: NpcConfigFiles) {
    const errors = validateNpcConfig(files);
    if (errors.length > 0) throw new Error(`Invalid NPC configuration:\n${errors.join('\n')}`);
    this.world = files.world;
    this.knowledge = files.knowledge;
    for (const i of files.identities) {
      const variant = files.variants.find((v) => v.key === i.variant)!;
      const role = files.roles.find((r) => r.key === variant.role)!;
      this.profiles.set(i.npcKey, buildProfile(i, variant, role));
    }
  }

  static load(dir: string = DEFAULT_NPC_DIR): NpcCatalog {
    return new NpcCatalog(readNpcConfigFiles(dir));
  }

  profile(npcKey: string): NpcProfile | undefined {
    return this.profiles.get(npcKey);
  }

  keys(): string[] {
    return [...this.profiles.keys()].sort();
  }

  policy(profile: NpcProfile): ConversationPolicy {
    return this.world.conversationPolicies[profile.conversationPolicy];
  }

  /** Intents the model may propose: the role's list limited by the abilities of this agent's body. */
  allowedIntents(npcKey: string, abilities: string[], intentAbility: Record<string, string>): string[] {
    const p = this.profile(npcKey);
    if (!p) return ['none'];
    return p.allowedIntents.filter((i) => i === 'none' || abilities.includes(intentAbility[i] ?? ''));
  }
}
