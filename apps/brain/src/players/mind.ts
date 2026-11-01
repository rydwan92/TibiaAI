// Mind of a player agent. A body is a real client (tools/otclient-agent) with its own reflexes; a mind
// reads what that character sees, keeps its feelings and experience, chooses where to go next and
// talks like a player. Choices come from the model among options that really exist here and now, or
// from the character's temperament when the model is away, so the game never waits for it. Each
// agent remembers only what happened to it; knowledge moves between agents by speech alone.
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { toGameAscii } from '../npc/dialogue.ts';
import { chooseByTemperament, chunkOf, needsSupplies, optionsFor, outOfSupplies, tooDangerous } from './choices.ts';
import { EventReader, type EventCursor } from './events.ts';
import { changeOpinion, personNote, personOf } from './people.ts';
import { huntingAdvice, knowledgeFor, lookupFacts, monsterNotes, potionsFor, runesFor, spellsFor, suppliesFor, way } from './knowledge.ts';
import { closeStrategy, pullNote, startStrategy, trialNotes } from './drives.ts';
import { areaOf, ensurePlace, expPerHour, placeNotes, recordStay, spotValue } from './places.ts';
import { addMoment, addRumor, addVow, addWeek, chronicleNotes, closeVow, isNews, momentNotes, overdueVows, topicsOf, vowNotes, weekOf, weekStart, weigh, whenWords } from './story.ts';
import { gap, tileKey, type NavGrid, type Pos, type RouteStep } from './nav.ts';
import type { BodyEvent, BodyState, Experience, Finding, GearOffer, Goal, Ground, MemoryStyle, Option, Place, PlayerDef, Team, Tip, Vow, WorldFacts } from './types.ts';
import type { NpcMemoryStore } from '../npc/store.ts';
import type { ModelClient } from '../providers/local-model.ts';

const DECISION_MS: [number, number] = [70_000, 130_000];
const CHAT_MEMORY = 12;
const MAX_CHUNKS = 400;
const ROUTE_STUCK_MS = 30_000;
const NO_BOATS_MS = 600_000;
const CAPTAIN_REFUSES = /don't sail|not enough|do not have enough|don't have enough/i;
const REPLAN_MS = 5000;
const HUNT_MS: [number, number] = [120_000, 200_000];
const SHARE_MS: [number, number] = [240_000, 600_000];
const MEET_AGAIN_MS = 600_000;
const METRICS_MS = 30_000;
const LONELY_PER_SECOND = 0.003;
const ERRAND_MS = 60_000;
const SHOP_AGAIN_MS = 300_000;
const CLOSE_ENOUGH = 2;
const ROUTE_FAILURES = 4;
const CONVERSATION_MS = 90_000;
const FOLLOW_PERSON_MS = 900_000;
const REPLIES_TO_A_PERSON = 20;
const MAX_MESSAGE_CHARS = 300;
const REST_EVERY_MS: [number, number] = [2_700_000, 5_400_000];
const REST_FOR_S: [number, number] = [180, 600];
const RUMOR = /uwazaj na ([A-Z][a-z]+)/;
const BELIEFS_MS = 1_800_000;
const MAX_BELIEFS = 5;
const BELIEF_MEMORIES = 25;
const SETBACK_MS = 180_000; // after a failed plan the next choice deserves more thought
const MARK_FRESH_MS = 15_000;
const REUNION_MS = 3 * 3_600_000; // this long without contact and meeting a person again is an event
const FRIENDS_REUNION_MS = 12 * 3_600_000; // the same crowd plays every day: a hello, not a reunion
const COLD_OPINION = -2; // bad blood: no warm hello after any time
const PLACES_TO_OFFER = 4;
const PRANK_MS = 12_000;
const PRANK_STOP_HP = 50;
const PRANK_LINES = ['hehe sprawdzam cie', 'bronisz sie? xD', 'tylko zartuje', 'test refleksu'];
const STRANGER_HELLO = 0.5;
const FRIEND_OPINION = 1; // a person liked this much goes on the friends list
const VOW_NEAR = 3;
const WEEK_RETRY_MS = 3_600_000;
const WEEK_MEMORIES = 30;
const LONG_MEMORIES = 3;
const WEEKS_SHOWN = 3;
const FIRST_MEETING = 3;
const TRIP_WEIGHT = 6;
const WAIT_FOR_MODEL_MS = 10_000;
const SPARE_MS = 1_800_000; // one fight, then the same person is left alone: no hunting anyone in a loop
const PERSON_MEMORIES = 5;
const OLD_PERSON_MEMORIES = 2;
const LESSON_AGAIN_MS = 600_000;
const REPLAY_MARGIN_MS = 1500;
const SCOUT_TILES = 45;
const SCOUT_SEARCH = 12;
const TEAM_AGAIN_MS = 720_000;
const SUPPLY_AGAIN_MS = 480_000;
const WITHDRAW_AMOUNT = 400;
const WANDER_MS = 1_800_000; // divided by curiosity: this long without anything new and a character itches to go
const JOURNEY_GOLD = 300; // there, back, and something to eat
const TOWN_NEAR = 24;
const MIN_ARROWS = 15;
const SPARE_WEAPONS = [7774, 3327]; // the jagged sword and mace every new knight starts with: dead weight for an axe fighter
const STARTING_GEAR = [3354, 3359, 3372, 3425, 7773, 7991, 7992, 3059, 3066, 3362]; // what a veteran has outgrown
const HELP_RANGE = 150; // past this, by the time help comes there is nobody left to help
const GEAR_AGAIN_MS = 1_800_000;
const GEAR_PAUSE_MS = 300_000; // one thing at a time: first see it on
const WEAR_TRIES_MS = 60_000;
const GEAR_WORTH = 0.25; // one point of protection is worth the walk
const BOUGHT = /^Bought (\d+)x (.+) for (\d+)/;
const GOSSIP_MS: [number, number] = [600_000, 1_500_000]; // a word now and then, not a radio
const TOPICS_SHOWN = 4;
const NEWS_TALK_MS = 120_000;
const BOOSTED = /^Today's boosted (creature|boss): (.+)\.$/;
const DULL_ANNOUNCEMENT = /^Server is saving|Loot of|has logged/;
const REACH_AGAIN_MS = 300_000;
const PROGRESS_SAMPLE_MS = 600_000;
const PROGRESS_SAMPLES = 7;
const BROKE_GOLD = 30;
const KIT_AGAIN_MS = 600_000;
const MAX_NEWS = 5;
const PVP_MS = 60_000;
const KEEP_GOLD = 40;
const GOLD_COIN = 3031;
const PLATINUM_COIN = 3035;
const MAX_LOCKED_DOORS = 80;
const DEPOT_AGAIN_MS = 600_000;
const MAX_LESSONS = 6;
const REVENGE_HP = 0.4;
const NOT_POSSIBLE_LIMIT = 3;
const ATTACK_MEMORY_MS = 15_000;
/** Older records are history: they still count, but nobody answers them or strikes back. */
const STALE_EVENT_MS = 60_000;
const PZ_LOCK_MS = 60_000;
const GRUDGE_FADES_PER_SECOND = 0.003;
const RETHINK_AFTER_DEATH_MS = 120_000;
const IGNORED_TIMES = 3; // a good idea turned down this many times happens anyway, like hunger
const LETTER_MS: [number, number] = [1_200_000, 2_700_000];
const TROUBLE_WINDOW_MS = 3_600_000;
const CALM_CONFIDENCE = 0.5;
const NPC_QUESTIONS = ['co slychac w okolicy?', 'gdzie warto isc polowac?', 'znasz jakies ciekawe miejsca?', 'co tu sie ostatnio dzialo?'];
const WARNING = /uwaz|niebezp|zgin|nie idz|omijaj/;
const COORDS = /(\d{3,5}),\s*(\d{3,5}),\s*(\d{1,2})/;
const HERE = /jestem .*czekam/;
const TEAM_ASK = /idziemy razem|dolacz|gdzie jestes/;
const TEAM_END = /ide sam|rozdziel/;
const TEAM_NO = /teraz sam|moze pozniej/;
const HELP = /pomocy|ratunku/;
const TEAM_MS: [number, number] = [240_000, 480_000];
const TEAM_ANSWER_MS = 60_000;
const TEAM_APPROACH_MS = 480_000;
const LEAD_WAITS_MS = 120_000;
const LOST_MS = 45_000;
const CHASE_AFTER_MS = 6000;
const STAIRS_NEAR = 2;
const HELP_MS = 180_000;
const HELP_AT = 0.35;
const REPLIES_PER_PERSON = 2;
const FRIEND_REPLIES = 4; // in one window, all friends together: the crowd must not eat the budget
const OVERHEARD_REPLY = 0.15;
const OWN_LINES = 6;
const REPEAT_SHARE = 0.5;
const REPLY_WINDOW_MS = 300_000;
const REPLY_GAP_MS = 4000;

const STORY_FIELDS = 'Opcjonalnie: promise (co wlasnie komus obiecales, tylko gdy naprawde obiecujesz), their_promise (co on obiecal tobie), kept (numer obietnicy, ktora wlasnie sie spelnila, 0 gdy zadna), note (jedna rzecz warta zapamietania o tej osobie, gdy sama o sobie cos powiedziala; to tylko jej slowa).';

const clamp = (v: number) => Math.min(1, Math.max(0, v));

function emptyExperience(): Experience {
  return { strategy: null, trials: [], overrides: 0, rumors: [], towns: [], lastNewAt: 0, upgrades: {}, moments: {}, vows: [], vowSeq: 0, chronicle: [], lastWeek: 0, lockedDoors: [], beliefs: [], people: {}, known: [], fear: 0.2, confidence: 0.4, boredom: 0.2, loneliness: 0.2, kills: {}, deathsBy: {}, deaths: 0, chunks: {}, floors: [], dangerAt: {}, warnings: {}, plan: '', finding: null, tipsGiven: 0, tipsHeard: 0, grudges: {}, places: {}, news: [], lessons: [], ways: {}, trades: 0, stored: 0, pvpFights: 0, helped: 0, trips: 0, modelChoices: 0, ruleChoices: 0 };
}

function feelingWords(e: Experience): string {
  const level = (v: number) => (v > 0.7 ? 'bardzo' : v > 0.4 ? 'troche' : 'wcale nie');
  return `jestes ${level(e.fear)} wystraszony, ${level(e.confidence)} pewny siebie, ${level(e.boredom)} znudzony, ${level(e.loneliness)} samotny`;
}

export class PlayerMind {
  readonly key: string;
  readonly def: PlayerDef;
  private readonly dir: string;
  private readonly world: WorldFacts;
  private readonly store: NpcMemoryStore;
  private client: ModelClient | null;
  private readonly now: () => number;
  private readonly factor: number;
  private exp: Experience;
  private state: BodyState | null = null;
  private goal: Goal = { type: 'idle', id: 0 };
  private say: { id: string; text: string; atMs: number; to?: string }[] = [];
  private readonly events: EventReader;
  private nextDecisionAt = 0;
  private lastHp = 0;
  private lastExperience = 0;
  private lastZ: number | null = null;
  private chat: string[] = [];
  private lastReplyAt = 0;
  private busy = false;
  private seq = 0;
  private fleeing = false;
  private spellLevel = 0;
  private route: RouteStep[] = [];
  private routeAt = 0;
  private routeTo: Pos | null = null;
  private lastLegAt = 0;
  private lastPlanAt = 0;
  private readonly blocked = new Set<number>();
  private ground: Ground | null = null;
  private tips: Tip[] = [];
  private nextShareAt = 0;
  private nextMetricsAt = 0;
  private readonly lastMet = new Map<string, number>();
  private team: Team | null = null;
  private lastHelpAt = 0;
  private lessonDue: { killer: string; z: number; level: number; potions: number; ground: string } | null = null;
  private lastGroundName = '';
  private inbox: { from: string; text: string; isPrivate: boolean }[] = [];
  private readonly answered = new Map<string, number[]>();
  private ownLines: string[] = [];
  private visiting: string | null = null;
  private errand: Goal['errand'] | null = null;
  private lesson: Goal['lesson'] | null = null;
  private lessonAgainAt = 0;
  private locker: Goal['locker'] | null = null;
  private errandUntil = 0;
  private teamAgainAt = 0;
  private supplyAgainAt = 0;
  private kitAgainAt = 0;
  private replaying = false;
  private routeFailures = 0;
  private depotAgainAt = 0;
  private fleet = new Set<string>();
  private readonly talkingWith = new Map<string, number>();
  private nextRestAt: number;
  private ordersWaiting = false;
  private nextThoughtAt: number;
  private setbackAt = -SETBACK_MS;
  private mapMark: (name: string) => { x: number; y: number; z: number } | null = () => null;
  private readonly fought: Record<string, number> = {};
  private spellsLost = false;
  private reunions: { name: string; awayMs: number; isPrivate: boolean }[] = [];
  private buying: GearOffer | null = null;
  private shopGreet = false;
  private readonly ignored = new Map<string, number>();
  private troubles: number[] = [];
  private nextLetterAt: number;
  private advice: { level: number; text: string } | null = null;
  private gearAgainAt = 0;
  private readonly notWornSince = new Map<string, number>();
  private nextGossipAt: number;
  private readonly reachCache = new Map<string, { atMs: number; ok: boolean }>();
  private progress: { atMs: number; experience: number }[] = [];
  private prankOn: string | null = null;
  private weekAgainAt = 0;
  private readonly startedAtMs: number;
  private shoppedAt = -SHOP_AGAIN_MS;
  private stay: { area: string; at: { x: number; y: number; z: number }; startedAt: number; exp: number; gold: number; kills: number; monsters: Set<string> } | null = null;
  private bagFull = false;
  private kitOrders = 0;
  private lastLevel = 0;
  private pvpUntil = 0;
  private lastAttacker: { name: string; atMs: number } | null = null;
  private notPossible = 0;
  private pzLockedUntil = 0;
  private noBoatsUntil = 0;
  private readonly nav: NavGrid | null;
  private ordersExtra: Record<string, unknown> = {};

  constructor(key: string, def: PlayerDef, dir: string, world: WorldFacts, store: NpcMemoryStore, client: ModelClient | null, factor: number, now: () => number = Date.now, nav: NavGrid | null = null) {
    this.nav = nav;
    this.key = key;
    this.def = def;
    this.dir = dir;
    this.world = world;
    this.store = store;
    this.client = client;
    this.factor = factor;
    this.now = now;
    mkdirSync(dir, { recursive: true });
    const saved = store.prefs(key, 0).mind;
    this.exp = saved ? { ...emptyExperience(), ...JSON.parse(saved) as Experience } : emptyExperience();
    this.startedAtMs = now();
    this.exp.lastNewAt ||= now() - Math.random() * WANDER_MS; // not everyone itching at the same moment
    if (this.exp.towns.length === 0 && this.homeTown()) this.exp.towns = [this.homeTown()!];
    this.nextRestAt = now() + Math.random() * REST_EVERY_MS[1];
    this.nextThoughtAt = now() + BELIEFS_MS;
    this.nextGossipAt = now() + GOSSIP_MS[0] * Math.random();
    this.nextLetterAt = now() + LETTER_MS[0] * Math.random();
    const cursor = store.prefs(key, 0).events;
    this.events = new EventReader(join(dir, 'events.jsonl'), cursor ? JSON.parse(cursor) as EventCursor : null, (bad) => this.diary(`zly zapis zdarzenia: ${bad}`));
    this.nextShareAt = now() + SHARE_MS[0];
  }

  useClient(client: ModelClient): void {
    this.client = client;
  }

  /** A metered model decides for itself whether a call may start. */
  meterAllows(): boolean | undefined {
    return this.client?.available?.();
  }

  private diary(text: string): void {
    if (this.replaying) return;
    appendFileSync(join(this.dir, 'diary.log'), `${new Date(this.now()).toISOString().slice(11, 19)} ${text}\n`);
  }

