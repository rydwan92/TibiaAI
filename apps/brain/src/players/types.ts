// Shapes shared by the parts of a player agent: what the world offers, what a body reports and what a
// mind keeps.
import type { Pos } from './nav.ts';

/** How a character's memory leans: multipliers on how much a kind of memory matters, 1 is the common measure. */
export interface MemoryStyle {
  fights?: number;
  friends?: number;
  trade?: number;
  danger?: number;
  /** Days kept in full detail before compression; 7 when not set. */
  detailDays?: number;
}

export interface PlayerDef {
  /** The town it lives in and comes back to after a death; the world's home town when not set. */
  home?: string;
  /** Level the character is created at (scripts\\player-agents.ps1 -Create). */
  startLevel?: number;
  /** See MemoryStyle: another character remembers other things from the same day. */
  memory?: MemoryStyle;
  character: string;
  vocation: string;
  kit?: string;
  bravery: number;
  curiosity: number;
  sociability: number;
  greed: number;
  voice: string;
  /** 'assistant': a personal helper, see assistant.ts. It does not play and keeps no world memory. */
  role?: string;
  /** What the character is after in the long run, in its own words. */
  ambition?: string;
  /** 0..1, how fast a grudge fades: 0.5 is the common pace, near 0 it stays for hours. */
  forgives?: number;
  /** 0..1, how likely a fight starts for fun or for loot rather than over a grudge. */
  mischief?: number;
  /** 'home': knows hunting grounds only around home and where it has been. 'told': only where it has been or what people told it. */
  mapKnowledge?: 'all' | 'home' | 'told';
  /** Plays by the same rules as a person: no refill from the developer kit after a bad death. */
  selfReliant?: boolean;
  /** A metered model of its own; everyone else shares the local one. The character stays the same if this changes. */
  model?: { provider: string; model: string; effort: string };
}

export interface MonsterFacts {
  health: number;
  experience: number;
  peakDamage: number;
  attacks: string[];
  weakTo: string[];
  hostile: boolean;
}

export interface FloorPoint {
  x: number;
  y: number;
  z: number;
  kind: string;
  dir: 'up' | 'down';
  /** A teleport's destination. */
  to?: Pos;
}

export interface Ground {
  name: string;
  town: string;
  tier: number;
  monsters: string[];
  x: number;
  y: number;
  z: number;
}

export interface SpellFacts {
  words: string;
  group: string;
  level: number;
  mana: number;
  premium: boolean;
  vocations: string[];
  needsTarget: boolean;
}

export interface RuneFacts {
  id: number;
  group: string;
  level: number;
  magicLevel: number;
  needsTarget: boolean;
  vocations: string[];
}

/** A piece of armour on a merchant's shelf: real prices, value is protection (defense for a shield). */
export interface GearOffer {
  id: number;
  name: string;
  price: number;
  slot: number;
  value: number;
  level: number;
  /** Oz, as the client reports free capacity. */
  weight: number;
}

export interface WorldFacts {
  /** Merchants of the datapack who sell potions, for those far from the home merchant. */
  shops?: { name: string; x: number; y: number; z: number }[];
  /** Advice on how the game is played, from player_guide.json. */
  guide?: { money: string[]; growth: string[]; people: string[] };
  /** Where people gather on purpose. */
  square?: { name: string; x: number; y: number; z: number };
  gearShop?: { npc: string; x: number; y: number; z: number; items: GearOffer[] };
  /** How much each piece of armour protects, by item id. */
  gearValues?: Record<string, { slot: number; value: number }>;
  /** Personal helpers: characters talk to people, not to these. */
  helpers?: Set<string>;
  home?: string;
  teachers?: Teacher[];
  /** Spells a developer kit teaches; a character without such a kit learns them from teachers. */
  kitSpells?: Record<string, string[]>;
  monsters: Record<string, MonsterFacts>;
  points: FloorPoint[];
  towns: { name: string; temple: { x: number; y: number; z: number } }[];
  grounds?: Ground[];
  spells?: Record<string, SpellFacts>;
  runes?: Record<string, RuneFacts>;
  vocationTips?: Record<string, string>;
  npcs?: { name: string; x: number; y: number; z: number }[];
  merchant?: { name: string; x: number; y: number; z: number };
  supplies?: Record<string, { id: number; count: number }[]>;
  /** Potions by need, weakest first: who may drink them from which level. */
  potions?: { id: number; kind: 'health' | 'mana'; level: number; vocations: string[] }[];
  /** What each kit wears, by inventory slot. */
  gear?: Record<string, { id: number; slot: number }[]>;
  /** Item ids the merchant sells. */
  sold?: number[];
  /** Item ids worth carrying home: what the merchant buys. */
  sellable?: number[];
  /** Where a locker can be used from. */
  depots?: { x: number; y: number; z: number; locker: { x: number; y: number; z: number } }[];
  /** in_character: a player among players; honest: admits to being an AI when asked. */
  identity?: string;
}

