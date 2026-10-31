// Mind of a player agent. A body is a real client (tools/otclient-agent) with its own reflexes; a mind
// reads what that character sees, keeps its feelings and experience, chooses where to go next and
// talks like a player. Choices come from the model among options that really exist here and now, or
// from the character's temperament when the model is away, so the game never waits for it. Each
// agent remembers only what happened to it; knowledge moves between agents by speech alone.
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { toGameAscii } from '../npc/dialogue.ts';
import { chooseByTemperament, chunkOf, needsSupplies, optionsFor, outOfSupplies, tooDangerous } from './choices.ts';
import { knowledgeFor, lookupFacts, monsterNotes, runesFor, spellsFor } from './knowledge.ts';
import { gap, tileKey, type NavGrid, type Pos, type RouteStep } from './nav.ts';
import type { BodyEvent, BodyState, Experience, Finding, Goal, Ground, PlayerDef, Team, Tip, WorldFacts } from './types.ts';
import type { NpcMemoryStore } from '../npc/store.ts';
import type { LocalModelClient } from '../providers/local-model.ts';

const DECISION_MS: [number, number] = [70_000, 130_000];
const CHAT_MEMORY = 12;
const MAX_CHUNKS = 400;
const ROUTE_STUCK_MS = 30_000;
const REPLAN_MS = 5000;
const HUNT_MS: [number, number] = [120_000, 200_000];
const SHARE_MS: [number, number] = [240_000, 600_000];
const MEET_AGAIN_MS = 600_000;
const METRICS_MS = 30_000;
const LONELY_PER_SECOND = 0.003;
const ERRAND_MS = 60_000;
const TEAM_AGAIN_MS = 720_000;
const SUPPLY_AGAIN_MS = 480_000;
const WITHDRAW_AMOUNT = 200;
const PVP_MS = 60_000;
const KEEP_GOLD = 40;
const GOLD_COIN = 3031;
const MAX_LESSONS = 6;
const REVENGE_HP = 0.4;
const NOT_POSSIBLE_LIMIT = 3;
const ATTACK_MEMORY_MS = 15_000;
const PZ_LOCK_MS = 60_000;
const GRUDGE_FADES_PER_SECOND = 0.003;
const NEEDS_COMPANY = 0.9;
const NPC_QUESTIONS = ['co slychac w okolicy?', 'gdzie warto isc polowac?', 'znasz jakies ciekawe miejsca?', 'co tu sie ostatnio dzialo?'];
const WARNING = /uwaz|niebezp|zgin|nie idz|omijaj/;
const COORDS = /(\d{3,5}),\s*(\d{3,5}),\s*(\d{1,2})/;
const TEAM_ASK = /idziemy razem|dolacz|gdzie jestes/;
const TEAM_END = /ide sam|rozdziel/;
const TEAM_NO = /teraz sam|moze pozniej/;
const HELP = /pomocy|ratunku/;
const TEAM_MS: [number, number] = [240_000, 480_000];
const TEAM_ANSWER_MS = 60_000;
const TEAM_APPROACH_MS = 480_000;
const LEAD_WAITS_MS = 120_000;
const LOST_MS = 45_000;
const HELP_MS = 180_000;
const HELP_AT = 0.35;
const REPLIES_PER_PERSON = 3;
const OVERHEARD_REPLY = 0.15;
const OWN_LINES = 6;
const REPEAT_SHARE = 0.5;
const REPLY_WINDOW_MS = 300_000;
const REPLY_GAP_MS = 4000;

const clamp = (v: number) => Math.min(1, Math.max(0, v));