  private remember(text: string, importance: number, atMs: number, topic?: keyof MemoryStyle): void {
    this.store.addEvent({
      eventKey: `${this.key}:${atMs}:${text.slice(0, 40)}`, npcKey: this.key, kind: 'witnessed', subjectGuid: null, actorName: 'ty', text, source: 'witnessed', certainty: 'confirmed',
      visibility: 'public', importance: weigh(this.def.memory, topic, importance), worldSessionId: 'players', realAtMs: atMs,
    });
  }

  /** What stays between this character and a person whatever happens to the details. */
  private moment(person: string, text: string, importance: number, topic: keyof MemoryStyle): void {
    addMoment(this.exp, person, toGameAscii(text), weigh(this.def.memory, topic, importance), this.now());
  }

  private save(): void {
    const chunks = Object.entries(this.exp.chunks).sort((a, b) => b[1] - a[1]).slice(0, MAX_CHUNKS);
    this.exp.chunks = Object.fromEntries(chunks);
    // Together: after a crash the records read since then meet the state from before them.
    this.store.tx(() => {
      this.store.setPref(this.key, 0, 'mind', JSON.stringify(this.exp), this.now());
      this.store.setPref(this.key, 0, 'events', JSON.stringify(this.events.cursor), this.now());
    });
  }

  private readState(): BodyState | null {
    try {
      return JSON.parse(readFileSync(join(this.dir, 'state.json'), 'utf8')) as BodyState;
    } catch {
      return null;
    }
  }

  private writeOrders(): void {
    const path = join(this.dir, 'orders.json');
    writeFileSync(`${path}.tmp`, JSON.stringify({ goal: this.goal, say: this.say.slice(-6), ...this.ordersExtra }));
    try {
      renameSync(`${path}.tmp`, path);
      this.ordersWaiting = false;
    } catch {
      this.ordersWaiting = true; // Windows refuses while the body is reading it; the next tick tries again
    }
  }

  private setGoal(goal: Omit<Goal, 'id'>): void {
    if (goal.type === 'team') {
      this.askToTeam(goal.name!);
      return;
    }
    if (goal.type === 'pvp') {
      this.startFight(goal.name!, goal.prank === true);
      return;
    }
    if (goal.type === 'explore' && goal.heading && this.nav && this.state) {
      // Exploring means getting somewhere new, not pressing against the nearest wall.
      const far = { x: this.state.x + goal.heading.x * SCOUT_TILES, y: this.state.y + goal.heading.y * SCOUT_TILES, z: this.state.z };
      const spot = this.nav.nearestWalkable(far, SCOUT_SEARCH);
      if (spot) goal = { type: 'route', ...spot };
    }
    if (goal.type === 'floor' && this.nav && goal.x !== undefined) {
      const below = this.nav.linkTarget({ x: goal.x, y: goal.y!, z: goal.z! });
      if (below) goal = { type: 'route', ...below };
    }
    this.route = [];
    this.routeTo = null;
    this.visiting = goal.type === 'route' && !goal.errand ? goal.name ?? null : null;
    this.errand = goal.type === 'route' ? goal.errand ?? null : null;
    this.locker = goal.locker ?? null;
    this.lesson = goal.lesson ?? null;
    this.buying = goal.offer ?? null;
    this.shopGreet = goal.greet === true;
    if (goal.type === 'route' && this.state) {
      const to = { x: goal.x!, y: goal.y!, z: goal.z! };
      const gold = this.now() < this.noBoatsUntil ? 0 : this.state.gold ?? 0;
      const shut = this.exp.lockedDoors;
      let route = this.nav?.route(this.state, to, new Set([...this.blocked, ...shut]), gold) ?? null;
      if (!route && this.blocked.size > 0) {
        // A tile blocked once may be free now, and enough of them can seal a character in.
        this.blocked.clear();
        route = this.nav?.route(this.state, to, new Set(shut), gold) ?? null;
        // With no other way a shut door is worth another try: someone may have opened it.
        route ??= this.nav?.route(this.state, to, undefined, gold) ?? null;
      }
      if (route && route.length > 0) {
        this.route = route;
        this.routeTo = to;
        this.routeAt = 0;
        this.lastLegAt = this.now();
        this.lastPlanAt = this.now();
        this.diary(`trasa do ${to.x},${to.y},${to.z}: ${route.length} odcinkow`);
        this.followRoute(this.state);
        return;
      }
      this.diary(`nie znam drogi do ${to.x},${to.y},${to.z}`);
      goal = { type: 'explore', heading: { x: Math.sign(to.x - this.state.x), y: Math.sign(to.y - this.state.y) } };
    }
    this.goal = { ...goal, id: ++this.seq, flee: this.fleeing };
    this.writeOrders();
  }

  /** The body walks one short leg at a time; a blocked leg means the route is planned again. */
  private followRoute(s: BodyState): void {
    while (this.routeAt < this.route.length) {
      const leg = this.route[this.routeAt];
      const link = leg.kind !== undefined && leg.kind !== 'door';
      const jumps = leg.kind === 'teleport' || leg.kind === 'boat';
      const passed = jumps ? s.z === leg.to!.z && gap(leg.to!, s) <= 3 : s.z !== leg.z;
      const done = link ? passed : s.z === leg.z && gap(leg, s) <= (leg.kind === 'door' ? 0 : 1);
      if (!done) break;
      if (leg.kind === 'boat') this.noteFacility(leg, `port, ${leg.word}`, 'boat', `plyne statkiem do ${leg.word}`);
      if (link) {
        this.exp.ways[leg.kind!] = (this.exp.ways[leg.kind!] ?? 0) + 1;
        this.diary(`przeszedlem: ${leg.kind} (${leg.x},${leg.y},${leg.z})`);
      }
      this.notPossible = 0;
      this.routeAt++;
      this.lastLegAt = this.now();
    }
    if (this.routeAt >= this.route.length) {
      this.routeFailures = 0;
      const reached = this.routeTo;
      this.route = [];
      this.routeTo = null;
      this.ground = reached ? this.world.grounds?.find((g) => g.z === reached.z && gap(g, reached) <= 1) ?? null : null;
      this.diary(`dotarlem na miejsce${this.ground ? `: ${this.ground.name} (${this.ground.monsters.join(', ')})` : ''}`);
      if (reached) this.keepVowsAt(reached);
      if (this.visiting) {
        this.queueSay(`${this.visiting}, ${NPC_QUESTIONS[Math.floor(Math.random() * NPC_QUESTIONS.length)]}`);
        this.tellNews();
      }
      if (this.errand) {
        this.startErrand(s);
        return;
      }
      this.goal = { type: 'hunt', id: ++this.seq, heading: { x: 0, y: 0 }, flee: this.fleeing };
      const [low, high] = HUNT_MS;
      this.nextDecisionAt = this.now() + low + Math.random() * (high - low);
      this.writeOrders();
      return;
    }
    const leg = this.route[this.routeAt];
    if (s.target) this.lastLegAt = this.now(); // a fight on the way is not being stuck
    if (this.now() < this.pzLockedUntil) {
      // After attacking a person no town lets you in for a while; better to wait than to bump the door.
      this.lastLegAt = this.now();
      if (this.goal.type !== 'hunt') {
        this.goal = { type: 'hunt', id: ++this.seq, heading: { x: 0, y: 0 }, flee: this.fleeing };
        this.writeOrders();
      }
      return;
    }
    if (leg.kind === undefined && s.z !== leg.z && this.now() - this.lastPlanAt > REPLAN_MS) {
      this.diary(`jestem nie tam, gdzie mialem byc (pietro ${s.z}), licze trase od nowa`);
      this.replan();
      return;
    }
    const type = leg.kind === 'door' ? 'door' : leg.kind === 'boat' ? 'sail' : leg.kind ? 'floor' : 'goto';
    if (this.goal.type !== type || this.goal.x !== leg.x || this.goal.y !== leg.y || this.goal.z !== leg.z) {
      this.goal = { type, id: ++this.seq, x: leg.x, y: leg.y, z: leg.z, kind: leg.kind, word: leg.word, flee: this.fleeing };
      this.writeOrders();
    }
    if (this.now() - this.lastLegAt > ROUTE_STUCK_MS || this.notPossible >= NOT_POSSIBLE_LIMIT) {
      this.notPossible = 0;
      if (leg.kind === 'boat') {
        this.boatRefused(leg);
        return;
      }
      if (this.routeTo && s.z === this.routeTo.z && gap(this.routeTo, s) <= CLOSE_ENOUGH) {
        // Someone stands on the very spot: right next to it is as good as there.
        this.routeAt = this.route.length;
        this.followRoute(s);
        return;
      }
      if (++this.routeFailures >= ROUTE_FAILURES) {
        this.diary(`nie da sie tam dojsc (${leg.x},${leg.y},${leg.z}), zmieniam plan`);
        this.troubles.push(this.now());
        this.remember(`Nie moglem dojsc do ${leg.x},${leg.y}, pietro ${leg.z}.`, 5, this.now());
        this.route = [];
        this.routeTo = null;
        this.errand = null;
        this.errandUntil = 0;
        this.routeFailures = 0;
        this.setbackAt = this.now();
        this.goal = { type: 'hunt', id: ++this.seq, heading: { x: 0, y: 0 }, flee: this.fleeing };
        this.nextDecisionAt = this.now();
        this.writeOrders();
        return;
      }
      this.blocked.add(tileKey(leg.x, leg.y, leg.z));
      this.setbackAt = this.now();
      if (leg.kind === 'door' && !this.exp.lockedDoors.includes(tileKey(leg.x, leg.y, leg.z))) {
        // A door that will not open stays in memory: no key, no way through, next time another route.
        this.exp.lockedDoors = [...this.exp.lockedDoors, tileKey(leg.x, leg.y, leg.z)].slice(-MAX_LOCKED_DOORS);
        this.remember(`Drzwi na ${leg.x},${leg.y}, pietro ${leg.z} sa zamkniete, tedy nie przejde.`, 5, this.now());
      }
      this.diary(`utknalem przy ${leg.x},${leg.y},${leg.z}${leg.kind ? ` (${leg.kind})` : ''}, szukam innej drogi`);
      this.replan();
    }
  }

  /** A captain who refuses (no money, a quest he wants) stays refused for a while: no waiting on the pier. */
  private boatRefused(leg: RouteStep): void {
    this.noBoatsUntil = this.now() + NO_BOATS_MS;
    this.setbackAt = this.now();
    this.troubles.push(this.now());
    this.diary(`kapitan nie zabral mnie do ${leg.word}, rezygnuje z rejsu`);
    this.remember(`Kapitan nie zabral mnie do ${leg.word}.`, 5, this.now());
    this.route = [];
    this.routeTo = null;
    this.errand = null;
    this.goal = { type: 'hunt', id: ++this.seq, heading: { x: 0, y: 0 }, flee: this.fleeing };
    this.nextDecisionAt = this.now();
    this.writeOrders();
  }

  /** A new way to the same place: why the character was going there stays the same. */
  private replan(): void {
    this.setGoal({ type: 'route', ...this.routeTo!, name: this.visiting ?? undefined, errand: this.errand ?? undefined, locker: this.locker ?? undefined, lesson: this.lesson ?? undefined, offer: this.buying ?? undefined, greet: this.shopGreet });
  }

  /** At the shop or the locker the body does the work; the mind waits for its report. */
  private startErrand(s: BodyState): void {
    this.errandUntil = this.now() + ERRAND_MS;
    if (this.errand === 'learn') {
      this.diary(`u nauczyciela: ${this.lesson!.spell}`);
      this.noteFacility(s, `nauczyciel, ${this.placeName(s)}`, 'teacher', 'uczy czarow');
      this.goal = { type: 'talk', id: ++this.seq, x: s.x, y: s.y, z: s.z, words: ['hi', this.lesson!.word, 'yes'], flee: this.fleeing };
    } else if (this.errand === 'withdraw') {
      this.diary(`przy depo: wyplacam, tam jest ${this.exp.stored}`);
      this.goal = { type: 'depot', id: ++this.seq, ...this.locker!, withdraw: [{ id: GOLD_COIN, count: Math.min(this.exp.stored, WITHDRAW_AMOUNT) }], flee: this.fleeing };
    } else if (this.errand === 'shop' && this.buying) {
      this.diary(`u ${this.world.gearShop?.npc}: kupuje ${this.buying.name} za ${this.buying.price}, mam ${s.gold ?? 0}`);
      this.noteFacility(s, `sklep ${this.world.gearShop?.npc}`, 'shop', 'sprzedaje zbroje, helmy i tarcze');
      this.goal = { type: 'trade', id: ++this.seq, buy: [{ id: this.buying.id, count: 1 }], greet: true, flee: this.fleeing };
    } else if (this.errand === 'shop') {
      const buy = [...(s.missing ?? []).map((id) => ({ id, count: 1 })), ...suppliesFor(this.def, s.level, s.magicLevel ?? 0, this.world)];
      this.noteFacility(s, `sklep ${this.world.merchant?.name ?? ''}`.trim(), 'shop', 'sprzedaje lup, kupuje mikstury i strzaly');
      this.diary(`u kupca: zloto ${s.gold ?? 0}, brakuje ${s.missing?.length ?? 0} rzeczy, lista ${buy.length} pozycji`);
      this.goal = { type: 'trade', id: ++this.seq, buy, greet: this.shopGreet, flee: this.fleeing };
    } else {
      this.diary(`przy depo: zloto ${s.gold ?? 0}`);
      this.noteFacility(s, `depo, ${this.placeName(s)}`, 'depot', 'chowa zloto');
      this.goal = { type: 'depot', id: ++this.seq, ...this.locker!, deposit: [GOLD_COIN, PLATINUM_COIN, ...this.notNeeded(s)], flee: this.fleeing };
    }
    this.writeOrders();
  }

  private totalKills(): number {
    return Object.values(this.exp.kills).reduce((a, b) => a + b, 0);
  }

  private placeName(at: { x: number; y: number; z: number }): string {
    if (this.ground && gap(this.ground, at) <= 48) return this.ground.name;
    const town = [...this.world.towns].sort((a, b) => gap(a.temple, at) - gap(b.temple, at))[0];
    const floor = at.z === 7 ? 'na powierzchni' : at.z > 7 ? `${at.z - 7} pod ziemia` : `${7 - at.z} pietro w gore`;
    return town ? `${way(town.temple, at)} od ${town.name}, ${floor}` : `okolice ${at.x},${at.y}`;
  }

  /** What was gained while in one area becomes knowledge about that area. */
  private endStay(s: BodyState): void {
    const stay = this.stay;
    this.stay = null;
    if (!stay) return;
    const gained = { minutes: (this.now() - stay.startedAt) / 60_000, exp: s.experience - stay.exp, gold: (s.gold ?? 0) - stay.gold, kills: this.totalKills() - stay.kills, monsters: stay.monsters };
    if (gained.kills === 0) return; // walking through teaches nothing about hunting
    const place = ensurePlace(this.exp, stay.at, this.placeName(stay.at), 'hunt', this.now());
    const first = place.visits === 0;
    if (!recordStay(place, gained, this.now())) return;
    place.doing = `poluje na ${[...place.monsters].slice(0, 2).join(' i ')}`;
    if (first) {
      this.exp.lastNewAt = this.now();
      this.exp.boredom = clamp(this.exp.boredom - 0.3);
      this.diary(`nowa miejscowka: ${place.name}, ${place.doing}`);
      this.remember(`Miejscowka ${place.name}: ${place.doing}, ${place.x},${place.y}, pietro ${place.z}.`, 6, this.now());
    }
  }

  private trackStay(s: BodyState): void {
    const area = areaOf(s);
    if (this.stay?.area !== area) {
      this.endStay(s);
      this.stay = { area, at: { x: s.x, y: s.y, z: s.z }, startedAt: this.now(), exp: s.experience, gold: s.gold ?? 0, kills: this.totalKills(), monsters: new Set() };
    }
    for (const c of s.seen) if (c.kind === 'monster') this.stay.monsters.add(c.name);
  }

  /** Towns are remembered by what they are good for. */
  private noteFacility(at: { x: number; y: number; z: number }, name: string, why: 'shop' | 'depot' | 'boat' | 'teacher' | 'town', doing: string): void {
    const place = ensurePlace(this.exp, at, name, why, this.now());
    if (place.visits === 0) this.diary(`zapamietuje: ${name}, ${doing}`);
    place.doing = doing;
    place.visits++;
    place.lastAt = this.now();
  }