export interface Seen {
  name: string;
  kind: 'monster' | 'player' | 'npc';
  hp: number;
  x: number;
  y: number;
  z: number;
}

export interface BodyState {
  /** Set by the mind: people this character will leave alone for now. */
  sparing?: string[];
  /** Set by the mind: the character knows only what it found out, see mapKnowledge. */
  knownNear?: { x: number; y: number; z: number };
  /** Set by the mind: how far around knownNear it knows the land without having been there. */
  knownRange?: number;
  /** Set by the mind: spell names the server confirmed, lower case. */
  known?: string[];
  /** Set by the mind: 0..1, how much this character likes to tease friends. */
  mischief?: number;
  /** Set by the mind: it wants its savings for a journey. */
  wantsCash?: boolean;
  /** Set by the mind: towns it has been to; around them it knows the land as around home. */
  knownTowns?: { x: number; y: number; z: number }[];
  atMs: number;
  online: boolean;
  name: string;
  level: number;
  experience: number;
  hp: number;
  hpMax: number;
  mana: number;
  manaMax: number;
  x: number;
  y: number;
  z: number;
  target: string;
  potions: { health: number; mana: number };
  gold?: number;
  /** Item id per inventory slot, 0 when empty. */
  worn?: Record<string, number>;
  /** How many of each piece of gear the character owns, worn or carried. */
  have?: Record<string, number>;
  /** Was at the shop a moment ago, so one more visit cannot help. */
  justShopped?: boolean;
  /** Gear gone since it was last checked, by item id. */
  missing?: number[];
  vocation?: string;
  magicLevel?: number;
  arrows?: number;
  food?: number;
  cap?: number;
  vips?: { name: string; online: boolean }[];
  seen: Seen[];
  goalId: number;
}

export interface BodyEvent {
  kind: string;
  atMs: number;
  /** Which run of the body wrote this, and its place in that run. */
  session?: string;
  seq?: number;
  from?: string;
  text?: string;
  level?: number;
  private?: boolean;
  /** A line the server sent to everyone. */
  broadcast?: boolean;
  online?: boolean;
  error?: string;
  money?: number;
  stored?: number;
  taken?: number;
  ok?: boolean;
}

export interface Lesson { spell: string; word: string; price: number; level: number; vocations: string[]; premium: boolean }
export interface Teacher { npc: string; x: number; y: number; z: number; spells: Lesson[] }

export type Goal = { type: string; id: number; byKeeper?: boolean; prank?: boolean; greet?: boolean; offer?: GearOffer; name?: string; word?: string; words?: string[]; lesson?: { spell: string; word: string }; errand?: 'shop' | 'depot' | 'withdraw' | 'learn'; locker?: { x: number; y: number; z: number }; buy?: { id: number; count: number }[]; deposit?: number[]; withdraw?: { id: number; count: number }[]; x?: number; y?: number; z?: number; kind?: string; heading?: { x: number; y: number }; flee?: boolean; avoid?: boolean };

export interface Option {
  id: string;
  label: string;
  goal: Omit<Goal, 'id'>;
  /** 0..1, what is known to speak against it: a death there, a warning. Read by choice, not parsed from words. */
  risk?: number;
  /** 0..1, how good it was the last times, against this character's best. */
  value?: number;
}

/** Advice that reached this character through speech; nothing else carries knowledge between minds. */
export interface Tip {
  from: string;
  ground: Ground;
}