function emptyExperience(): Experience {
  return { fear: 0.2, confidence: 0.4, boredom: 0.2, loneliness: 0.2, kills: {}, deathsBy: {}, deaths: 0, chunks: {}, floors: [], dangerAt: {}, warnings: {}, plan: '', finding: null, tipsGiven: 0, tipsHeard: 0, grudges: {}, lessons: [], ways: {}, trades: 0, stored: 0, pvpFights: 0, helped: 0, trips: 0, modelChoices: 0, ruleChoices: 0 };
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
  private client: LocalModelClient | null;
  private readonly now: () => number;
  private readonly factor: number;
  private exp: Experience;
  private state: BodyState | null = null;
  private goal: Goal = { type: 'idle', id: 0 };
  private say: { id: string; text: string; atMs: number; to?: string }[] = [];
  private offset = 0;
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
  private locker: Goal['locker'] | null = null;
  private errandUntil = 0;
  private teamAgainAt = 0;
  private supplyAgainAt = 0;
  private pvpUntil = 0;
  private lastAttacker: { name: string; atMs: number } | null = null;
  private notPossible = 0;
  private pzLockedUntil = 0;
  private readonly nav: NavGrid | null;
  private ordersExtra: Record<string, unknown> = {};

  constructor(key: string, def: PlayerDef, dir: string, world: WorldFacts, store: NpcMemoryStore, client: LocalModelClient | null, factor: number, now: () => number = Date.now, nav: NavGrid | null = null) {
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
    const eventsFile = join(dir, 'events.jsonl');
    this.offset = existsSync(eventsFile) ? statSync(eventsFile).size : 0; // what happened before this start is already known
    this.nextShareAt = now() + SHARE_MS[0];
  }

  useClient(client: LocalModelClient): void {
    this.client = client;
  }

  private diary(text: string): void {
    appendFileSync(join(this.dir, 'diary.log'), `${new Date(this.now()).toISOString().slice(11, 19)} ${text}\n`);
  }

  private remember(text: string, importance: number, atMs: number): void {
    this.store.addEvent({
      eventKey: `${this.key}:${atMs}:${text.slice(0, 40)}`, npcKey: this.key, kind: 'witnessed', subjectGuid: null, actorName: 'ty', text, source: 'witnessed', certainty: 'confirmed',
      visibility: 'public', importance, worldSessionId: 'players', realAtMs: atMs,
    });
  }

  private save(): void {
    const chunks = Object.entries(this.exp.chunks).sort((a, b) => b[1] - a[1]).slice(0, MAX_CHUNKS);
    this.exp.chunks = Object.fromEntries(chunks);
    this.store.setPref(this.key, 0, 'mind', JSON.stringify(this.exp), this.now());
  }

  private readState(): BodyState | null {
    try {
      return JSON.parse(readFileSync(join(this.dir, 'state.json'), 'utf8')) as BodyState;
    } catch {
      return null;
    }
  }

  private readEvents(): BodyEvent[] {
    const file = join(this.dir, 'events.jsonl');
    if (!existsSync(file)) return [];
    const size = statSync(file).size;
    if (size <= this.offset) return [];
    const text = readFileSync(file).subarray(this.offset, size).toString('utf8');
    this.offset = size;
    return text.split('\n').flatMap((line) => {
      try {
        return line ? [JSON.parse(line) as BodyEvent] : [];
      } catch {
        return [];
      }
    });
  }

  private writeOrders(): void {
    const path = join(this.dir, 'orders.json');
    writeFileSync(`${path}.tmp`, JSON.stringify({ goal: this.goal, say: this.say.slice(-6), ...this.ordersExtra }));
    renameSync(`${path}.tmp`, path);
  }

  private setGoal(goal: Omit<Goal, 'id'>): void {
    if (goal.type === 'team') {
      this.askToTeam(goal.name!);
      return;
    }
    if (goal.type === 'pvp') {
      this.startFight(goal.name!);
      return;
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
    if (goal.type === 'route' && this.state) {
      const to = { x: goal.x!, y: goal.y!, z: goal.z! };
      const route = this.nav?.route(this.state, to, this.blocked) ?? null;
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
      const passed = leg.kind === 'teleport' ? s.z === leg.to!.z && gap(leg.to!, s) <= 2 : s.z !== leg.z;
      const done = link ? passed : s.z === leg.z && gap(leg, s) <= (leg.kind === 'door' ? 0 : 1);
      if (!done) break;
      if (link) {
        this.exp.ways[leg.kind!] = (this.exp.ways[leg.kind!] ?? 0) + 1;
        this.diary(`przeszedlem: ${leg.kind} (${leg.x},${leg.y},${leg.z})`);
      }
      this.notPossible = 0;
      this.routeAt++;
      this.lastLegAt = this.now();
    }
    if (this.routeAt >= this.route.length) {
      const reached = this.routeTo;
      this.route = [];
      this.routeTo = null;
      this.ground = reached ? this.world.grounds?.find((g) => g.z === reached.z && gap(g, reached) <= 1) ?? null : null;
      this.diary(`dotarlem na miejsce${this.ground ? `: ${this.ground.name} (${this.ground.monsters.join(', ')})` : ''}`);
      if (this.visiting) this.queueSay(`${this.visiting}, ${NPC_QUESTIONS[Math.floor(Math.random() * NPC_QUESTIONS.length)]}`);
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
    const type = leg.kind === 'door' ? 'door' : leg.kind ? 'floor' : 'goto';
    if (this.goal.type !== type || this.goal.x !== leg.x || this.goal.y !== leg.y || this.goal.z !== leg.z) {
      this.goal = { type, id: ++this.seq, x: leg.x, y: leg.y, z: leg.z, kind: leg.kind, flee: this.fleeing };
      this.writeOrders();
    }
    if (this.now() - this.lastLegAt > ROUTE_STUCK_MS || this.notPossible >= NOT_POSSIBLE_LIMIT) {
      this.notPossible = 0;
      this.blocked.add(tileKey(leg.x, leg.y, leg.z));
      this.diary(`utknalem przy ${leg.x},${leg.y},${leg.z}${leg.kind ? ` (${leg.kind})` : ''}, szukam innej drogi`);
      this.replan();
    }
  }

  /** A new way to the same place: why the character was going there stays the same. */
  private replan(): void {
    this.setGoal({ type: 'route', ...this.routeTo!, name: this.visiting ?? undefined, errand: this.errand ?? undefined, locker: this.locker ?? undefined });
  }

  /** At the shop or the locker the body does the work; the mind waits for its report. */
  private startErrand(s: BodyState): void {
    this.errandUntil = this.now() + ERRAND_MS;
    if (this.errand === 'withdraw') {
      this.diary(`przy depo: wyplacam, tam jest ${this.exp.stored}`);
      this.goal = { type: 'depot', id: ++this.seq, ...this.locker!, withdraw: [{ id: GOLD_COIN, count: Math.min(this.exp.stored, WITHDRAW_AMOUNT) }], flee: this.fleeing };
    } else if (this.errand === 'shop') {
      const buy = this.world.supplies?.[this.def.vocation] ?? [];
      this.diary(`u kupca: zloto ${s.gold ?? 0}, lista ${buy.length} pozycji`);
      this.goal = { type: 'trade', id: ++this.seq, buy, flee: this.fleeing };
    } else {
      this.diary(`przy depo: zloto ${s.gold ?? 0}`);
      this.goal = { type: 'depot', id: ++this.seq, ...this.locker!, deposit: [GOLD_COIN], flee: this.fleeing };
    }
    this.writeOrders();
  }

  private endErrand(summary: string): void {
    this.errand = null;
    this.errandUntil = 0;
    this.diary(summary);
    this.goal = { type: 'hunt', id: ++this.seq, heading: { x: 0, y: 0 }, flee: this.fleeing };
    this.nextDecisionAt = this.now() + 3000;
    this.writeOrders();
  }

  private startFight(name: string): void {
    this.pvpUntil = this.now() + PVP_MS;
    this.ordersExtra = { ...this.ordersExtra, pvp: name };
    this.exp.pvpFights++;
    this.remember(`Zaatakowalem gracza ${name}.`, 7, this.now());
    this.diary(`atakuje gracza: ${name}`);
    this.writeOrders();
  }

  /** The server names who hit this character; what to do about it comes from temperament. */
  private onAttackedBy(s: BodyState, name: string, fleetNames: Set<string>): void {
    if (this.now() - (this.lastAttacker?.name === name ? this.lastAttacker.atMs : 0) > ATTACK_MEMORY_MS) {
      this.exp.grudges[name] = (this.exp.grudges[name] ?? 0) + 1;
      this.remember(`${name} mnie zaatakowal.`, 8, this.now());
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
    const wanted = JSON.parse(readFileSync(file, 'utf8')) as { option?: string; route?: Pos; visit?: string };
    rmSync(file);
    const option = optionsFor(s, this.world, this.exp, this.tips, this.friendsOnline(s)).find((o) => o.id === wanted.option);
    this.diary(`test: ${JSON.stringify(wanted)}${wanted.option && !option ? ' (nie ma takiej opcji)' : ''}`);
    if (option) this.setGoal(option.goal);
    if (wanted.route) this.setGoal({ type: 'route', ...wanted.route });
    const npc = this.world.npcs?.find((n) => n.name === wanted.visit);
    if (npc) this.setGoal({ type: 'route', x: npc.x, y: npc.y, z: npc.z, name: npc.name });
  }

  /** Feelings and memory follow what really happened to this character. */
  private notice(s: BodyState): void {
    const atMs = this.now();
    const e = this.exp;
    const chunk = chunkOf(s);
    if (!e.chunks[chunk]) {
      e.boredom = clamp(e.boredom - 0.1);
      e.chunks[chunk] = 1;
      if (s.seen.some((c) => c.kind === 'monster')) {
        const names = [...new Set(s.seen.filter((c) => c.kind === 'monster').map((c) => c.name))].slice(0, 3).join(', ');
        this.remember(`Nowe miejsce (${s.x},${s.y}, pietro ${s.z}): ${names}.`, 5, atMs);
      }
    } else {
      e.chunks[chunk]++;
      e.boredom = clamp(e.boredom + 0.002);
    }
    for (const [name, value] of Object.entries(e.grudges)) {
      if (value <= GRUDGE_FADES_PER_SECOND) delete e.grudges[name];
      else e.grudges[name] = value - GRUDGE_FADES_PER_SECOND;
    }
    const friendNear = s.seen.some((c) => c.kind === 'player');
    e.loneliness = clamp(e.loneliness + (friendNear ? -LONELY_PER_SECOND * 3 : LONELY_PER_SECOND * this.def.sociability));
    if (this.lastHp > 0 && s.hp < this.lastHp) e.fear = clamp(e.fear + ((this.lastHp - s.hp) / s.hpMax) * 0.5);
    else e.fear = clamp(e.fear - 0.003);
    if (this.lastExperience > 0 && s.experience > this.lastExperience) {
      e.confidence = clamp(e.confidence + 0.02);
      if (this.ground) e.finding = { name: this.ground.name, monsters: this.ground.monsters, danger: false };
    }
    if (this.lastZ !== null && this.lastZ !== s.z) {
      this.diary(`zmiana pietra: ${this.lastZ} -> ${s.z}`);
      if (!e.floors.includes(s.z)) {
        e.floors.push(s.z);
        this.remember(`Pierwszy raz na pietrze ${s.z} (${s.x},${s.y}).`, 6, atMs);
      }
      this.nextDecisionAt = atMs;
    }
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
    const s = this.state;
    const byPlayer = this.lastAttacker && atMs - this.lastAttacker.atMs < ATTACK_MEMORY_MS ? this.lastAttacker.name : null;
    const killer = byPlayer ?? s?.seen.find((c) => c.kind === 'monster')?.name ?? 'nie wiem co';
    if (byPlayer) this.exp.grudges[byPlayer] = (this.exp.grudges[byPlayer] ?? 0) + 5;
    const e = this.exp;
    e.deaths++;
    e.deathsBy[killer] = (e.deathsBy[killer] ?? 0) + 1;
    e.fear = clamp(e.fear + 0.4);
    e.confidence = clamp(e.confidence - 0.25);
    if (s) e.dangerAt[chunkOf(s)] = killer;
    if (this.ground) e.finding = { name: this.ground.name, monsters: this.ground.monsters, danger: true };
    this.lastGroundName = this.ground?.name ?? '';
    this.ground = null;
    this.remember(`Zginalem przez: ${killer}${s ? ` na ${s.x},${s.y}, pietro ${s.z}` : ''}.`, 9, atMs);
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
      this.remember(`Za silne dla mnie: ${danger} (${s.x},${s.y}, pietro ${s.z}).`, 7, this.now());
      this.exp.dangerAt[chunkOf(s)] = danger;
      if (this.ground) this.exp.finding = { name: this.ground.name, monsters: this.ground.monsters, danger: true };
    }
    this.goal = { ...this.goal, flee };
    this.writeOrders();
  }

  private refreshSpells(s: BodyState): void {
    if (this.spellLevel === s.level) return;
    this.spellLevel = s.level;
    const { heal, attack } = spellsFor(this.def, s.level, this.world.spells);
    this.ordersExtra = { ...this.ordersExtra, healSpell: heal?.words, healMana: heal?.mana, attackSpell: attack?.words, attackMana: attack?.mana, runes: runesFor(this.def, s.level, this.world.runes), keep: this.world.sellable };
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

  private voicePrompt(s: BodyState): string {
    return [
      `Grasz w Tibie postacia ${this.def.character} (${this.def.vocation}, poziom ${s.level}). Jestes zwyklym graczem na serwerze, a nie postacia z ksiazki.`,
      `Jak piszesz: ${this.def.voice}. Krotko, jak na czacie w grze, zwykle jedno zdanie. Bez cudzyslowow, bez "jako".`,
      'Pisz najwyzej 10 slow. Nie powtarzaj tego, co juz pisales, i nie kopiuj cudzych zdan. Gdy nie masz nic nowego do powiedzenia, zwroc pusty tekst.',
      'Mozesz rozmawiac o wszystkim, takze o rzeczywistym swiecie. Nie wymyslaj faktow o tym, co sie zdarzylo w grze: mow tylko o tym, co jest ponizej.',
      this.world.identity === 'in_character'
        ? 'Jestes czlowiekiem, ktory gra w te gre dla przyjemnosci. Nie piszesz o sobie jako o programie, bocie ani AI. Pytanie o to traktujesz jak zaczepke innego gracza.'
        : 'Jesli ktos wprost pyta, czy jestes botem albo AI, nie klam.',
    ].join('\n');
  }

  private friendsOnline(s: BodyState): string[] {
    return Array.isArray(s.vips) ? s.vips.filter((v) => v.online).map((v) => v.name) : [];
  }

  private recentMemories(limit: number): string {
    return this.store.visibleEvents(this.key, 0, limit).map((m) => `- ${m.text}`).join('\n');
  }

  /** Chooses the next goal: the model picks among real options, or temperament does. */
  private async decide(s: BodyState, canAsk: boolean): Promise<void> {
    const friends = this.friendsOnline(s);
    const options = optionsFor(s, this.world, this.exp, this.tips, this.team || this.now() < this.teamAgainAt ? [] : friends);
    if (options.length === 0) return;
    const pickByRules = () => chooseByTemperament(this.def, this.exp, s, options);
    let chosen = pickByRules();
    let thought = 'zdecydowalem po swojemu';
    let line = '';
    let byModel = false;
    if (this.client && canAsk) {
      try {
        const r = await this.client.chat([
          { role: 'system', content: `${this.voicePrompt(s)}\nDecydujesz, co zrobic dalej. Sam wybierasz, nikt ci nie kaze: grasz po swojemu, chcesz rosnac w sile, poznawac swiat i dobrze sie bawic. Chodzenie bez celu nudzi, polowanie daje exp. Zwroc JSON: choice (jedna z podanych), thought (twoja mysl, jedno zdanie), plan (co chcesz osiagnac w najblizszym czasie, jedno zdanie), say (co piszesz na czacie, zwykle pusty tekst).` },
          { role: 'user', content: [
            `STAN: hp ${s.hp}/${s.hpMax}, mana ${s.mana}/${s.manaMax}, mikstury ${s.potions.health}/${s.potions.mana}, pozycja ${s.x},${s.y}, pietro ${s.z} (7 to powierzchnia, wyzsza liczba to glebiej).`,
            `ODCZUCIA: ${feelingWords(this.exp)}. Smierci: ${this.exp.deaths}. Zlota: ${s.gold ?? 0}.`,
            `TWOJ PLAN: ${this.exp.plan || 'jeszcze go nie masz'}.`,
            `ZNAJOMI ONLINE: ${friends.join(', ') || 'nikt'}.${this.team ? ` Teraz idziesz razem z: ${this.team.with}.` : ''}`,
            `URAZY: ${Object.entries(this.exp.grudges).map(([n, v]) => `${n} ${Math.round(v)}`).join(', ') || 'zadnych'}.`,
            `LEKCJE Z TWOICH BLEDOW:\n${this.exp.lessons.join('\n') || 'jeszcze zadnych'}`,
            `WIDZISZ: ${s.seen.map((c) => c.name).slice(0, 6).join(', ') || 'nikogo'}.`,
            `POTWORY: ${monsterNotes(s, this.world) || 'brak'}.`,
            `DOSWIADCZENIE:\n${this.recentMemories(6) || 'jeszcze nic'}`,
            `CO USLYSZALES:\n${this.chat.slice(-4).join('\n') || 'nic'}`,
            knowledgeFor(this.def, s, this.world),
            ...(needsSupplies(s) ? ['ZAPASY: konczy ci sie zapas albo plecak jest pelny.'] : []),
            'RAZEM: we dwojke bezpieczniej i latwiej o silniejsze potwory; mozna tez isc samemu, jak wolisz.',
            `MOZLIWOSCI:\n${options.map((o) => `${o.id}: ${o.label}`).join('\n')}`,
          ].join('\n\n') },
        ], {
          schema: { type: 'object', properties: { choice: { type: 'string', enum: options.map((o) => o.id) }, thought: { type: 'string' }, plan: { type: 'string' }, say: { type: 'string' } }, required: ['choice', 'thought', 'plan', 'say'] },
          timeoutMs: 20_000, maxTokens: 200,
        });
        const v = JSON.parse(r.text) as { choice: string; thought: string; plan: string; say: string };
        chosen = options.find((o) => o.id === v.choice) ?? chosen;
        thought = toGameAscii(v.thought ?? '').slice(0, 160) || thought;
        line = v.say ?? '';
        this.exp.plan = toGameAscii(v.plan ?? '').slice(0, 160) || this.exp.plan;
        byModel = true;
      } catch (err) {
        thought = `model milczy (${(err as Error).message.slice(0, 40)}), decyduje sam`;
      }
    }
    const company = options.find((o) => o.id.startsWith('team_'));
    if (company && !this.team && this.exp.loneliness > NEEDS_COMPANY) {
      chosen = company;
      thought = 'ile mozna samemu, poszukam towarzystwa';
    }
    // Hunger beats plans: with nothing left a character goes for supplies, whatever it felt like doing.
    const supplies = options.find((o) => o.id === 'withdraw') ?? options.find((o) => o.id === 'supply');
    if (supplies && outOfSupplies(s) && this.now() >= this.supplyAgainAt) {
      chosen = supplies;
      thought = 'bez zapasow nie ma co isc dalej';
      this.supplyAgainAt = this.now() + SUPPLY_AGAIN_MS;
    }
    if (byModel) this.exp.modelChoices++;
    else this.exp.ruleChoices++;
    this.diary(`${chosen.id}: ${thought}`);
    if (!chosen.id.startsWith('hunt_') && !chosen.id.startsWith('tip_') && chosen.id !== 'fight') this.ground = null;
    this.setGoal(chosen.goal);
    if (line) this.queueSay(line);
    this.save();
  }

  private async reply(s: BodyState, from: string, text: string, isPrivate: boolean): Promise<void> {
    if (!this.client) return;
    const facts = lookupFacts(text, this.world);
    try {
      const r = await this.client.chat([
        { role: 'system', content: `${this.voicePrompt(s)}\nOdpowiedz na czacie. Zwroc JSON: say oraz opinion (co sadzisz o rozmowcy po tej wiadomosci, liczba od -2 do 2).` },
        { role: 'user', content: [
          `SYTUACJA: hp ${s.hp}/${s.hpMax}, pietro ${s.z}; ${feelingWords(this.exp)}.`,
          `TWOJE DOSWIADCZENIE (mozesz sie nim podzielic, jesli pasuje):\n${this.recentMemories(5) || 'jeszcze nic'}`,
          knowledgeFor(this.def, s, this.world),
          ...(facts.length > 0 ? [`FAKTY Z GRY:\n${facts.join('\n')}`] : []),
          `ROZMOWA Z ${from}:\n${this.chat.filter((l) => l.includes(from)).slice(-6).join('\n') || 'dopiero zaczynacie'}`,
          `${from} napisal${isPrivate ? ' prywatnie' : ''}: ${JSON.stringify(text.slice(0, 200))}`,
        ].join('\n\n') },
      ], { schema: { type: 'object', properties: { say: { type: 'string' }, opinion: { type: 'integer' } }, required: ['say'] }, timeoutMs: 20_000, maxTokens: 70 });
      const answer = JSON.parse(r.text) as { say: string; opinion?: number };
      const line = answer.say;
      if (answer.opinion !== undefined && answer.opinion < 0) this.exp.grudges[from] = (this.exp.grudges[from] ?? 0) + 1;
      if (answer.opinion !== undefined && answer.opinion > 1 && this.exp.grudges[from]) this.exp.grudges[from] -= 1;
      if (!line.trim() || this.repeatsMyself(line)) {
        this.diary(`${from}: ${text} -> (bez odpowiedzi)`);
        return;
      }
      this.diary(`${from}: ${text} -> ${line}`);
      this.chat = [...this.chat, `ty do ${from}: ${line}`].slice(-CHAT_MEMORY);
      this.queueSay(line, isPrivate ? from : undefined);
    } catch (err) {
      this.diary(`nie odpowiedzialem ${from}: ${(err as Error).message.slice(0, 40)}`);
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
    if (!from || from.includes('[AI]') || !text || ev.level === 0 || this.world.monsters[from]) return; // other NPC and monster lines are scenery
    this.chat = [...this.chat, `${from}: ${text}`].slice(-CHAT_MEMORY);
    this.exp.loneliness = clamp(this.exp.loneliness - 0.03);
    this.store.addEvent({
      eventKey: `${this.key}:heard:${ev.atMs}:${from}`, npcKey: this.key, kind: 'heard', subjectGuid: null, actorName: from, text, source: 'heard', certainty: 'rumor',
      visibility: 'public', importance: fleetNames.has(from) ? 5 : 4, worldSessionId: 'players', realAtMs: ev.atMs,
    });
    if (this.teamwork(s, from, text.toLowerCase(), fleetNames)) return;
    this.learnFrom(from, text);
    const named = ev.private || text.toLowerCase().includes(this.def.character.toLowerCase().slice(0, 4));
    if (named || Math.random() < this.def.sociability * OVERHEARD_REPLY) this.inbox = [...this.inbox.filter((m) => m.from !== from), { from, text, isPrivate: ev.private === true }];
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
    if (recent.length >= REPLIES_PER_PERSON) {
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
    this.team = { with: name, lead: false, following: false, waiting: true, untilMs: this.now() + TEAM_APPROACH_MS, lastSeenAt: this.now(), lostAsks: 0 };
    this.diary(`pytam ${name} o wspolna wyprawe`);
    this.queueSay(`${name} idziemy razem? gdzie jestes?`, name);
  }

  /** Help and trips together run on plain words: a place is known only because someone wrote it. */
  private teamwork(s: BodyState, from: string, low: string, fleetNames: Set<string>): boolean {
    const m = COORDS.exec(low);
    const place = m ? { x: Number(m[1]), y: Number(m[2]), z: Number(m[3]) } : null;
    if (HELP.test(low) && place) {
      if (!this.fleeing && s.hp / s.hpMax > 0.5 && Math.random() < this.def.bravery + 0.3) {
        this.diary(`${from} prosi o pomoc, ide na ${place.x},${place.y},${place.z}`);
        this.exp.helped++;
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
      if (this.errand || this.now() < this.teamAgainAt || outOfSupplies(s)) {
        this.diary(`${from} chce isc razem, ale teraz nie`);
        this.queueSay('teraz sam, moze pozniej', from);
      } else if (!this.fleeing && Math.random() < 0.3 + this.def.sociability * 0.7) {
        const [low2, high] = TEAM_MS;
        this.team ??= { with: from, lead: true, following: false, waiting: false, untilMs: this.now() + low2 + Math.random() * (high - low2), lastSeenAt: this.now(), lostAsks: 0 };
        this.diary(`${from} chce isc razem, podaje gdzie jestem`);
        this.exp.loneliness = 0.1;
        this.queueSay(`jasne, jestem ${s.x},${s.y},${s.z}, czekam`, from);
        this.setGoal({ type: 'hunt', heading: { x: 0, y: 0 } }); // stays around so the friend can find this spot
        this.nextDecisionAt = this.now() + LEAD_WAITS_MS;
      } else {
        this.diary(`${from} chce isc razem, ale wole sam`);
        this.queueSay('teraz sam, moze pozniej', from);
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
      this.nextDecisionAt = this.now();
      return true;
    }
    return false;
  }

  /** After a death the character thinks over what went wrong, and that stays with it. */
  private async reflect(d: NonNullable<PlayerMind['lessonDue']>, s: BodyState, canAsk: boolean): Promise<void> {
    let lesson = `${d.killer} mnie zabil na poziomie ${d.level}, mialem ${d.potions} mikstur; nastepnym razem wiecej zapasow albo silniejszy poziom.`;
    if (this.client && canAsk) {
      try {
        const r = await this.client.chat([
          { role: 'system', content: `${this.voicePrompt(s)}\nWlasnie zginales. Zastanow sie, co zrobiles zle i co zmienisz. Zwroc JSON z polem lesson, jedno konkretne zdanie.` },
          { role: 'user', content: `Zabil cie: ${d.killer}. Poziom ${d.level}, pietro ${d.z}, mikstury przy smierci ${d.potions}${d.ground ? `, miejsce ${d.ground}` : ''}. Wczesniejsze lekcje:\n${this.exp.lessons.join('\n') || 'brak'}` },
        ], { schema: { type: 'object', properties: { lesson: { type: 'string' } }, required: ['lesson'] }, timeoutMs: 20_000, maxTokens: 70 });
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
    if (!t.lead) {
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
    if (outOfSupplies(s) && this.now() >= this.supplyAgainAt && !t.lead) {
      this.diary(`koncza mi sie zapasy, zostawiam ${t.with}`);
      this.endTeam();
      return;
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
    if (s.seen.some((c) => c.kind === 'player' && c.name === t.with)) {
      t.lastSeenAt = now;
      t.lostAsks = 0;
      if (!t.following) {
        t.following = true;
        this.exp.trips++;
        const [low, high] = TEAM_MS;
        t.untilMs = now + low + Math.random() * (high - low);
        this.exp.loneliness = 0.1;
        this.route = [];
        this.routeTo = null;
        this.diary(`idziemy razem z ${t.with}`);
        this.goal = { type: 'follow', id: ++this.seq, name: t.with, flee: this.fleeing };
        this.writeOrders();
      }
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
    this.queueSay(`pomocy, ${foe.name} mnie bije, jestem ${s.x},${s.y},${s.z}`, to);
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
        ], { schema: { type: 'object', properties: { say: { type: 'string' } }, required: ['say'] }, timeoutMs: 20_000, maxTokens: 80 });
        const said = (JSON.parse(r.text) as { say: string }).say;
        if (toGameAscii(said).toLowerCase().includes(finding.name.toLowerCase())) line = said;
      } catch {
        // the plain sentence still carries the news
      }
    }
    this.diary(`pisze do ${to}: ${line}`);
    this.queueSay(line, to);
    this.exp.tipsGiven++;
  }

  private socialise(s: BodyState, fleetNames: Set<string>, canAsk: () => boolean): void {
    for (const friend of s.seen.filter((c) => c.kind === 'player' && fleetNames.has(c.name))) {
      if (this.now() - (this.lastMet.get(friend.name) ?? 0) > MEET_AGAIN_MS) {
        this.lastMet.set(friend.name, this.now());
        this.diary(`spotkalem: ${friend.name}`);
        if (Math.random() < this.def.sociability) this.inbox.push({ from: friend.name, text: `(spotykasz ${friend.name} na mapie, zagadaj krotko jak gracz)`, isPrivate: false });
      }
    }
    if (this.busy || this.now() < this.nextShareAt) return;
    const [low, high] = SHARE_MS;
    this.nextShareAt = this.now() + (low + Math.random() * (high - low)) * (1.3 - this.def.sociability);
    const finding = this.exp.finding;
    const friends = this.friendsOnline(s);
    if (!finding || friends.length === 0) return;
    this.exp.finding = null;
    this.busy = true;
    this.tellFriend(s, friends[Math.floor(Math.random() * friends.length)], finding, canAsk()).finally(() => { this.busy = false; });
  }

  private onFriendStatus(ev: BodyEvent): void {
    this.diary(`${ev.from} ${ev.online ? 'wszedl do gry' : 'wylogowal sie'}`);
    if (ev.online && ev.from && Math.random() < this.def.sociability * 0.4) this.queueSay(`siema ${ev.from}, co tam?`, ev.from);
  }

  private writeMetrics(s: BodyState): void {
    if (this.now() < this.nextMetricsAt) return;
    this.nextMetricsAt = this.now() + METRICS_MS;
    const e = this.exp;
    const metrics = {
      character: this.def.character, level: s.level, experience: s.experience, gold: s.gold ?? 0, kills: Object.values(e.kills).reduce((a, b) => a + b, 0), killsBy: e.kills, deaths: e.deaths, deathsBy: e.deathsBy,
      places: Object.keys(e.chunks).length, floors: e.floors, tipsGiven: e.tipsGiven, tipsHeard: e.tipsHeard, helped: e.helped, trips: e.trips, trades: e.trades, stored: e.stored, pvpFights: e.pvpFights, grudges: e.grudges, ways: e.ways, lessons: e.lessons, modelChoices: e.modelChoices, ruleChoices: e.ruleChoices, plan: e.plan,
      fear: e.fear, confidence: e.confidence, boredom: e.boredom, loneliness: e.loneliness,
    };
    writeFileSync(join(this.dir, 'metrics.json'), JSON.stringify(metrics));
    this.save();
  }

  tick(fleetNames: Set<string>, canAsk: () => boolean): void {
    const s = this.readState();
    if (!s || this.now() - s.atMs > 15_000) return;
    this.state = s;
    for (const ev of this.readEvents()) {
      if (ev.kind === 'death') this.onDeath(ev.atMs);
      else if (ev.kind === 'heard') this.onHeard(s, ev, fleetNames);
      else if (ev.kind === 'adapter_error') this.diary(`blad ciala: ${ev.error}`);
      else if (ev.kind === 'vip') this.onFriendStatus(ev);
      else if (ev.kind === 'trade_done') {
        this.exp.trades++;
        this.endErrand(`handel skonczony: zostalo ${ev.money ?? 0} zlota`);
      } else if (ev.kind === 'depot_done') {
        this.exp.stored = Math.max(0, this.exp.stored + (ev.stored ?? 0) - (ev.taken ?? 0));
        this.endErrand(`depo: schowalem ${ev.stored ?? 0}, wyplacilem ${ev.taken ?? 0}${ev.ok ? '' : ', nie wszystko poszlo'}`);
        if ((ev.taken ?? 0) > 0) this.supplyAgainAt = 0; // the money was taken out for a reason
      }
      else if (ev.kind === 'message' && (ev.text ?? '').includes('Loot of')) this.noticeKill(ev.text ?? '');
      else if (ev.kind === 'message' && (ev.text ?? '').includes('advanced')) this.diary(ev.text ?? '');
      else if (ev.kind === 'message' && (ev.text ?? '').startsWith('Sorry, not possible') && this.route.length > 0) this.notPossible++;
      else if (ev.kind === 'message' && (ev.text ?? '').startsWith('You can not enter a protection zone')) {
        if (this.now() > this.pzLockedUntil) this.diary('po walce nie wejde do miasta, czekam');
        this.pzLockedUntil = this.now() + PZ_LOCK_MS;
      }
      else if (ev.kind === 'message') {
        // Only "You lose": the same line about a monster next to you is someone else's fight.
        const attacker = /^You lose \d+ hitpoints? due to an attack by ([A-Z][^.]*)\.$/.exec(ev.text ?? '')?.[1];
        if (attacker) this.onAttackedBy(s, attacker, fleetNames);
      }
    }
    this.notice(s);
    this.guardReflexes(s);
    this.refreshSpells(s);
    if (this.route.length > 0) this.followRoute(s);
    this.obeyForcedGoal(s);
    if (this.errandUntil > 0 && this.now() > this.errandUntil) this.endErrand('nie udalo sie dokonczyc sprawy');
    if (this.ordersExtra.pvp && this.now() > this.pvpUntil) {
      this.ordersExtra = { ...this.ordersExtra, pvp: undefined };
      this.writeOrders();
    }
    if (this.lessonDue && !this.busy) {
      const due = this.lessonDue;
      this.lessonDue = null;
      this.busy = true;
      this.reflect(due, s, canAsk()).finally(() => { this.busy = false; });
    }
    this.teamTick(s);
    this.callForHelp(s);
    this.socialise(s, fleetNames, canAsk);
    this.answerInbox(s, canAsk);
    this.writeMetrics(s);
    const followsSomeone = this.team !== null && !this.team.lead;
    if (!this.busy && !followsSomeone && this.route.length === 0 && this.errandUntil === 0 && this.now() >= this.nextDecisionAt) {
      this.busy = true;
      const [low, high] = DECISION_MS;
      this.nextDecisionAt = this.now() + low + Math.random() * (high - low);
      this.decide(s, canAsk()).finally(() => { this.busy = false; });
    }
  }
}