  /** Worth telling later. Nothing here reaches anyone until the character says it aloud. */
  private addNews(text: string): void {
    this.exp.news = [...this.exp.news, text].slice(-MAX_NEWS);
  }

  /** Spoken aloud and without a name, so whoever stands near hears it as a rumour. */
  private tellNews(): void {
    const news = this.exp.news.shift();
    if (!news) return;
    this.diary(`opowiadam: ${news}`);
    this.queueSay(news);
  }

  /** Death or a thief may leave gaps; the character checks itself and notices them. */
  private checkGear(s: BodyState): void {
    if ((this.def.startLevel ?? 0) > 8 && !this.exp.kitWorn && s.worn) {
      // Born a veteran: the client does not count what lies in the backpack, so its kit is put on the way a purchase is.
      this.exp.kitWorn = true;
      for (const w of this.world.gear?.[this.def.kit ?? ''] ?? []) this.exp.upgrades[String(w.slot)] = w.id;
    }
    for (const [slot, id] of Object.entries(this.exp.upgrades)) {
      // What is on the character is the proof. A piece that will not go on was lost, say with a death.
      if (s.worn?.[slot] === id) this.notWornSince.delete(slot);
      else if (!this.notWornSince.has(slot)) this.notWornSince.set(slot, this.now());
      else if (this.now() - this.notWornSince.get(slot)! > WEAR_TRIES_MS) {
        this.diary(`nie mam juz: ${id}`);
        delete this.exp.upgrades[slot];
        this.notWornSince.delete(slot);
      }
    }
    const wear = (this.world.gear?.[this.def.kit ?? ''] ?? []).map((w) => (this.exp.upgrades[String(w.slot)] ? { ...w, id: this.exp.upgrades[String(w.slot)], bought: true } : w));
    if (wear.length > 0 && JSON.stringify(wear) !== JSON.stringify(this.ordersExtra.wear)) {
      this.ordersExtra = { ...this.ordersExtra, wear };
      this.writeOrders();
    }
    if (this.bagFull) s.cap = 0; // full is full, whatever the weight says
    if (!s.worn) return;
    s.missing = wear.filter((w) => !s.worn![String(w.slot)] && !s.have?.[String(w.id)]).map((w) => w.id);
    // An archer with no arrows and no money fights with bare hands and dies: nothing can get it out of that.
    const helpless = s.vocation === 'paladin' && (s.arrows ?? 0) < MIN_ARROWS;
    if (s.missing.length === 0 && !helpless) return;
    const purse = (s.gold ?? 0) + this.exp.stored;
    if (this.def.selfReliant) return;
    if (purse < BROKE_GOLD && this.now() >= this.kitAgainAt) {
      // Nothing to buy with and nothing to fight with: the one remaining developer exception.
      this.kitAgainAt = this.now() + KIT_AGAIN_MS;
      this.ordersExtra = { ...this.ordersExtra, needKit: ++this.kitOrders };
      this.diary(`zero zlota, brak ${s.missing.length} rzeczy${helpless ? ' i strzal' : ''}: zestaw startowy z miasta`);
      this.writeOrders();
    }
  }

  /** Spells this character really has: what the server confirmed, plus what a developer kit taught. */
  private knownSpells(): Set<string> {
    const kit = this.spellsLost ? [] : this.world.kitSpells?.[this.def.kit ?? ''] ?? [];
    return new Set([...this.exp.known, ...kit.map((k) => k.toLowerCase())]);
  }

  /** The server has the last word on a lesson: only its answers change what the character knows. */
  private onTeacher(text: string): boolean {
    const spell = this.lesson!.spell.toLowerCase();
    const refused = /do not have enough money|cannot learn this spell|need a premium/i.test(text);
    if (/You have learned|You already know this spell/.test(text)) {
      if (!this.exp.known.includes(spell)) this.exp.known = [...this.exp.known, spell];
      this.remember(`Nauczylem sie czaru ${this.lesson!.spell}.`, 7, this.now());
      this.spellLevel = -1;
      this.endErrand(`umiem juz: ${this.lesson!.spell}`);
    } else if (refused) {
      this.lessonAgainAt = this.now() + LESSON_AGAIN_MS;
      this.setbackAt = this.now();
      this.remember(`Nauczyciel odmowil mi czaru ${this.lesson!.spell}: ${text.slice(0, 80)}`, 5, this.now());
      this.endErrand(`nauczyciel odmowil: ${text.slice(0, 80)}`);
    } else return false;
    this.lesson = null;
    return true;
  }

  /** A refused cast means the plan was wrong: the spell comes off the list and the planner sees it. */
  private spellRefused(): void {
    this.diary('serwer: nie znam tego czaru, wykreslam');
    this.exp.known = [];
    this.spellsLost = true;
    this.spellLevel = -1;
  }

  private endErrand(summary: string): void {
    this.errand = null;
    this.errandUntil = 0;
    this.diary(summary);
    this.goal = { type: 'hunt', id: ++this.seq, heading: { x: 0, y: 0 }, flee: this.fleeing };
    this.nextDecisionAt = this.now() + 3000;
    this.writeOrders();
  }

  private startFight(name: string, prank = false): void {
    this.fought[name] = this.now();
    this.pvpUntil = this.now() + (prank ? PRANK_MS : PVP_MS);
    this.prankOn = prank ? name : null;
    this.ordersExtra = { ...this.ordersExtra, pvp: name };
    this.exp.pvpFights++;
    this.remember(`Zaatakowalem gracza ${name}${prank ? ' dla zartu' : ''}.`, 7, this.now(), 'fights');
    this.moment(name, prank ? `Zaczepilem ${name} dla zartu` : `Zaatakowalem ${name}`, 5, 'fights');
    this.diary(`${prank ? 'zaczepiam dla zartu' : 'atakuje gracza'}: ${name}`);
    if (prank) this.queueSay(PRANK_LINES[Math.floor(Math.random() * PRANK_LINES.length)], name);
    this.writeOrders();
  }

  /** Only the server's own line counts as a purchase: "Bought 0x" is a refusal, usually of the weight. */
  private onBought(text: string): void {
    const m = BOUGHT.exec(text);
    const offer = this.buying;
    if (!m || !offer || m[2].toLowerCase() !== offer.name) return;
    if (Number(m[1]) === 0) {
      this.gearAgainAt = this.now() + GEAR_AGAIN_MS;
      this.setbackAt = this.now();
      this.remember(`Nie kupilem ${offer.name}: za ciezkie albo za drogie.`, 4, this.now(), 'trade');
      this.diary(`sklep odmowil: ${offer.name}`);
      return;
    }
    this.exp.upgrades[String(offer.slot)] = offer.id;
    this.gearAgainAt = this.now() + GEAR_PAUSE_MS;
    this.remember(`Kupilem ${offer.name} za ${m[3]} zlota.`, 5, this.now(), 'trade');
    this.addNews(`kupilem sobie ${offer.name}`);
    this.diary(`kupione: ${offer.name} (${text})`);
  }

  /** What only weighs a character down: spare starting weapons and armour it has replaced. */
  private notNeeded(s: BodyState): number[] {
    const wielded = Object.values(s.worn ?? {});
    const replaced = (this.world.gear?.[this.def.kit ?? ''] ?? []).filter((w) => this.exp.upgrades[String(w.slot)]).map((w) => w.id);
    const outgrown = (this.def.startLevel ?? 0) > 8 ? STARTING_GEAR : [];
    return [...SPARE_WEAPONS, ...replaced, ...outgrown].filter((id) => !wielded.includes(id));
  }

  /** A joke ends before it hurts: time is up, the friend is gone, or he has had enough. */
  private watchPrank(s: BodyState): void {
    if (!this.prankOn) return;
    const friend = s.seen.find((c) => c.kind === 'player' && c.name === this.prankOn);
    if (friend && friend.hp >= PRANK_STOP_HP && this.now() < this.pvpUntil) return;
    this.diary(`koniec zartu z ${this.prankOn}`);
    this.queueSay('dobra koniec, zartowalem xD', this.prankOn);
    this.prankOn = null;
    this.pvpUntil = 0;
  }

  /** The server names who hit this character; what to do about it comes from temperament. */
  private onAttackedBy(s: BodyState, name: string, fleetNames: Set<string>): void {
    if (this.now() - (this.lastAttacker?.name === name ? this.lastAttacker.atMs : 0) > ATTACK_MEMORY_MS) {
      this.exp.grudges[name] = (this.exp.grudges[name] ?? 0) + 1;
      const person = personOf(this.exp, name, this.now());
      person.fights++;
      changeOpinion(person, -2);
      this.remember(`${name} mnie zaatakowal.`, 8, this.now(), 'fights');
      this.moment(name, `${name} napadl mnie ${this.placeName(s)}`, 7, 'fights');
      this.addNews(`${name} napadl mnie ${this.placeName(s)}`);
      this.diary(`${name} mnie atakuje!`);
      if (s.hp / s.hpMax > REVENGE_HP && Math.random() < this.def.bravery + 0.3) this.startFight(name);
      else this.setGoal({ type: 'route', ...this.nearestTown(s) });
      this.inbox.push({ from: name, text: `(${name} wlasnie cie zaatakowal, zareaguj jak gracz)`, isPrivate: false });
    }
    this.lastAttacker = { name, atMs: this.now() };
    void fleetNames;
  }

  private nearestTown(s: BodyState): Pos {
    const town = [...this.world.towns].sort((a, b) => gap(a.temple, s) - gap(b.temple, s))[0];
    return town?.temple ?? s;
  }

  /** Test hook: runtime/players/<key>/force.json picks an option or a route for a client test. */
  private obeyForcedGoal(s: BodyState): void {
    const file = join(this.dir, 'force.json');
    if (!existsSync(file)) return;
    const wanted = JSON.parse(readFileSync(file, 'utf8')) as { option?: string; route?: Pos; visit?: string; prank?: string; aged?: { name: string; days: number } };
    rmSync(file);
    const option = optionsFor(s, this.world, this.exp, this.tips, this.friendsOnline(s)).find((o) => o.id === wanted.option);
    this.diary(`test: ${JSON.stringify(wanted)}${wanted.option && !option ? ' (nie ma takiej opcji)' : ''}`);
    if (option) this.setGoal(option.goal);
    if (wanted.route) this.setGoal({ type: 'route', ...wanted.route });
    if (wanted.prank) this.startFight(wanted.prank, true);
    if (wanted.aged && this.exp.people[wanted.aged.name]) {
      // A week cannot be waited for in a test; only the date of the last contact moves.
      this.exp.people[wanted.aged.name].lastAt = this.now() - wanted.aged.days * 86_400_000;
      this.lastMet.delete(wanted.aged.name);
    }
    const npc = this.world.npcs?.find((n) => n.name === wanted.visit);
    if (npc) this.setGoal({ type: 'route', x: npc.x, y: npc.y, z: npc.z, name: npc.name });
  }

  /** Feelings and memory follow what really happened to this character. */
  private notice(s: BodyState): void {
    const atMs = this.now();
    const e = this.exp;
    const chunk = chunkOf(s);
    if (!e.chunks[chunk]) {
      e.boredom = clamp(e.boredom - 0.02);
      e.chunks[chunk] = 1;
      if (s.seen.some((c) => c.kind === 'monster')) {
        const names = [...new Set(s.seen.filter((c) => c.kind === 'monster').map((c) => c.name))].slice(0, 3).join(', ');
        this.remember(`Nowe miejsce (${s.x},${s.y}, pietro ${s.z}): ${names}.`, 5, atMs);
      }
    } else {
      e.chunks[chunk]++;
      e.boredom = clamp(e.boredom + 0.0005);
    }
    e.confidence = clamp(e.confidence + (CALM_CONFIDENCE - e.confidence) * 0.002); // moods pass, in both directions
    for (const [name, value] of Object.entries(e.grudges)) {
      const fade = GRUDGE_FADES_PER_SECOND * 2 * (this.def.forgives ?? 0.5);
      if (value <= fade) delete e.grudges[name];
      else e.grudges[name] = value - fade;
    }
    const friendNear = s.seen.some((c) => c.kind === 'player');
    e.loneliness = clamp(e.loneliness + (friendNear ? -LONELY_PER_SECOND * 3 : LONELY_PER_SECOND * this.def.sociability));
    if (this.lastHp > 0 && s.hp < this.lastHp) e.fear = clamp(e.fear + ((this.lastHp - s.hp) / s.hpMax) * 0.5);
    else e.fear = clamp(e.fear - 0.003);
    if (this.lastExperience > 0 && s.experience > this.lastExperience) {
      e.confidence = clamp(e.confidence + 0.004);
      if (this.ground) e.finding = { name: this.ground.name, monsters: this.ground.monsters, danger: false };
    }
    if (this.lastZ !== null && this.lastZ !== s.z) {
      this.diary(`zmiana pietra: ${this.lastZ} -> ${s.z}`);
      if (!e.floors.includes(s.z)) {
        e.floors.push(s.z);
        this.remember(`Pierwszy raz na pietrze ${s.z} (${s.x},${s.y}).`, 6, atMs);
        this.addNews(`zszedlem dzis pierwszy raz na pietro ${s.z}`);
      }
      this.nextDecisionAt = atMs;
    }
    if (this.lastLevel > 0 && s.level > this.lastLevel) {
      this.remember(`Wbilem poziom ${s.level}.`, 6, atMs);
      e.boredom = clamp(e.boredom - 0.2);
      e.confidence = clamp(e.confidence + 0.1);
      this.nextDecisionAt = atMs; // a new level opens new places: worth a thought now
      if (s.seen.some((c) => c.kind === 'player') && Math.random() < this.def.sociability) this.queueSay(`wbilem ${s.level}!`);
      this.addNews(`wbilem wlasnie poziom ${s.level}`);
    }
    this.lastLevel = s.level;
    this.lastHp = s.hp;
    this.lastExperience = s.experience;
    this.lastZ = s.z;
  }

  /** The server's loot line names what really died, unlike whatever was targeted a second later. */
  private noticeKill(text: string): void {
    const seen = /Loot of (?:an? )?([^:]+):/.exec(text)?.[1]?.toLowerCase();
    if (!seen) return;
    const name = Object.keys(this.world.monsters).find((m) => m.toLowerCase() === seen) ?? seen;
    this.exp.kills[name] = (this.exp.kills[name] ?? 0) + 1;
    this.diary(`zabilem: ${name} (${text.replace(/\{\d+\|([^}]*)\}/g, '$1')})`);
  }

  private onDeath(atMs: number): void {
    this.setbackAt = this.now();
    this.troubles.push(this.now());
    this.nextThoughtAt = Math.min(this.nextThoughtAt, this.now() + RETHINK_AFTER_DEATH_MS); // a death makes people think
    const s = this.state;
    const byPlayer = this.lastAttacker && atMs - this.lastAttacker.atMs < ATTACK_MEMORY_MS ? this.lastAttacker.name : null;
    const killer = byPlayer ?? s?.seen.find((c) => c.kind === 'monster')?.name ?? 'nie wiem co';
    if (byPlayer) {
      this.exp.grudges[byPlayer] = (this.exp.grudges[byPlayer] ?? 0) + 5;
      changeOpinion(personOf(this.exp, byPlayer, this.now()), -3);
      this.moment(byPlayer, `${byPlayer} mnie zabil${s ? ` ${this.placeName(s)}` : ''}`, 9, 'fights');
    }
    const e = this.exp;
    e.deaths++;
    e.deathsBy[killer] = (e.deathsBy[killer] ?? 0) + 1;
    e.fear = clamp(e.fear + 0.4);
    e.confidence = clamp(e.confidence - 0.25);
    if (s) e.dangerAt[chunkOf(s)] = killer;
    if (this.ground) e.finding = { name: this.ground.name, monsters: this.ground.monsters, danger: true };
    if (s) {
      this.endStay(s);
      ensurePlace(e, s, this.placeName(s), 'hunt', atMs).deaths++;
    }
    this.lastGroundName = this.ground?.name ?? '';
    this.ground = null;
    this.remember(`Zginalem przez: ${killer}${s ? ` na ${s.x},${s.y}, pietro ${s.z}` : ''}.`, 9, atMs, 'danger');
    this.addNews(`${killer} mnie dzis zabil${s ? ` na pietrze ${s.z}` : ''}, uwazajcie`);
    this.diary(`ZGINALEM: ${killer}. Smierci: ${e.deaths}. Strach ${e.fear.toFixed(2)}.`);
    this.nextDecisionAt = atMs + 8000;
    this.route = [];
    this.routeTo = null;
    this.blocked.clear();
    this.team = null;
    this.errand = null;
    this.errandUntil = 0;
    this.lessonDue = s ? { killer, z: s.z, level: s.level, potions: s.potions.health, ground: this.lastGroundName } : null;
    this.ordersExtra = { ...this.ordersExtra, pvp: undefined };
    this.goal = { type: 'idle', id: ++this.seq };
    this.writeOrders();
    this.save();
  }