/** A trip together. The one who asked follows; the other simply goes on playing. */
export interface Team {
  with: string;
  lead: boolean;
  following: boolean;
  waiting: boolean;
  untilMs: number;
  lastSeenAt: number;
  lostAsks: number;
  /** Where the person was last seen; losing them means going there first. */
  at?: { x: number; y: number; z: number };
  chased?: boolean;
  counted?: boolean;
  /** What the trip started from, to remember what came of it. */
  startKills?: number;
  startExp?: number;
  /** Where the leader takes them. */
  place?: string;
}

export interface Finding {
  name: string;
  monsters: string[];
  danger: boolean;
}

/** A place in one character's memory, tied to what it did there and what that paid. */
export interface Place {
  id: string;
  name: string;
  why: 'hunt' | 'shop' | 'depot' | 'boat' | 'teacher' | 'town';
  /** What one comes here for, in the character's words. */
  doing: string;
  x: number;
  y: number;
  z: number;
  monsters: string[];
  visits: number;
  minutes: number;
  exp: number;
  gold: number;
  kills: number;
  deaths: number;
  lastAt: number;
}

/** Something that stays between two people when the details are gone. */
export interface Moment {
  atMs: number;
  text: string;
  weight: number;
}

/** A promise. It stays open through compression until it is kept, or breaks when its time is up. */
export interface Vow {
  id: number;
  who: 'me' | 'them';
  person: string;
  text: string;
  atMs: number;
  /** Where keeping it would lead, when the promise named a known place. */
  place?: { name: string; x: number; y: number; z: number };
}

export interface Person {
  met: number;
  together: number;
  helped: number;
  fights: number;
  /** -5..5, built from what happened between them. */
  opinion: number;
  lastAt: number;
}

/** Something heard, not seen: it stays marked with who said it and fades after a day. */
export interface Rumor {
  text: string;
  from: string;
  atMs: number;
}

/** Something the character decided to try for a while, and what came of it. */
export interface Strategy {
  text: string;
  atMs: number;
  experience: number;
  money: number;
  deaths: number;
}

export interface Trial {
  text: string;
  expPerHour: number;
  moneyPerHour: number;
  deaths: number;
}

export interface Experience {
  /** A character made at a higher level has put its kit on: the kit's items are its gear from then on. */
  kitWorn?: boolean;
  strategy: Strategy | null;
  /** The last few tries, measured by the game: this is how a character changes its mind. */
  trials: Trial[];
  /** Decisions of the model that a reflex replaced, counted so that nobody is fooled about who decides. */
  overrides: number;
  rumors: Rumor[];
  /** Towns this character has really stood in. */
  towns: string[];
  /** When it last saw something new: a town or a hunting ground. */
  lastNewAt: number;
  /** Armour bought with its own money, by inventory slot: what it wears now instead of the starting set. */
  upgrades: Record<string, number>;
  moments: Record<string, Moment[]>;
  vows: Vow[];
  vowSeq: number;
  /** One line for each week lived; these are never compressed away. */
  chronicle: { week: number; text: string }[];
  /** Number of the week the last line stands for. */
  lastWeek: number;
  /** Doors that stayed shut for this character: house doors and the like, learned by walking into them. */
  lockedDoors: number[];
  /** What the character concluded from what it lived through. Its own view, not a fact of the world. */
  beliefs: string[];
  people: Record<string, Person>;
  /** Spells the server confirmed for this character, lower case. */
  known: string[];
  fear: number;
  confidence: number;
  boredom: number;
  loneliness: number;
  kills: Record<string, number>;
  deathsBy: Record<string, number>;
  deaths: number;
  chunks: Record<string, number>;
  floors: number[];
  dangerAt: Record<string, string>;
  warnings: Record<string, string>;
  plan: string;
  finding: Finding | null;
  tipsGiven: number;
  tipsHeard: number;
  /** Bad blood towards people, built from what they did; the choice to act on it stays free. */
  grudges: Record<string, number>;
  /** Where this character has been and what came of it. */
  places: Record<string, Place>;
  /** Stories to tell in town, where people can overhear them. */
  news: string[];
  /** What this character decided to do differently, in its own words. */
  lessons: string[];
  /** Ways between floors really used: stairs, holes, ropes, shovels, ladders, teleports. */
  ways: Record<string, number>;
  trades: number;
  stored: number;
  pvpFights: number;
  helped: number;
  trips: number;
  modelChoices: number;
  ruleChoices: number;
}