  private guardReflexes(s: BodyState): void {
    const danger = tooDangerous(s, this.world, this.def.bravery, this.factor);
    const flee = danger !== null;
    if (flee === this.fleeing) return;
    this.fleeing = flee;
    if (flee) {
      this.diary(`uciekam przed: ${danger}`);
      this.remember(`Za silne dla mnie: ${danger} (${s.x},${s.y}, pietro ${s.z}).`, 7, this.now(), 'danger');
      this.exp.dangerAt[chunkOf(s)] = danger;
      if (this.ground) this.exp.finding = { name: this.ground.name, monsters: this.ground.monsters, danger: true };
    }
    this.goal = { ...this.goal, flee };
    this.writeOrders();
  }

  private refreshSpells(s: BodyState): void {
    const known = this.knownSpells();
    const skills = known.size * 1_000_000 + s.level * 1000 + (s.magicLevel ?? 0);
    if (this.spellLevel === skills) return;
    this.spellLevel = skills;
    const { heal, attack } = spellsFor(this.def, s.level, this.world.spells, known);
    this.ordersExtra = { ...this.ordersExtra, healSpell: heal?.words, healMana: heal?.mana, attackSpell: attack?.words, attackMana: attack?.mana, runes: runesFor(this.def, s.level, this.world.runes, s.magicLevel ?? 0), potions: potionsFor(this.def, s.level, this.world.potions), keep: this.world.sellable };
    this.diary(`czary na poziomie ${s.level}: leczenie ${heal?.words ?? 'brak'}, atak ${attack?.words ?? 'brak'}`);
    this.writeOrders();
  }

  private queueSay(text: string, to?: string): void {
    const line = toGameAscii(text).replace(/\s+/g, ' ').trim().slice(0, 180);
    if (!line) return;
    // People take time to read and type.
    const delay = 1200 + line.length * 70 + Math.random() * 1500;
    this.say.push({ id: `${this.key}-${this.now()}-${this.say.length}`, text: line, atMs: this.now() + delay, ...(to ? { to } : {}) });
    this.writeOrders();
  }

  private voicePrompt(s: BodyState, chatting = false): string {
    return [
      `Grasz w Tibie postacia ${this.def.character} (${this.def.vocation}, poziom ${s.level}). Jestes zwyklym graczem na serwerze, a nie postacia z ksiazki.`,
      `Jak piszesz: ${this.def.voice}. Krotko, jak na czacie w grze, zwykle jedno zdanie. Bez cudzyslowow, bez "jako".`,
      chatting
        ? 'Pisz najwyzej 25 slow i zawsze odpowiadaj na to, co ktos napisal. Nie powtarzaj tego, co juz pisales.'
        : 'Pisz najwyzej 10 slow. Nie powtarzaj tego, co juz pisales, i nie kopiuj cudzych zdan. Gdy nie masz nic nowego do powiedzenia, zwroc pusty tekst.',
      'Mozesz rozmawiac o wszystkim, takze o rzeczywistym swiecie. Nie wymyslaj faktow o tym, co sie zdarzylo w grze: mow tylko o tym, co jest ponizej.',
      this.world.identity === 'in_character'
        ? 'Jestes czlowiekiem, ktory gra w te gre dla przyjemnosci. Nie piszesz o sobie jako o programie, bocie ani AI. Pytanie o to traktujesz jak zaczepke innego gracza.'
        : 'Jesli ktos wprost pyta, czy jestes botem albo AI, nie klam.',
    ].join('\n');
  }

  private friendsOnline(s: BodyState): string[] {
    return Array.isArray(s.vips) ? s.vips.filter((v) => v.online).map((v) => v.name) : [];
  }

  /** What this character lived through with one person; it survives restarts and a change of model. */
  private memoriesOf(name: string, skip = ''): string {
    const older = this.store.memoriesAbout(this.key, name, OLD_PERSON_MEMORIES).map((m) => `- dawno: ${m.summary}`);
    const recent = this.store.eventsAbout(this.key, name, PERSON_MEMORIES + 1).filter((m) => m.text !== skip).slice(0, PERSON_MEMORIES).map((m) => `- ${m.actor_name === name ? `${name}: ` : ''}${m.text}`);
    return [...older, ...recent].join('\n');
  }

  /** Days the character no longer holds in detail, as compression left them. */
  private longMemories(limit: number): string {
    return this.store.visibleMemories(this.key, 0, limit).map((m) => `- ${m.summary}`).join('\n');
  }

  /** What happened to the character. Conversations stay out: one person's words are not another's business. */
  private recentMemories(limit: number): string {
    return this.store.visibleEvents(this.key, 0, limit * 4).filter((m) => m.kind !== 'heard' && m.kind !== 'said_by_npc').slice(0, limit).map((m) => `- ${m.text}`).join('\n');
  }

  private homeTown(): string | undefined {
    return this.def.home ?? this.world.home;
  }

  /** An idea the character keeps turning down: after a few times it happens anyway, and is counted as a reflex. */
  private insists(kind: string, byModel: boolean): boolean {
    if (!byModel) return true;
    const times = (this.ignored.get(kind) ?? 0) + 1;
    this.ignored.set(kind, times);
    if (times < IGNORED_TIMES) return false;
    this.ignored.delete(kind);
    return true;
  }

  private money(s: BodyState): number {
    return (s.gold ?? 0) + this.exp.stored;
  }

  private bestPace(): number {
    return Math.max(0, ...Object.values(this.exp.places).filter((p) => p.why === 'hunt' && p.minutes >= 5).map(expPerHour));
  }

  private currentPace(s: BodyState): number | null {
    const oldest = this.progress[0];
    return oldest && this.now() - oldest.atMs >= PROGRESS_SAMPLE_MS ? Math.round(((s.experience - oldest.experience) / (this.now() - oldest.atMs)) * 3_600_000) : null;
  }

  private drivesNote(s: BodyState): string {
    this.troubles = this.troubles.filter((t) => this.now() - t < TROUBLE_WINDOW_MS);
    return pullNote(this.def, this.exp, { money: this.money(s), perHour: this.currentPace(s), bestPerHour: this.bestPace(), troubles: this.troubles.length });
  }

  private levelAdvice(s: BodyState): string {
    if (this.advice?.level !== s.level) this.advice = { level: s.level, text: huntingAdvice(s, this.world) };
    return this.advice.text;
  }

  /** One piece of general advice at a time; a player remembers what he read, not the whole guide. */
  private tip(s: BodyState): string {
    const guide = this.world.guide;
    if (!guide) return '';
    const all = [...guide.money, ...guide.growth, ...guide.people];
    return all.length > 0 ? ` ${all[Math.floor(this.now() / 600_000 + s.level) % all.length]}` : '';
  }

  /** The curious get restless sooner. Only towns and new hunting grounds count as something new. */
  private restless(): boolean {
    return this.now() - this.exp.lastNewAt > WANDER_MS / (this.def.curiosity + 0.3);
  }

  /** Whether the way there exists for the money at hand; asked rarely, a route across the map is not free. */
  private canGetTo(s: BodyState, option: Option): boolean {
    if (!this.nav || (s.gold ?? 0) < JOURNEY_GOLD) return false;
    const known = this.reachCache.get(option.id);
    if (known && this.now() - known.atMs < REACH_AGAIN_MS) return known.ok;
    const goal = option.goal as { x: number; y: number; z: number };
    const ok = this.now() >= this.noBoatsUntil && this.nav.route(s, goal, new Set(this.exp.lockedDoors), s.gold ?? 0) !== null;
    this.reachCache.set(option.id, { atMs: this.now(), ok });
    return ok;
  }

  private worldNote(): string {
    const unseen = this.world.towns.map((t) => t.name).filter((n) => !this.exp.towns.includes(n));
    return `SWIAT: byles w ${this.exp.towns.join(', ') || 'jednym miejscu'}. Nie byles jeszcze w ${unseen.slice(0, 6).join(', ') || 'nigdzie wiecej'}.`;
  }

  /** A character sees how it is doing, so a slow spot can be noticed without anyone saying so. */
  private progressNote(s: BodyState): string {
    const oldest = this.progress[0];
    if (!oldest || this.now() - oldest.atMs < PROGRESS_SAMPLE_MS) return '';
    const perHour = Math.round(((s.experience - oldest.experience) / (this.now() - oldest.atMs)) * 3_600_000);
    return `TWOJE TEMPO: ${perHour} exp na godzine ostatnio.`;
  }

  private trackProgress(s: BodyState): void {
    if (this.progress.length > 0 && this.now() - this.progress[this.progress.length - 1].atMs < PROGRESS_SAMPLE_MS) return;
    this.progress = [...this.progress, { atMs: this.now(), experience: s.experience }].slice(-PROGRESS_SAMPLES);
  }

  /** Standing in a town for the first time is an event: it goes into memory, into stories and to a friend. */
  private noticeTown(s: BodyState): void {
    const town = this.world.towns.find((t) => t.temple.z === s.z && gap(t.temple, s) <= TOWN_NEAR && !this.exp.towns.includes(t.name));
    if (!town) return;
    this.exp.towns = [...this.exp.towns, town.name];
    this.exp.lastNewAt = this.now();
    this.exp.confidence = clamp(this.exp.confidence + 0.1);
    this.exp.boredom = clamp(this.exp.boredom - 0.4);
    this.noteFacility(s, `miasto ${town.name}`, 'town', 'zwiedzalem');
    this.remember(`Pierwszy raz w miescie ${town.name}.`, 8, this.now());
    this.addNews(`bylem w ${town.name}, polecam zobaczyc`);
    this.diary(`NOWE MIASTO: ${town.name} (${this.exp.towns.length} z ${this.world.towns.length})`);
    const person = this.friendsOnline(s).find((name) => !this.fleet.has(name));
    if (person) this.queueSay(`dotarlem do ${town.name}, ale tu inaczej`, person);
    else if (s.seen.some((c) => c.kind === 'player')) this.queueSay(`pierwszy raz w ${town.name}, ale tu inaczej`);
  }

  /** Chooses the next goal: the model picks among real options, or temperament does. */
  private async decide(s: BodyState, canAsk: boolean): Promise<void> {
    const friends = this.friendsOnline(s);
    s.justShopped = this.now() < this.shoppedAt + SHOP_AGAIN_MS;
    s.known = [...this.knownSpells()];
    s.sparing = Object.entries(this.fought).filter(([, at]) => this.now() - at < SPARE_MS).map(([name]) => name);
    s.mischief = this.team ? 0 : this.def.mischief ?? 0;
    const restless = this.restless();
    s.wantsCash = restless && (s.gold ?? 0) < JOURNEY_GOLD;
    s.knownTowns = this.world.towns.filter((t) => this.exp.towns.includes(t.name)).map((t) => t.temple);
    if (this.def.mapKnowledge === 'home' || this.def.mapKnowledge === 'told') s.knownNear = this.world.towns.find((t) => t.name === this.homeTown())?.temple;
    if (this.def.mapKnowledge === 'told') s.knownRange = 0;
    const options = [...this.vowOptions(), ...optionsFor(s, this.world, this.exp, this.tips, this.team || this.now() < this.teamAgainAt ? [] : friends)].filter((o) => (!o.id.startsWith('learn_') || this.now() >= this.lessonAgainAt) && (o.id !== 'depot' || this.now() >= this.depotAgainAt) && (!o.id.startsWith('gear_') || this.now() >= this.gearAgainAt) && (!o.id.startsWith('travel_') || this.canGetTo(s, o)));
    if (options.length === 0) return;
    const pickByRules = () => chooseByTemperament(this.def, this.exp, s, options);
    const upgrade = s.hp / s.hpMax > 0.5 ? options.find((o) => o.id.startsWith('gear_') && (o.value ?? 0) >= GEAR_WORTH) : undefined;
    const journey = restless && !this.team && s.hp / s.hpMax > 0.7 && !needsSupplies(s) ? options.find((o) => o.id.startsWith('travel_')) : undefined;
    let chosen = pickByRules();
    let picked: Option | null = null;
    let thought = 'zdecydowalem po swojemu';
    let line = '';
    let byModel = false;
    if (this.client && canAsk) {
      try {
        const r = await this.client.chat([
          { role: 'system', content: `${this.voicePrompt(s)}\nDecydujesz, co zrobic dalej. Sam wybierasz, nikt ci nie kaze: grasz po swojemu, chcesz rosnac w sile, poznawac swiat i dobrze sie bawic. Chodzenie bez celu nudzi, polowanie daje exp, a swiat jest duzy: siedzenie ciagle w tym samym miejscu tez nudzi, wiec co jakis czas ruszasz tam, gdzie jeszcze nie byles. Zwroc JSON: choice (jedna z podanych), thought (twoja mysl, jedno zdanie), plan (co chcesz osiagnac w najblizszym czasie, jedno zdanie), say (co piszesz na czacie, zwykle pusty tekst).` },
          { role: 'user', content: [
            `STAN: hp ${s.hp}/${s.hpMax}, mana ${s.mana}/${s.manaMax}, mikstury ${s.potions.health}/${s.potions.mana}, pozycja ${s.x},${s.y}, pietro ${s.z} (7 to powierzchnia, wyzsza liczba to glebiej).`,
            `ODCZUCIA: ${feelingWords(this.exp)}. Smierci: ${this.exp.deaths}. Zlota: ${s.gold ?? 0}.`,
            ...(this.def.ambition ? [`TWOJ DLUGI CEL: ${this.def.ambition}.`] : []),
            ...(this.exp.beliefs.length > 0 ? [`TWOJE PRZEKONANIA:\n${this.exp.beliefs.join('\n')}`] : []),
            ...this.pastSections(),
            `TWOJ PLAN: ${this.exp.plan || 'jeszcze go nie masz'}.`,
            ...(this.exp.strategy ? [`TWOJA OBECNA PROBA: ${this.exp.strategy.text}.`] : []),
            ...(this.exp.trials.length > 0 ? [`CO DALY POPRZEDNIE PROBY (wyniki z gry, wyciagaj wnioski):\n${trialNotes(this.exp)}`] : []),
            this.drivesNote(s),
            this.worldNote(),
            ...(this.progressNote(s) ? [this.progressNote(s)] : []),
            `PORADNIK DLA TWOJEGO POZIOMU: najlepiej placa ${this.levelAdvice(s) || 'to, co znajdziesz'}. Slabe potwory to strata czasu, zbyt silne to strata zycia.${this.tip(s)}`,
            ...(upgrade ? [`MOZESZ KUPIC: ${upgrade.label}. Czy warto?`] : []),
            ...(journey ? [`DAWNO NIE WIDZIALES NICZEGO NOWEGO: ${journey.label}. Czy warto?`] : []),
            `LUDZIE: ${[...new Set([...friends, ...s.seen.filter((c) => c.kind === 'player').map((c) => c.name)])].slice(0, 5).map((name) => personNote(this.exp, name)).filter(Boolean).join(' ') || 'nikogo blizej nie znasz'}`,
            `ZNAJOMI ONLINE: ${friends.join(', ') || 'nikt'}.${this.team ? ` Teraz idziesz razem z: ${this.team.with}.` : ''}`,
            `URAZY: ${Object.entries(this.exp.grudges).map(([n, v]) => `${n} ${Math.round(v)}`).join(', ') || 'zadnych'}.`,
            `LEKCJE Z TWOICH BLEDOW:\n${this.exp.lessons.join('\n') || 'jeszcze zadnych'}`,
            `TWOJE MIEJSCA:\n${placeNotes(this.exp, 6) || 'jeszcze nic nie poznales, trzeba zwiedzac'}`,
            `WIDZISZ: ${s.seen.map((c) => c.name).slice(0, 6).join(', ') || 'nikogo'}.`,
            ...s.seen.filter((c) => c.kind === 'player').slice(0, 2).flatMap((c) => {
              const known = this.memoriesOf(c.name);
              return known ? [`CO PAMIETASZ O ${c.name}:\n${known}`] : [];
            }),
            `POTWORY: ${monsterNotes(s, this.world) || 'brak'}.`,
            `DOSWIADCZENIE:\n${this.recentMemories(6) || 'jeszcze nic'}`,
            ...(this.exp.vows.length > 0 ? [`OBIETNICE (jeszcze otwarte):\n${vowNotes(this.exp, this.now())}`] : []),
            `CO USLYSZALES:\n${this.chat.slice(-4).join('\n') || 'nic'}`,
            knowledgeFor(this.def, s, this.world),
            ...(needsSupplies(s) ? ['ZAPASY: konczy ci sie zapas albo plecak jest pelny.'] : []),
            'RAZEM: we dwojke bezpieczniej i latwiej o silniejsze potwory; mozna tez isc samemu, jak wolisz.',
            `MOZLIWOSCI:\n${options.map((o) => `${o.id}: ${o.label}`).join('\n')}`,
          ].join('\n\n') },
        ], {
          schema: { type: 'object', properties: { choice: { type: 'string', enum: options.map((o) => o.id) }, thought: { type: 'string' }, plan: { type: 'string' }, say: { type: 'string' } }, required: ['choice', 'thought', 'plan', 'say'] },
          timeoutMs: 20_000, maxTokens: 200, purpose: 'decide', hard: this.now() - this.setbackAt < SETBACK_MS,
        });
        const v = JSON.parse(r.text) as { choice: string; thought: string; plan: string; say: string };
        chosen = options.find((o) => o.id === v.choice) ?? chosen;
        picked = chosen;
        thought = toGameAscii(v.thought ?? '').slice(0, 160) || thought;
        line = v.say ?? '';
        this.exp.plan = toGameAscii(v.plan ?? '').slice(0, 160) || this.exp.plan;
        byModel = true;
      } catch (err) {
        thought = `model milczy (${(err as Error).message.slice(0, 40)}), decyduje sam`;
      }
    }
    // Hunger beats plans: with nothing left a character goes for supplies, whatever it felt like doing.
    const supplies = options.find((o) => o.id === 'withdraw') ?? options.find((o) => o.id === 'supply');
    const broke = (s.gold ?? 0) + this.exp.stored < BROKE_GOLD;
    if (broke && outOfSupplies(s) && (this.def.selfReliant || (s.missing?.length ?? 0) === 0)) {
      // No money means earning it first, on something weak enough to fight as things are.
      const earn = options.find((o) => o.id === 'fight') ?? options.find((o) => o.id.startsWith('spot_') && (o.risk ?? 0) === 0) ?? options.find((o) => o.id.startsWith('hunt_') && (o.risk ?? 0) === 0);
      if (earn) {
        chosen = earn;
        thought = 'nie mam za co kupic, najpierw trzeba zarobic';
      }
    } else if (supplies && (outOfSupplies(s) || this.bagFull) && this.now() >= this.supplyAgainAt) {
      chosen = supplies;
      thought = this.bagFull ? 'plecak pelny, trzeba sprzedac' : 'bez zapasow nie ma co isc dalej';
      this.supplyAgainAt = this.now() + SUPPLY_AGAIN_MS;
    } else if (restless && s.wantsCash && options.some((o) => o.id === 'withdraw')) {
      chosen = options.find((o) => o.id === 'withdraw')!;
      thought = 'biore zloto z depo na wyprawe';
    } else if (upgrade && chosen !== upgrade && !chosen.id.startsWith('vow_') && !this.team && this.insists('gear', byModel)) {
      chosen = upgrade;
      thought = 'stac mnie na lepszy sprzet, po co trzymac zloto';
    } else if (journey && !chosen.id.startsWith('vow_') && !chosen.id.startsWith('tip_') && !chosen.id.startsWith('travel_') && this.insists('journey', byModel)) {
      chosen = journey;
      thought = 'ile mozna w jednym miejscu, czas zobaczyc cos nowego';
    } else {
      // Every player learns healing first; it costs a walk and keeps a character alive.
      const firstHealing = options.find((o) => o.id.startsWith('learn_') && o.value === 1);
      if (firstHealing && s.hp / s.hpMax > 0.5) {
        chosen = firstHealing;
        thought = 'najpierw nauka leczenia';
      }
    }
    if (chosen.id.startsWith('gear_')) this.ignored.delete('gear');
    if (chosen.id.startsWith('travel_')) this.ignored.delete('journey');
    if (byModel) this.exp.modelChoices++;
    else this.exp.ruleChoices++;
    if (byModel && picked && chosen !== picked) this.exp.overrides++;
    this.diary(`${chosen.id}: ${thought}`);
    if (!chosen.id.startsWith('hunt_') && !chosen.id.startsWith('tip_') && chosen.id !== 'fight') this.ground = null;
    this.setGoal(chosen.goal);
    if (line) this.queueSay(line);
    this.save();
  }

  /** Now and then a character sums up what it lived through; that is how it comes to see the world. */
  private async thinkItOver(s: BodyState): Promise<void> {
    try {
      const r = await this.client!.chat([
        { role: 'system', content: `${this.voicePrompt(s)}\nPodsumuj dla siebie, co wynika z tego, co przezyles, i zdecyduj, co dalej. Zwroc JSON: beliefs, lista najwyzej ${MAX_BELIEFS} krotkich przekonan w pierwszej osobie (np. o miejscach, ludziach, sposobach gry) oraz strategy, jedno zdanie: co wyprobujesz przez najblizsze pol godziny, zeby szybciej rosnac albo wiecej zarabiac. Jesli poprzednia proba dala malo albo konczyla sie smiercia, sprobuj inaczej; jesli dzialala, rozwin ja. Opieraj sie tylko na ponizszym zapisie. Stare przekonanie zachowaj, jesli nadal pasuje.` },
        { role: 'user', content: [
          `DOTYCHCZASOWE PRZEKONANIA:\n${this.exp.beliefs.join('\n') || 'brak'}`,
          `CO SIE WYDARZYLO:\n${this.recentMemories(BELIEF_MEMORIES) || 'niewiele'}`,
          `LEKCJE:\n${this.exp.lessons.join('\n') || 'brak'}`,
          `TWOJE PROBY I ICH WYNIKI:\n${trialNotes(this.exp) || 'jeszcze zadnych'}`,
          `TERAZ: poziom ${s.level}, zlota ${this.money(s)}, zgonow ${this.exp.deaths}. Na tym poziomie najlepiej placa: ${this.levelAdvice(s) || 'nie wiadomo'}.`,
          `MIEJSCA:\n${placeNotes(this.exp, 5) || 'brak'}`,
          `LUDZIE: ${Object.keys(this.exp.people).map((name) => personNote(this.exp, name)).filter(Boolean).slice(0, 6).join(' ') || 'brak'}`,
        ].join('\n\n') },
      ], { schema: { type: 'object', properties: { beliefs: { type: 'array' }, strategy: { type: 'string' } }, required: ['beliefs'] }, timeoutMs: 30_000, purpose: 'beliefs', hard: true });
      const answer = JSON.parse(r.text) as { beliefs: unknown[]; strategy?: string };
      closeStrategy(this.exp, s, this.money(s), this.now());
      const plan = toGameAscii(answer.strategy ?? '').trim();
      if (plan) {
        this.exp.strategy = startStrategy(plan, s, this.money(s), this.exp.deaths, this.now());
        this.diary(`proba: ${plan}`);
      }
      const beliefs = answer.beliefs.filter((b): b is string => typeof b === 'string' && b.trim() !== '').map((b) => toGameAscii(b).slice(0, 120)).slice(0, MAX_BELIEFS);
      if (beliefs.length === 0) return;
      this.exp.beliefs = beliefs;
      this.diary(`przemyslalem: ${beliefs.join(' | ')}`);
      this.save();
    } catch (err) {
      this.diary(`nie udalo sie podsumowac: ${(err as Error).message.slice(0, 40)}`);
    }
  }

  /** A person who talked the character into it leads; losing them or running out of time ends it. */
  private followPerson(from: string): void {
    this.errand = null;
    this.errandUntil = 0;
    this.route = [];
    this.routeTo = null;
    this.team = { with: from, lead: false, following: false, waiting: false, untilMs: this.now() + FOLLOW_PERSON_MS, lastSeenAt: this.now(), lostAsks: 0, ...this.startingTeam(this.state) };
    this.diary(`ide za ${from}`);
    this.remember(`Postanowilem pojsc za ${from}.`, 7, this.now(), 'friends');
  }

  private async reply(s: BodyState, from: string, text: string, isPrivate: boolean): Promise<void> {
    if (!this.client) return;
    const human = !this.fleet.has(from);
    const facts = lookupFacts(text, this.world);
    const past = this.memoriesOf(from, text);
    const spots = human ? this.placesToOffer() : [];
    personOf(this.exp, from, this.now()).lastAt = this.now();
    try {
      const r = await this.client.chat([
        { role: 'system', content: human
          ? `${this.voicePrompt(s, true)}\nOdpowiedz na czacie. ${from} to inny gracz. Odpowiadaj na to, o co pyta, i dziel sie tym, co wiesz: miejscami, potworami, tym, co przezyles. Jesli proponuje, zebys z nim poszedl, zdecyduj sam: zwaz jego argumenty, swoj plan i cel, co o nim wiesz i jak sie czujesz. Dobry argument moze cie przekonac, slaby nie, a mozesz dopytac. Mozesz tez sam zaproponowac wyprawe na jedno ze swoich miejsc. Zwroc JSON: say, opinion (co sadzisz o rozmowcy, liczba od -2 do 2), follow (follow_them, gdy postanawiasz pojsc za ta osoba; stop_following, gdy przestajesz za nia isc; none w kazdym innym razie), lead_to (id miejsca z listy, gdy wlasnie ruszacie tam razem i ty prowadzisz; none w kazdym innym razie). ${STORY_FIELDS}`
          : `${this.voicePrompt(s)}\nOdpowiedz na czacie. Zwroc JSON: say oraz opinion (co sadzisz o rozmowcy po tej wiadomosci, liczba od -2 do 2). ${STORY_FIELDS}` },
        { role: 'user', content: [
          ...(human ? [
            ...(this.def.ambition ? [`TWOJ DLUGI CEL: ${this.def.ambition}.`] : []),
            `TWOJ PLAN: ${this.exp.plan || 'jeszcze go nie masz'}.`,
            `GDZIE JEST ${from}: ${s.seen.some((c) => c.kind === 'player' && c.name === from) ? 'stoi blisko, widzisz go' : 'nie widzisz go teraz'}.${this.team?.with === from ? ` Teraz idziesz razem z ${from}.` : ''}`,
            `TWOJE MIEJSCA (mozesz o nich opowiedziec, id podaj tylko w lead_to):\n${this.offerNotes(spots) || 'jeszcze niewiele poznales'}`,
            ...(topicsOf(this.exp, this.now()).length > 0 ? [`CO SLYCHAC W SWIECIE (powiedz, jesli pyta, co nowego; to, co zaslyszane, podawaj jako plotke):\n${topicsOf(this.exp, this.now()).slice(0, TOPICS_SHOWN).join('\n')}`] : []),
          ] : [
            ...(topicsOf(this.exp, this.now()).length > 0 ? [`O CZYM MOZESZ POGADAC:\n${topicsOf(this.exp, this.now()).slice(0, 2).join('\n')}`] : []),
          ]),
          `SYTUACJA: hp ${s.hp}/${s.hpMax}, pietro ${s.z}; ${feelingWords(this.exp)}.`,
          ...(this.exp.beliefs.length > 0 ? [`TWOJE PRZEKONANIA:\n${this.exp.beliefs.join('\n')}`] : []),
          ...this.pastSections(),
          `TWOJE DOSWIADCZENIE (mozesz sie nim podzielic, jesli pasuje):\n${this.recentMemories(5) || 'jeszcze nic'}`,
          knowledgeFor(this.def, s, this.world),
          ...(facts.length > 0 ? [`FAKTY Z GRY:\n${facts.join('\n')}`] : []),
          `TWOJ STOSUNEK: ${personNote(this.exp, from) || 'to ktos nowy'}`,
          ...(this.exp.moments[from] ? [`WASZA WSPOLNA HISTORIA (to sie naprawde wydarzylo):\n${momentNotes(this.exp, from, this.now())}`] : []),
          ...(vowNotes(this.exp, this.now(), from) ? [`OTWARTE OBIETNICE MIEDZY WAMI:\n${vowNotes(this.exp, this.now(), from)}`] : []),
          `CO PAMIETASZ O ${from} (nawiaz do tego, jesli pasuje; nie wymyslaj niczego spoza tej listy):\n${past || 'nic, nie znasz tej osoby'}`,
          `ROZMOWA Z ${from}:\n${this.chat.filter((l) => l.includes(from)).slice(-6).join('\n') || 'dopiero zaczynacie'}`,
          `${from} napisal${isPrivate ? ' prywatnie' : ''}: ${JSON.stringify(text.slice(0, 200))}`,
        ].join('\n\n') },
      ], { schema: { type: 'object', properties: { say: { type: 'string' }, opinion: { type: 'integer' }, follow: { type: 'string', enum: ['follow_them', 'stop_following', 'none'] }, lead_to: { type: 'string', enum: ['none', ...spots.map((_, i) => `p${i + 1}`)] }, promise: { type: 'string' }, their_promise: { type: 'string' }, kept: { type: 'integer' }, note: { type: 'string' } }, required: ['say'] }, timeoutMs: 20_000, maxTokens: human ? 180 : 110, purpose: 'reply' });
      const answer = JSON.parse(r.text) as { say: string; opinion?: number; follow?: string; lead_to?: string; promise?: string; their_promise?: string; kept?: number; note?: string };
      if (human) {
        this.talkingWith.set(from, this.now() + CONVERSATION_MS);
        const leadTo = spots[Number((answer.lead_to ?? '').slice(1)) - 1];
        if (leadTo && this.team?.with !== from) this.leadPerson(s, from, leadTo);
        else if (answer.follow === 'follow_them' && this.team?.with !== from) this.followPerson(from);
        if (answer.follow === 'stop_following' && this.team?.with === from) this.endTeam();
      }
      this.noteFromTalk(from, answer);
      const line = answer.say;
      if (answer.opinion !== undefined) changeOpinion(personOf(this.exp, from, this.now()), Math.max(-2, Math.min(2, answer.opinion)) * 0.5);
      if (answer.opinion !== undefined && answer.opinion < 0) this.exp.grudges[from] = (this.exp.grudges[from] ?? 0) + 1;
      if (answer.opinion !== undefined && answer.opinion > 1 && this.exp.grudges[from]) this.exp.grudges[from] -= 1;
      if (!line.trim() || (!human && this.repeatsMyself(line))) {
        this.diary(`${from}: ${text} -> (bez odpowiedzi)`);
        return;
      }
      this.diary(`${from}: ${text} -> ${line} [wspomnien: ${past ? past.split('\n').length : 0}]`);
      this.chat = [...this.chat, `ty do ${from}: ${line}`].slice(-CHAT_MEMORY);
      this.store.addEvent({
        eventKey: `${this.key}:said:${this.now()}:${from}`, npcKey: this.key, kind: 'said_by_npc', subjectGuid: null, actorName: 'ty', text: `Odpowiedzialem ${from}: ${toGameAscii(line).slice(0, 120)}`, source: 'witnessed', certainty: 'confirmed',
        visibility: 'public', importance: 4, worldSessionId: 'players', realAtMs: this.now(),
      });
      this.queueSay(line, isPrivate ? from : undefined);
    } catch (err) {
      this.diary(`nie odpowiedzialem ${from}: ${(err as Error).message.slice(0, 40)}`);
    }
  }

  /** What a talk leaves behind: a promise each way, one kept, and a thing worth knowing about the person. */
  private noteFromTalk(from: string, a: { promise?: string; their_promise?: string; kept?: number; note?: string }): void {
    const made = (who: Vow['who'], text?: string) => {
      const said = toGameAscii(text ?? '').trim();
      if (!said) return;
      const vow = addVow(this.exp, { who, person: from, text: said, atMs: this.now(), place: this.placeIn(said) });
      if (vow) {
        this.diary(`${who === 'me' ? 'obiecalem' : `${from} obiecal`}: ${vow.text}`);
        this.remember(`${who === 'me' ? `Obiecalem ${from}` : `${from} obiecal mi`}: ${vow.text}`, 7, this.now(), 'friends');
      }
    };
    made('me', a.promise);
    made('them', a.their_promise);
    const vow = a.kept ? this.exp.vows.find((v) => v.id === a.kept && v.person === from) : undefined;
    if (vow) this.keepVow(vow);
    const note = toGameAscii(a.note ?? '').trim();
    if (note.length >= 5) this.moment(from, `Wiem o ${from}: ${note}`, 4, 'friends');
  }

  private keepVow(vow: Vow): void {
    closeVow(this.exp, vow.id);
    const text = vow.who === 'me' ? `Dotrzymalem slowa danego ${vow.person}: ${vow.text}` : `${vow.person} dotrzymal slowa: ${vow.text}`;
    this.moment(vow.person, text, 6, 'friends');
    this.remember(`${text}.`, 7, this.now(), 'friends');
    changeOpinion(personOf(this.exp, vow.person, this.now()), vow.who === 'me' ? 0.5 : 1);
    this.diary(text);
  }

  private keepVowsAt(reached: Pos): void {
    for (const vow of this.exp.vows.filter((v) => v.who === 'me' && v.place && v.place.z === reached.z && gap(v.place, reached) <= VOW_NEAR)) this.keepVow(vow);
  }

  /** Time ran out on a promise. A broken one is remembered like a kept one, only worse. */
  private settleVows(): void {
    for (const vow of overdueVows(this.exp, this.now())) {
      const text = vow.who === 'me' ? `Nie dotrzymalem slowa danego ${vow.person}: ${vow.text}` : `${vow.person} nie dotrzymal slowa: ${vow.text}`;
      this.moment(vow.person, text, 6, 'friends');
      if (vow.who === 'them') changeOpinion(personOf(this.exp, vow.person, this.now()), -1);
      this.diary(text);
    }
  }

  /** The place a promise speaks of, when it speaks of one the character can find. */
  private placeIn(text: string): Vow['place'] {
    const low = text.toLowerCase();
    const known = [...Object.values(this.exp.places), ...(this.world.grounds ?? [])].find((p) => low.includes(p.name.toLowerCase()));
    return known ? { name: known.name, x: known.x, y: known.y, z: known.z } : undefined;
  }

  private vowOptions(): Option[] {
    return this.exp.vows.filter((v) => v.who === 'me' && v.place).map((v) => ({ id: `vow_${v.id}`, label: `dotrzymaj slowa danego ${v.person}: ${v.text} (${v.place!.name})`, goal: { type: 'route', x: v.place!.x, y: v.place!.y, z: v.place!.z } }));
  }

  /** Who the character is by now: the weeks behind it and the days compression has already condensed. */
  private pastSections(): string[] {
    const weeks = chronicleNotes(this.exp, WEEKS_SHOWN);
    const long = this.longMemories(LONG_MEMORIES);
    return [...(weeks ? [`TWOJA HISTORIA:\n${weeks}`] : []), ...(long ? [`DAWNE WSPOMNIENIA:\n${long}`] : [])];
  }

  private placesToOffer(): Place[] {
    return Object.values(this.exp.places).filter((p) => p.why === 'hunt' && p.kills > 0).sort((a, b) => spotValue(b) - spotValue(a)).slice(0, PLACES_TO_OFFER);
  }

  private offerNotes(spots: Place[]): string {
    return spots.map((p, i) => `p${i + 1}: ${p.name}, ${p.doing}, ${expPerHour(p)} exp/h${p.deaths ? `, zginales tu ${p.deaths}x` : ''}`).join('\n');
  }

  private startingTeam(s: BodyState | null): Pick<Team, 'startKills' | 'startExp'> {
    return { startKills: this.totalKills(), startExp: s?.experience };
  }

  /** This character takes a person to one of its places; the one who was talked into it comes along. */
  private leadPerson(s: BodyState, name: string, place: Place): void {
    this.errand = null;
    this.errandUntil = 0;
    this.team = { with: name, lead: true, following: false, waiting: false, untilMs: this.now() + FOLLOW_PERSON_MS, lastSeenAt: this.now(), lostAsks: 0, place: place.name, ...this.startingTeam(s) };
    this.diary(`prowadze ${name}: ${place.name}`);
    this.remember(`Postanowilem zaprowadzic ${name}: ${place.name}.`, 7, this.now(), 'friends');
    this.setGoal({ type: 'route', x: place.x, y: place.y, z: place.z });
  }

  /** Someone known is back after a long time. The character writes first, from what they lived through. */
  private async greetAgain(s: BodyState, name: string, awayMs: number, isPrivate: boolean, canAsk: boolean): Promise<void> {
    const person = this.exp.people[name];
    const cold = (person?.opinion ?? 0) <= COLD_OPINION;
    const story = momentNotes(this.exp, name, this.now());
    let line = cold ? '' : `siema ${name}, dawno cie nie bylo`;
    if (this.client && canAsk) {
      try {
        const r = await this.client.chat([
          { role: 'system', content: `${this.voicePrompt(s, true)}\nNie widziales ${name} od ${whenWords(this.now() - awayMs, this.now())}. Teraz sie spotykacie, wiec piszesz pierwszy, jak znajomy. Nawiaz do jednej konkretnej rzeczy, ktora razem przezyliscie, i jesli masz ochote zaproponuj cos na teraz, na przyklad jedno z twoich miejsc albo obietnice do spelnienia. Jesli zle cie potraktowal, mozesz byc chlodny albo nic nie pisac. Nie wymyslaj niczego spoza ponizszych list. Zwroc JSON z polem say.` },
          { role: 'user', content: [
            `TWOJ STOSUNEK: ${personNote(this.exp, name) || 'znasz go slabo'}`,
            `WASZA WSPOLNA HISTORIA:\n${story || 'nic szczegolnego'}`,
            ...(vowNotes(this.exp, this.now(), name) ? [`OTWARTE OBIETNICE:\n${vowNotes(this.exp, this.now(), name)}`] : []),
            `CO PAMIETASZ O ${name}:\n${this.memoriesOf(name) || 'niewiele'}`,
            `TWOJ PLAN: ${this.exp.plan || 'jeszcze go nie masz'}.`,
            `TWOJE MIEJSCA:\n${this.offerNotes(this.placesToOffer()) || 'jeszcze niewiele poznales'}`,
          ].join('\n\n') },
        ], { schema: { type: 'object', properties: { say: { type: 'string' } }, required: ['say'] }, timeoutMs: 20_000, maxTokens: 120, purpose: 'reunion', hard: true });
        line = (JSON.parse(r.text) as { say: string }).say;
      } catch {
        // the plain hello still says that someone noticed
      }
    }
    this.diary(`spotkanie po ${whenWords(this.now() - awayMs, this.now())}: ${name}${story ? ` [historia: ${story.split('\n').length}]` : ''} -> ${line || '(bez slowa)'}`);
    if (!line.trim()) return;
    this.talkingWith.set(name, this.now() + CONVERSATION_MS);
    this.chat = [...this.chat, `ty do ${name}: ${line}`].slice(-CHAT_MEMORY);
    this.queueSay(line, isPrivate ? name : undefined);
  }

  private talkingToSomeoneHere(s: BodyState): boolean {
    return !s.target && !this.fleeing && s.seen.some((c) => c.kind === 'player' && (this.talkingWith.get(c.name) ?? 0) > this.now());
  }

  private reunionAfter(name: string): number {
    return this.fleet.has(name) ? FRIENDS_REUNION_MS : REUNION_MS;
  }

  private answerReunion(s: BodyState, canAsk: () => boolean): void {
    if (this.busy) return;
    const due = this.reunions.shift();
    if (!due) return;
    this.busy = true;
    this.greetAgain(s, due.name, due.awayMs, due.isPrivate, canAsk()).finally(() => { this.busy = false; });
  }

  /** Liked people go on the friends list, so their logins reach the character like its friends' do. */
  private keepFriends(): void {
    const liked = Object.entries(this.exp.people).filter(([name, p]) => !this.fleet.has(name) && !this.world.helpers?.has(name) && (p.opinion >= FRIEND_OPINION || p.together > 0)).map(([name]) => name).sort();
    if (JSON.stringify(liked) === JSON.stringify(this.ordersExtra.addVip ?? [])) return;
    this.ordersExtra = { ...this.ordersExtra, addVip: liked };
    this.writeOrders();
  }

  /** Once a week the days are put into one line of the character's own history. */
  private async writeWeek(s: BodyState, week: number): Promise<void> {
    this.weekAgainAt = this.now() + WEEK_RETRY_MS;
    const days = this.store.mostImportant(this.key, weekStart(this.exp.lastWeek), weekStart(week), WEEK_MEMORIES);
    if (days.length === 0) {
      this.exp.lastWeek = week;
      return;
    }
    try {
      const r = await this.client!.chat([
        { role: 'system', content: `${this.voicePrompt(s)}\nZapisz dla siebie w jednym lub dwoch zdaniach, w pierwszej osobie, co bylo najwazniejsze w minionym tygodniu: z kim, gdzie, co sie udalo, co poszlo zle. Tylko to, co jest w zapisie. Zwroc JSON z polem text.` },
        { role: 'user', content: [`ZAPIS TYGODNIA:\n${days.map((d) => `- ${d.text}`).join('\n')}`, `POPRZEDNIE TYGODNIE:\n${chronicleNotes(this.exp, WEEKS_SHOWN) || 'brak'}`].join('\n\n') },
      ], { schema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] }, timeoutMs: 30_000, maxTokens: 120, purpose: 'chronicle', hard: true });
      const text = toGameAscii((JSON.parse(r.text) as { text: string }).text).trim();
      if (text.length >= 10) addWeek(this.exp, this.exp.lastWeek, text);
      this.exp.lastWeek = week;
      this.diary(`tydzien w skrocie: ${text}`);
      this.save();
    } catch (err) {
      this.diary(`nie udalo sie spisac tygodnia: ${(err as Error).message.slice(0, 40)}`);
    }
  }

  private onHeard(s: BodyState, ev: BodyEvent, fleetNames: Set<string>): void {
    const from = ev.from ?? '';
    const text = ev.text ?? '';
    if (this.visiting && from.startsWith(this.visiting) && text) {
      this.remember(`${from} powiedzial mi: ${text.slice(0, 160)}`, 5, ev.atMs);
      this.diary(`${from}: ${text.slice(0, 160)}`);
      this.learnFrom(from, text);
      return;
    }
    if (!from || from.includes('[AI]') || !text || ev.level === 0 || this.world.monsters[from] || this.world.helpers?.has(from)) return; // other NPC and monster lines are scenery
    this.chat = [...this.chat, `${from}: ${text}`].slice(-CHAT_MEMORY);
    this.exp.loneliness = clamp(this.exp.loneliness - 0.03);
    this.store.addEvent({
      eventKey: `${this.key}:heard:${ev.atMs}:${from}`, npcKey: this.key, kind: 'heard', subjectGuid: null, actorName: from, text, source: 'heard', certainty: 'rumor',
      visibility: 'public', importance: fleetNames.has(from) ? 5 : 4, worldSessionId: 'players', realAtMs: ev.atMs,
    });
    if (!ev.private && fleetNames.has(from) && isNews(text)) addRumor(this.exp, { text, from, atMs: ev.atMs });
    const rumor = RUMOR.exec(text)?.[1];
    if (rumor && rumor !== this.def.character) {
      // Only what someone said: it colours an opinion a little and stays marked as hearsay.
      changeOpinion(personOf(this.exp, rumor, this.now()), -1);
      this.remember(`${from} mowil, ze ${rumor} na niego napadl. Nie widzialem tego.`, 5, this.now());
    }
    if (this.teamwork(s, from, text.toLowerCase(), fleetNames)) return;
    this.learnFrom(from, text);
    const human = !fleetNames.has(from);
    if (!human && ev.private && s.seen.some((c) => c.name === from)) return; // side by side, friends talk out loud
    const named = ev.private || text.toLowerCase().includes(this.def.character.toLowerCase().slice(0, 4));
    // A conversation goes on without the name being repeated, and people write in several short lines.
    const ongoing = human && (this.talkingWith.get(from) ?? 0) > this.now();
    if (named || ongoing || Math.random() < this.def.sociability * OVERHEARD_REPLY) {
      if (human) this.talkingWith.set(from, this.now() + CONVERSATION_MS);
      const waiting = human ? this.inbox.find((m) => m.from === from) : undefined;
      const said = waiting ? `${waiting.text} / ${text}`.slice(-MAX_MESSAGE_CHARS) : text;
      this.inbox = [...this.inbox.filter((m) => m.from !== from), { from, text: said, isPrivate: ev.private === true || waiting?.isPrivate === true }];
    }
  }

  /** A small model falls into loops; a person simply stops saying the same thing. */
  private repeatsMyself(line: string): boolean {
    const words = new Set(toGameAscii(line).toLowerCase().match(/[a-z]{3,}/g) ?? []);
    if (words.size === 0) return false;
    const again = this.ownLines.some((old) => [...words].filter((w) => old.includes(w)).length / words.size > REPEAT_SHARE);
    this.ownLines = [...this.ownLines, toGameAscii(line).toLowerCase()].slice(-OWN_LINES);
    return again;
  }

  /** A message waits for a free moment instead of being lost; a chat still ends, as chats do. */
  private answerInbox(s: BodyState, canAsk: () => boolean): void {
    const message = this.inbox[0];
    if (!message || this.busy || !this.client || this.now() - this.lastReplyAt < REPLY_GAP_MS) return;
    const recent = (this.answered.get(message.from) ?? []).filter((t) => this.now() - t < REPLY_WINDOW_MS);
    const friend = this.fleet.has(message.from);
    const withFriends = friend ? [...this.answered].filter(([name]) => this.fleet.has(name)).flatMap(([, times]) => times).filter((t) => this.now() - t < REPLY_WINDOW_MS).length : 0;
    if (recent.length >= (friend ? REPLIES_PER_PERSON : REPLIES_TO_A_PERSON) || withFriends >= FRIEND_REPLIES || (friend && this.client.spare?.() === false)) {
      this.inbox.shift();
      return;
    }
    if (!canAsk()) return;
    this.inbox.shift();
    this.answered.set(message.from, [...recent, this.now()]);
    this.lastReplyAt = this.now();
    this.busy = true;
    this.reply(s, message.from, message.text, message.isPrivate).finally(() => { this.busy = false; });
  }

  private askToTeam(name: string): void {
    this.team = { with: name, lead: false, following: false, waiting: true, untilMs: this.now() + TEAM_APPROACH_MS, lastSeenAt: this.now(), lostAsks: 0, ...this.startingTeam(this.state) };
    this.diary(`pytam ${name} o wspolna wyprawe`);
    this.queueSay(`${name} idziemy razem? gdzie jestes?`, name);
  }

  private acceptInvite(s: BodyState, from: string, opening: string): void {
    const [low, high] = TEAM_MS;
    this.team ??= { with: from, lead: true, following: false, waiting: false, untilMs: this.now() + low + Math.random() * (high - low), lastSeenAt: this.now(), lostAsks: 0, ...this.startingTeam(s) };
    this.diary(`${from} chce isc razem, podaje gdzie jestem`);
    this.exp.loneliness = 0.1;
    this.queueSay(`${opening}, jestem ${this.placeName(s)}, czekam`, from);
    this.setGoal({ type: 'hunt', heading: { x: 0, y: 0 } }); // stays around so the friend can find this spot
    this.nextDecisionAt = this.now() + LEAD_WAITS_MS;
  }

  private declineInvite(from: string, line: string): void {
    this.diary(`${from} chce isc razem, ale wole sam`);
    this.teamAgainAt = this.now() + TEAM_AGAIN_MS;
    this.queueSay(TEAM_NO.test(line) ? line : `${line}, moze pozniej`, from);
  }

  /** An invitation is a decision: what the character wants now and what it remembers of the person. */
  private async answerInvite(s: BodyState, from: string): Promise<void> {
    try {
      const r = await this.client!.chat([
        { role: 'system', content: `${this.voicePrompt(s)}\n${from} proponuje wspolne polowanie. Zdecyduj jak ty, nie musisz sie zgadzac. Zwroc JSON: accept (yes albo no) i say (krotka odpowiedz na czacie, bez miejsca).` },
        { role: 'user', content: [
          `STAN: hp ${s.hp}/${s.hpMax}, pietro ${s.z}, mikstury ${s.potions.health}; ${feelingWords(this.exp)}.`,
          ...(this.def.ambition ? [`TWOJ DLUGI CEL: ${this.def.ambition}.`] : []),
          `TWOJ PLAN: ${this.exp.plan || 'jeszcze go nie masz'}.`,
          `TWOJ STOSUNEK: ${personNote(this.exp, from) || 'to ktos nowy'}`,
          `CO PAMIETASZ O ${from}:\n${this.memoriesOf(from) || 'nic'}`,
        ].join('\n\n') },
      ], { schema: { type: 'object', properties: { accept: { type: 'string', enum: ['yes', 'no'] }, say: { type: 'string' } }, required: ['accept', 'say'] }, timeoutMs: 20_000, maxTokens: 60, purpose: 'invite' });
      const v = JSON.parse(r.text) as { accept: string; say: string };
      const line = toGameAscii(v.say).replace(/[.!]+$/, '').slice(0, 80) || (v.accept === 'yes' ? 'jasne' : 'teraz sam');
      if (v.accept === 'yes') this.acceptInvite(s, from, line);
      else this.declineInvite(from, line);
    } catch {
      this.declineInvite(from, 'teraz sam, moze pozniej');
    }
  }

  /** Friends say where they are in words; the exact spot is the mark a friend leaves on the map. */
  useMapMarks(find: (name: string) => { x: number; y: number; z: number } | null): void {
    this.mapMark = find;
  }

  /** Where this character stands, for a friend's map. A body gone silent leaves no mark. */
  position(): { x: number; y: number; z: number } | null {
    const s = this.state;
    return s && this.now() - s.atMs <= MARK_FRESH_MS ? { x: s.x, y: s.y, z: s.z } : null;
  }

  /** Help and trips together run on plain words. A person may also type a place out. */
  private teamwork(s: BodyState, from: string, low: string, fleetNames: Set<string>): boolean {
    const m = COORDS.exec(low);
    const told = m ? { x: Number(m[1]), y: Number(m[2]), z: Number(m[3]) } : null;
    const place = told ?? (HELP.test(low) || HERE.test(low) ? this.mapMark(from) : null);
    if (HELP.test(low) && place) {
      if (place.z !== undefined && gap(place, s) > HELP_RANGE) {
        this.diary(`${from} prosi o pomoc, ale to za daleko`);
        this.queueSay('jestem za daleko, trzymaj sie', from);
      } else if (!this.fleeing && s.hp / s.hpMax > 0.5 && Math.random() < this.def.bravery + 0.3) {
        this.diary(`${from} prosi o pomoc, ide na ${place.x},${place.y},${place.z}`);
        this.exp.helped++;
        const person = personOf(this.exp, from, this.now());
        person.helped++;
        changeOpinion(person, 0.5);
        this.moment(from, `Ruszylem na pomoc ${from}`, 5, 'friends');
        this.queueSay('juz ide, trzymaj sie', from);
        this.setGoal({ type: 'route', ...place });
      } else {
        this.diary(`${from} prosi o pomoc, ale nie dam rady`);
        this.queueSay('sorry, sam mam problem', from);
      }
      return true;
    }
    if (TEAM_ASK.test(low) && !place && fleetNames.has(from)) {
      if (this.team?.with === from && !this.team.lead) {
        // Both asked at once. Two followers would only circle each other, so one of them leads.
        if (this.def.character > from) return true;
        this.team.lead = true;
        this.team.waiting = false;
      }
      if (this.errand || this.route.length > 0 || this.now() < this.teamAgainAt || outOfSupplies(s)) {
        this.diary(`${from} chce isc razem, ale teraz nie`);
        this.queueSay('teraz sam, moze pozniej', from);
      } else if (!this.fleeing && !this.busy && this.meterAllows()) {
        this.busy = true;
        this.answerInvite(s, from).finally(() => { this.busy = false; });
      } else if (!this.fleeing && Math.random() < 0.3 + this.def.sociability * 0.7 + (this.exp.people[from]?.opinion ?? 0) * 0.1) {
        this.acceptInvite(s, from, 'jasne');
      } else {
        this.declineInvite(from, 'teraz sam, moze pozniej');
      }
      return true;
    }
    const t = this.team;
    if (!t || t.with !== from) return false;
    if (place && t.waiting) {
      t.waiting = false;
      t.lastSeenAt = this.now();
      this.diary(`ide do ${from} na ${place.x},${place.y},${place.z}`);
      this.setGoal({ type: 'route', ...place });
      return true;
    }
    if (TEAM_END.test(low) || (t.waiting && TEAM_NO.test(low))) {
      this.diary(`${from}: kazdy w swoja strone`);
      this.team = null;
      this.teamAgainAt = this.now() + TEAM_AGAIN_MS; // a no is a no for a while
      this.nextDecisionAt = this.now();
      return true;
    }
    return false;
  }

  /** Going together means a party: the experience is shared and everyone sees it. */
  private syncParty(s: BodyState): void {
    const t = this.team;
    const have = this.ordersExtra.party as { name: string; lead: boolean } | undefined;
    const want = t && (have?.name === t.with || s.seen.some((c) => c.kind === 'player' && c.name === t.with)) ? { name: t.with, lead: t.lead } : undefined;
    if (JSON.stringify(want) === JSON.stringify(have)) return;
    this.ordersExtra = { ...this.ordersExtra, party: want };
    this.writeOrders();
  }

  /** Nobody plays for hours without a break. It costs no model calls either: a body offline asks nothing. */
  private takeRest(s: BodyState): void {
    if (this.now() < this.nextRestAt || s.target || this.team || this.route.length > 0 || this.errandUntil > 0 || s.hp / s.hpMax < 0.8) return;
    const [low, high] = REST_EVERY_MS;
    this.nextRestAt = this.now() + low + Math.random() * (high - low);
    const seconds = Math.round(REST_FOR_S[0] + Math.random() * (REST_FOR_S[1] - REST_FOR_S[0]));
    if (s.seen.some((c) => c.kind === 'player')) this.queueSay('ide cos zjesc, zaraz wracam');
    this.diary(`przerwa na ${Math.round(seconds / 60)} min`);
    this.ordersExtra = { ...this.ordersExtra, rest: { id: this.now(), seconds } };
    this.writeOrders();
  }

  /** After a death the character thinks over what went wrong, and that stays with it. */
  private async reflect(d: NonNullable<PlayerMind['lessonDue']>, s: BodyState, canAsk: boolean): Promise<void> {
    let lesson = `${d.killer} mnie zabil na poziomie ${d.level}, mialem ${d.potions} mikstur; nastepnym razem wiecej zapasow albo silniejszy poziom.`;
    if (this.client && canAsk) {
      try {
        const r = await this.client.chat([
          { role: 'system', content: `${this.voicePrompt(s)}\nWlasnie zginales. Zastanow sie, co zrobiles zle i co zmienisz. Zwroc JSON z polem lesson, jedno konkretne zdanie.` },
          { role: 'user', content: `Zabil cie: ${d.killer}. Poziom ${d.level}, pietro ${d.z}, mikstury przy smierci ${d.potions}${d.ground ? `, miejsce ${d.ground}` : ''}. Wczesniejsze lekcje:\n${this.exp.lessons.join('\n') || 'brak'}` },
        ], { schema: { type: 'object', properties: { lesson: { type: 'string' } }, required: ['lesson'] }, timeoutMs: 20_000, maxTokens: 70, purpose: 'reflect', hard: true });
        lesson = toGameAscii((JSON.parse(r.text) as { lesson: string }).lesson).slice(0, 160) || lesson;
      } catch {
        // the plain lesson still holds what happened
      }
    }
    this.exp.lessons = [...this.exp.lessons, lesson].slice(-MAX_LESSONS);
    this.remember(`Lekcja: ${lesson}`, 9, this.now());
    this.diary(`lekcja: ${lesson}`);
    this.save();
  }

  private endTeam(): void {
    const t = this.team!;
    this.team = null;
    this.teamAgainAt = this.now() + TEAM_AGAIN_MS;
    this.exp.loneliness = 0.1;
    const where = t.place ?? (this.state ? this.placeName(this.state) : 'w terenie');
    const kills = this.totalKills() - (t.startKills ?? this.totalKills());
    const gained = (this.state?.experience ?? 0) - (t.startExp ?? this.state?.experience ?? 0);
    const result = kills > 0 ? `, ${kills} zabitych, ${gained} exp` : '';
    this.remember(`Bylismy razem na wyprawie z ${t.with}, ${where}${result}.`, 8, this.now(), 'friends');
    if (t.counted) this.moment(t.with, `Wyprawa z ${t.with}: ${where}${result}`, TRIP_WEIGHT, 'friends');
    if (!t.lead || t.place) {
      this.diary(`rozdzielamy sie z ${t.with}`);
      this.queueSay('dobra, dalej ide sam, powodzenia', t.with);
      this.goal = { type: 'hunt', id: ++this.seq, heading: { x: 0, y: 0 }, flee: this.fleeing };
      this.writeOrders();
    }
    this.nextDecisionAt = this.now();
  }

  private teamTick(s: BodyState): void {
    const t = this.team;
    if (!t) return;
    const now = this.now();
    if (now > t.untilMs) {
      this.endTeam();
      return;
    }
    if (outOfSupplies(s) && this.now() >= this.supplyAgainAt && (!t.lead || t.place)) {
      this.diary(`koncza mi sie zapasy, zostawiam ${t.with}`);
      this.endTeam();
      return;
    }
    const friend = s.seen.find((c) => c.kind === 'player' && c.name === t.with);
    if (friend) t.lastSeenAt = now;
    if (friend && !t.counted) {
      t.counted = true;
      this.exp.trips++;
      const person = personOf(this.exp, t.with, now);
      person.together++;
      changeOpinion(person, 0.5);
    }
    if (t.lead) return;
    if (t.waiting) {
      if (now - t.lastSeenAt > TEAM_ANSWER_MS) {
        this.teamAgainAt = now + TEAM_AGAIN_MS;
        this.diary(`${t.with} nie odpisuje`);
        this.team = null;
        this.nextDecisionAt = now;
      }
      return;
    }
    if (friend) {
      t.lostAsks = 0;
      t.at = { x: friend.x, y: friend.y, z: friend.z };
      t.chased = false;
      if (!t.following) {
        t.following = true;
        const [low, high] = TEAM_MS;
        if (this.fleet.has(t.with)) t.untilMs = now + low + Math.random() * (high - low);
        this.exp.loneliness = 0.1;
        this.route = [];
        this.routeTo = null;
        this.diary(`idziemy razem z ${t.with}`);
        this.goal = { type: 'follow', id: ++this.seq, name: t.with, flee: this.fleeing };
        this.writeOrders();
      }
      return;
    }
    if (t.at && !t.chased && this.route.length === 0 && now - t.lastSeenAt > CHASE_AFTER_MS) {
      // Someone who vanished usually took the stairs or the next corner: go and look before asking.
      t.chased = true;
      t.following = false;
      const at = t.at;
      const way = this.world.points.find((p) => p.z === at.z && gap(p, at) <= STAIRS_NEAR);
      this.diary(`zgubilem ${t.with}, ide tam, gdzie go ostatnio widzialem`);
      this.setGoal(way ? { type: 'floor', x: way.x, y: way.y, z: way.z, kind: way.kind } : { type: 'route', ...at });
      return;
    }
    if (this.route.length === 0 && now - t.lastSeenAt > LOST_MS) {
      t.following = false;
      if (++t.lostAsks > 3) {
        this.endTeam();
        return;
      }
      t.waiting = true;
      t.lastSeenAt = now;
      this.queueSay('zgubilem cie, gdzie jestes?', t.with);
    }
  }

  private callForHelp(s: BodyState): void {
    const hurt = s.hp / s.hpMax < HELP_AT;
    const foe = s.seen.find((c) => c.kind === 'monster');
    const friends = this.friendsOnline(s);
    if (!hurt || !foe || friends.length === 0 || this.now() - this.lastHelpAt < HELP_MS) return;
    this.lastHelpAt = this.now();
    const to = this.team?.with ?? friends[Math.floor(Math.random() * friends.length)];
    this.diary(`wolam o pomoc: ${to}`);
    this.queueSay(`pomocy, ${foe.name} mnie bije, jestem ${this.placeName(s)}`, to);
  }

  /** Advice is only as good as what was said: a place named in a message becomes an option or a warning. */
  private learnFrom(from: string, text: string): void {
    const low = text.toLowerCase();
    const named = (this.world.grounds ?? []).filter((g) => low.includes(g.name.toLowerCase()));
    const ground = named.find((g) => g.monsters.some((m) => low.includes(m.toLowerCase()))) ?? named[0];
    if (!ground) return;
    if (WARNING.test(low)) {
      this.exp.warnings[chunkOf(ground)] = from;
      this.diary(`${from} ostrzega przed: ${ground.name}`);
    } else {
      this.tips = [...this.tips.filter((t) => t.ground !== ground), { from, ground }].slice(-3);
      this.diary(`${from} poleca: ${ground.name} (${ground.monsters.join(', ')})`);
    }
    this.exp.tipsHeard++;
  }

  /** Tells a friend what this character found out, in its own words but with the place named. */
  private async tellFriend(s: BodyState, to: string, finding: Finding, canAsk: boolean): Promise<void> {
    const what = finding.monsters.join(', ');
    let line = finding.danger ? `uwazaj ${finding.name}, ${what} mocno bija` : `polecam ${finding.name}, sa tam ${what}, niezly exp`;
    if (this.client && canAsk) {
      try {
        const r = await this.client.chat([
          { role: 'system', content: `${this.voicePrompt(s)}\nPiszesz prywatna wiadomosc do kumpla ${to}. Zwroc JSON z polem say.` },
          { role: 'user', content: `${finding.danger ? 'Ostrzez go przed tym miejscem' : 'Polec mu to miejsce'}, swoimi slowami. Musisz uzyc dokladnie slow "${finding.name}" oraz nazwy potwora: ${what}.` },
        ], { schema: { type: 'object', properties: { say: { type: 'string' } }, required: ['say'] }, timeoutMs: 20_000, maxTokens: 80, purpose: 'share' });
        const said = (JSON.parse(r.text) as { say: string }).say;
        if (toGameAscii(said).toLowerCase().includes(finding.name.toLowerCase())) line = said;
      } catch {
        // the plain sentence still carries the news
      }
    }
    this.diary(`mowie ${to}: ${line}`);
    this.queueSay(line);
    this.exp.tipsGiven++;
  }

  private socialise(s: BodyState, fleetNames: Set<string>, canAsk: () => boolean): void {
    for (const friend of s.seen.filter((c) => c.kind === 'player')) {
      if (this.now() - (this.lastMet.get(friend.name) ?? 0) > MEET_AGAIN_MS) {
        this.lastMet.set(friend.name, this.now());
        const human = !fleetNames.has(friend.name) && !this.world.helpers?.has(friend.name);
        const person = personOf(this.exp, friend.name, this.now());
        const awayMs = this.now() - person.lastAt;
        person.met++;
        person.lastAt = this.now();
        this.diary(`spotkalem: ${friend.name} (${person.met}. raz)`);
        if (person.met === 1) this.moment(friend.name, `Poznalismy sie: ${this.placeName(s)}`, FIRST_MEETING, 'friends');
        if (person.met > 1 && awayMs >= this.reunionAfter(friend.name)) this.reunions.push({ name: friend.name, awayMs, isPrivate: false });
        else if (fleetNames.has(friend.name) && Math.random() < this.def.sociability) this.inbox.push({ from: friend.name, text: `(spotykasz ${friend.name} na mapie, zagadaj krotko jak gracz, po imieniu, najlepiej o czyms, co sie ostatnio wydarzylo)`, isPrivate: false });
        else if (human && person.met === 1 && Math.random() < this.def.sociability * STRANGER_HELLO) this.inbox.push({ from: friend.name, text: `(obcy gracz ${friend.name} stoi obok ciebie, przywitaj sie krotko albo zwroc pusty tekst)`, isPrivate: false });
      }
    }
    if (this.busy || this.now() < this.nextShareAt) return;
    const [low, high] = SHARE_MS;
    this.nextShareAt = this.now() + (low + Math.random() * (high - low)) * (1.3 - this.def.sociability);
    const finding = this.exp.finding;
    const friends = s.seen.filter((c) => c.kind === 'player' && fleetNames.has(c.name)).map((c) => c.name);
    if (!finding || friends.length === 0) return; // it keeps until they meet
    this.exp.finding = null;
    this.busy = true;
    this.tellFriend(s, friends[Math.floor(Math.random() * friends.length)], finding, canAsk()).finally(() => { this.busy = false; });
  }

  /** Now and then, with someone around and nothing to fight, a character brings something up, out loud. */
  private gossip(s: BodyState, fleetNames: Set<string>, canAsk: () => boolean): void {
    if (this.busy || this.now() < this.nextGossipAt || s.target || this.fleeing) return;
    const near = s.seen.filter((c) => c.kind === 'player' && !this.world.helpers?.has(c.name)).map((c) => c.name);
    const topics = topicsOf(this.exp, this.now());
    if (near.length === 0) {
      this.letter(s, canAsk);
      return;
    }
    if (topics.length === 0) return;
    const [low, high] = GOSSIP_MS;
    this.nextGossipAt = this.now() + low + Math.random() * (high - low);
    if (!this.client || this.client.spare?.() === false || !canAsk()) {
      this.tellNews(); // no model to spare: the plain story still gets told
      return;
    }
    this.busy = true;
    this.bringUp(s, near, topics, fleetNames).finally(() => { this.busy = false; });
  }

  /** Friends in other towns stay in touch in private, now and then: news, a question, an invitation. */
  private letter(s: BodyState, canAsk: () => boolean): void {
    if (this.now() < this.nextLetterAt || !this.client || this.client.spare?.() === false) return;
    const [low, high] = LETTER_MS;
    this.nextLetterAt = this.now() + low + Math.random() * (high - low);
    const far = this.friendsOnline(s).filter((name) => this.fleet.has(name)).sort((a, b) => (this.exp.people[b]?.opinion ?? 0) - (this.exp.people[a]?.opinion ?? 0));
    const to = far[Math.floor(Math.random() * Math.min(3, far.length))];
    if (!to || !canAsk()) return;
    this.busy = true;
    this.writeLetter(s, to).finally(() => { this.busy = false; });
  }

  private async writeLetter(s: BodyState, to: string): Promise<void> {
    try {
      const where = this.placeName(s);
      const r = await this.client!.chat([
        { role: 'system', content: `${this.voicePrompt(s, true)}\nPiszesz prywatna wiadomosc do znajomego ${to}, ktory gra gdzie indziej. Podziel sie czyms, zapytaj o cos albo zaproponuj wspolna wyprawe, jesli ma to sens. Zwroc JSON: say oraz invite (yes, gdy proponujesz spotkanie; no w innym razie).` },
        { role: 'user', content: [`JESTES: ${where}. Poziom ${s.level}.`, `TWOJ PLAN: ${this.exp.plan || 'brak'}.`, `O ${to}: ${personNote(this.exp, to) || 'znacie sie slabo'}`, `WASZA HISTORIA:\n${momentNotes(this.exp, to, this.now()) || 'niewiele'}`, `O CZYM MOZESZ NAPISAC:\n${topicsOf(this.exp, this.now()).slice(0, TOPICS_SHOWN).join('\n') || 'nic szczegolnego'}`].join('\n\n') },
      ], { schema: { type: 'object', properties: { say: { type: 'string' }, invite: { type: 'string', enum: ['yes', 'no'] } }, required: ['say'] }, timeoutMs: 20_000, maxTokens: 90, purpose: 'letter' });
      const v = JSON.parse(r.text) as { say: string; invite?: string };
      if (!v.say.trim() || this.repeatsMyself(v.say)) return;
      this.diary(`pisze do ${to}: ${v.say}`);
      this.queueSay(v.say, to);
      if (v.invite === 'yes' && !this.team && this.now() >= this.teamAgainAt) this.askToTeam(to);
    } catch {
      // a letter not written hurts nobody
    }
  }

  private async bringUp(s: BodyState, near: string[], topics: string[], fleetNames: Set<string>): Promise<void> {
    try {
      const r = await this.client!.chat([
        { role: 'system', content: `${this.voicePrompt(s)}\nStoisz obok innych graczy i zagadujesz na czacie lokalnym, jak czlowiek: opowiedz o jednej rzeczy z listy albo zapytaj o nia, zwracajac sie do jednej osoby po imieniu. Plotke podawaj jako plotke. Pisz najwyzej 15 slow. Jesli nic nie pasuje, zwroc pusty tekst. Zwroc JSON z polem say.` },
        { role: 'user', content: [`OBOK CIEBIE: ${near.slice(0, 4).map((name) => personNote(this.exp, name) || name).join(' ')}`, `O CZYM MOZESZ POGADAC:\n${topics.slice(0, TOPICS_SHOWN).join('\n')}`, `OSTATNIO NA CZACIE:\n${this.chat.slice(-3).join('\n') || 'cisza'}`].join('\n\n') },
      ], { schema: { type: 'object', properties: { say: { type: 'string' } }, required: ['say'] }, timeoutMs: 20_000, maxTokens: 60, purpose: 'gossip' });
      const line = (JSON.parse(r.text) as { say: string }).say;
      if (!line.trim() || this.repeatsMyself(line)) return;
      this.diary(`zagaduje: ${line}`);
      this.exp.news.shift();
      this.chat = [...this.chat, `ty: ${line}`].slice(-CHAT_MEMORY);
      this.queueSay(line);
    } catch {
      void fleetNames; // silence is a fine answer
    }
  }

  private onFriendStatus(ev: BodyEvent): void {
    this.diary(`${ev.from} ${ev.online ? 'wszedl do gry' : 'wylogowal sie'}`);
    const known = ev.from ? this.exp.people[ev.from] : undefined;
    if (ev.online && ev.from && !this.fleet.has(ev.from) && known && known.met > 0 && this.now() - known.lastAt >= this.reunionAfter(ev.from)) {
      this.reunions.push({ name: ev.from, awayMs: this.now() - known.lastAt, isPrivate: true });
      known.lastAt = this.now();
    } else if (ev.online && ev.from && !this.fleet.has(ev.from) && Math.random() < this.def.sociability * 0.4) this.queueSay(`siema ${ev.from}, co tam?`, ev.from);
  }

  private writeMetrics(s: BodyState): void {
    if (this.now() < this.nextMetricsAt) return;
    this.nextMetricsAt = this.now() + METRICS_MS;
    const e = this.exp;
    const metrics = {
      character: this.def.character, level: s.level, experience: s.experience, gold: s.gold ?? 0, kills: Object.values(e.kills).reduce((a, b) => a + b, 0), killsBy: e.kills, deaths: e.deaths, deathsBy: e.deathsBy,
      places: Object.keys(e.chunks).length, floors: e.floors, tipsGiven: e.tipsGiven, tipsHeard: e.tipsHeard, helped: e.helped, trips: e.trips, trades: e.trades, stored: e.stored, pvpFights: e.pvpFights, grudges: e.grudges, ways: e.ways, lessons: e.lessons, modelChoices: e.modelChoices, ruleChoices: e.ruleChoices, plan: e.plan,
      fear: e.fear, confidence: e.confidence, boredom: e.boredom, loneliness: e.loneliness, overrides: e.overrides, strategy: e.strategy?.text ?? '', trials: e.trials, vows: e.vows.length, moments: Object.values(e.moments).reduce((n, m) => n + m.length, 0), weeks: e.chronicle.length, towns: e.towns, upgrades: e.upgrades,
    };
    writeFileSync(join(this.dir, 'metrics.json'), JSON.stringify(metrics));
    this.save();
  }

  tick(fleetNames: Set<string>, canAsk: () => boolean): void {
    this.fleet = fleetNames;
    if (this.ordersWaiting) this.writeOrders();
    const s = this.readState();
    if (!s || this.now() - s.atMs > 15_000) return;
    this.state = s;
    this.checkGear(s);
    for (const ev of this.events.read()) {
      this.replaying = ev.atMs < this.startedAtMs - REPLAY_MARGIN_MS; // counted again on the restored state, already told once
      if (ev.kind === 'death') this.onDeath(ev.atMs);
      else if (ev.kind === 'heard' && this.now() - ev.atMs <= STALE_EVENT_MS) {
        const leg = this.route[this.routeAt];
        if (leg?.kind === 'boat' && ev.level === 0 && CAPTAIN_REFUSES.test(ev.text ?? '')) this.boatRefused(leg);
        else if (this.lesson && this.errandUntil > 0 && ev.level === 0 && this.onTeacher(ev.text ?? '')) continue;
        else this.onHeard(s, ev, fleetNames);
      }
      else if (ev.kind === 'adapter_error') this.diary(`blad ciala: ${ev.error}`);
      else if (ev.kind === 'vip') this.onFriendStatus(ev);
      else if (ev.kind === 'loot_stuck') {
        if (!this.bagFull) this.diary('plecak pelny, trzeba sprzedac lup');
        this.bagFull = true;
      }
      else if (ev.kind === 'trade_done') {
        this.exp.trades++;
        this.shoppedAt = this.now();
        this.bagFull = false;
        this.remember(`Handel u kupca: zostalo mi ${ev.money ?? 0} zlota.`, 3, this.now(), 'trade');
        this.buying = null;
        this.endErrand(`handel skonczony: zostalo ${ev.money ?? 0} zlota`);
        this.tellNews();
      } else if (ev.kind === 'depot_done') {
        this.exp.stored = Math.max(0, this.exp.stored + (ev.stored ?? 0) - (ev.taken ?? 0));
        if ((ev.stored ?? 0) === 0 && (ev.taken ?? 0) === 0) this.depotAgainAt = this.now() + DEPOT_AGAIN_MS; // nothing moved, so no point walking back at once
        if ((ev.stored ?? 0) > 0) this.remember(`Schowalem w depo ${ev.stored}, razem tam ${this.exp.stored}.`, 3, this.now(), 'trade');
        this.endErrand(`depo: schowalem ${ev.stored ?? 0}, wyplacilem ${ev.taken ?? 0}${ev.ok ? '' : ', nie wszystko poszlo'}`);
        if ((ev.taken ?? 0) > 0) this.supplyAgainAt = 0; // the money was taken out for a reason
      }
      else if (ev.kind === 'message' && !DULL_ANNOUNCEMENT.test(ev.text ?? '') && (ev.broadcast || BOOSTED.test(ev.text ?? ''))) {
        addRumor(this.exp, { text: ev.text ?? '', from: 'serwer', atMs: ev.atMs });
        if (ev.broadcast) this.nextGossipAt = Math.min(this.nextGossipAt, this.now() + Math.random() * NEWS_TALK_MS); // nobody stays quiet about that
      }
      else if (ev.kind === 'message' && BOUGHT.test(ev.text ?? '')) this.onBought(ev.text ?? '');
      else if (ev.kind === 'message' && (ev.text ?? '').includes('Loot of')) this.noticeKill(ev.text ?? '');
      else if (ev.kind === 'message' && (ev.text ?? '').includes('advanced')) this.diary(ev.text ?? '');
      else if (ev.kind === 'message' && /joined the party|has invited you|shared experience/i.test(ev.text ?? '')) this.diary(ev.text ?? '');
      else if (ev.kind === 'message' && (ev.text ?? '').startsWith('You need to learn this spell')) this.spellRefused();
      else if (ev.kind === 'message' && (ev.text ?? '').startsWith('Sorry, not possible') && this.route[this.routeAt]?.kind) this.notPossible++; // only a use can fail like this; walking has its own timer
      else if (ev.kind === 'message' && (ev.text ?? '').startsWith('You can not enter a protection zone')) {
        if (this.now() > this.pzLockedUntil) this.diary('po walce nie wejde do miasta, czekam');
        this.pzLockedUntil = this.now() + PZ_LOCK_MS;
      }
      else if (ev.kind === 'message') {
        // Only "You lose": the same line about a monster next to you is someone else's fight.
        const attacker = /^You lose \d+ hitpoints? due to an attack by ([A-Z][^.]*)\.$/.exec(ev.text ?? '')?.[1];
        if (attacker && this.now() - ev.atMs <= STALE_EVENT_MS) this.onAttackedBy(s, attacker, fleetNames);
      }
    }
    this.notice(s);
    this.noticeTown(s);
    this.trackProgress(s);
    this.trackStay(s);
    this.guardReflexes(s);
    this.refreshSpells(s);
    if (this.route.length > 0) this.followRoute(s);
    this.obeyForcedGoal(s);
    if (this.errandUntil > 0 && this.now() > this.errandUntil) this.endErrand('nie udalo sie dokonczyc sprawy');
    this.watchPrank(s);
    if (this.ordersExtra.pvp && this.now() > this.pvpUntil) {
      this.ordersExtra = { ...this.ordersExtra, pvp: undefined };
      this.writeOrders();
    }
    if (!this.busy && this.client && this.now() >= this.nextThoughtAt && canAsk()) {
      this.nextThoughtAt = this.now() + BELIEFS_MS;
      this.busy = true;
      this.thinkItOver(s).finally(() => { this.busy = false; });
    }
    const week = weekOf(this.now());
    if (this.exp.lastWeek === 0) this.exp.lastWeek = week;
    if (!this.busy && this.client && week !== this.exp.lastWeek && this.now() >= this.weekAgainAt && canAsk()) {
      this.busy = true;
      this.writeWeek(s, week).finally(() => { this.busy = false; });
    }
    if (this.lessonDue && !this.busy) {
      const due = this.lessonDue;
      this.lessonDue = null;
      this.busy = true;
      this.reflect(due, s, canAsk()).finally(() => { this.busy = false; });
    }
    this.teamTick(s);
    this.syncParty(s);
    this.takeRest(s);
    this.callForHelp(s);
    this.socialise(s, fleetNames, canAsk);
    this.gossip(s, fleetNames, canAsk);
    this.answerReunion(s, canAsk);
    this.answerInbox(s, canAsk);
    this.settleVows();
    this.keepFriends();
    this.writeMetrics(s);
    if (this.talkingToSomeoneHere(s)) return; // nobody walks off in the middle of a sentence
    const followsSomeone = this.team !== null && (!this.team.lead || this.team.place !== undefined);
    if (!this.busy && !followsSomeone && this.route.length === 0 && this.errandUntil === 0 && this.now() >= this.nextDecisionAt) {
      if (this.client?.busyForNow?.()) {
        this.nextDecisionAt = this.now() + WAIT_FOR_MODEL_MS; // a character does not change course because the line is long
        return;
      }
      this.busy = true;
      const [low, high] = DECISION_MS;
      this.nextDecisionAt = this.now() + low + Math.random() * (high - low);
      this.decide(s, canAsk()).finally(() => { this.busy = false; });
    }
  }
}
