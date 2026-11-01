// All player agents together, with one shared budget of model calls.
import { join } from 'node:path';
import { AssistantMind, NoteStore } from './assistant.ts';
import { PlayerMind } from './mind.ts';
import type { NavGrid } from './nav.ts';
import type { PlayerDef, WorldFacts } from './types.ts';
import type { NpcMemoryStore } from '../npc/store.ts';
import type { ModelClient } from '../providers/local-model.ts';

const CALLS_PER_MINUTE = 8;

export interface PlayersFile {
  home: string;
  identity: string;
  merchant: string;
  potions?: WorldFacts['potions'];
  supplies: Record<string, { id: number; count: number }[]>;
  vocations?: Record<string, string>;
  reflexes: { tooStrongFactor: number };
  agents: Record<string, PlayerDef>;
}

/** A body without a mind still fights and heals. */
export class PlayerFleet {
  private readonly minds: PlayerMind[];
  private readonly shared: PlayerMind[];
  private readonly helpers: AssistantMind[];
  private readonly names: Set<string>;
  private calls: number[] = [];
  private readonly now: () => number;

  constructor(root: string, file: PlayersFile, world: WorldFacts, store: NpcMemoryStore, client: ModelClient | null, now: () => number = Date.now, nav: NavGrid | null = null, own: (key: string, def: PlayerDef) => ModelClient | null = () => null) {
    this.now = now;
    const facts: WorldFacts = { ...world, vocationTips: file.vocations };
    const shared: PlayerMind[] = [];
    const notes = new NoteStore(store.db);
    const entries = Object.entries(file.agents);
    this.helpers = entries.filter(([, def]) => def.role === 'assistant').map(([key, def]) => new AssistantMind(key, def, join(root, key), notes, store, own(key, def) ?? client, now));
    const players = entries.filter(([, def]) => def.role !== 'assistant');
    this.minds = players.map(([key, def]) => {
      const ownClient = own(key, def);
      const mind = new PlayerMind(key, def, join(root, key), facts, store, ownClient ?? client, file.reflexes.tooStrongFactor, now, nav);
      if (!ownClient) shared.push(mind);
      return mind;
    });
    this.shared = shared;
    facts.helpers = new Set(entries.filter(([, def]) => def.role === 'assistant').map(([, def]) => def.character));
    const byName = new Map(players.map(([, def], i) => [def.character, this.minds[i]]));
    for (const mind of this.minds) mind.useMapMarks((name) => byName.get(name)?.position() ?? null);
    this.names = new Set(players.map(([, d]) => d.character));
  }

  private canAsk = (): boolean => {
    this.calls = this.calls.filter((t) => this.now() - t < 60_000);
    if (this.calls.length >= CALLS_PER_MINUTE) return false;
    this.calls.push(this.now());
    return true;
  };

  /** A model that comes up late takes over; until then temperament decides. */
  useClient(client: ModelClient): void {
    for (const mind of this.shared) mind.useClient(client);
  }

  /** One character's trouble is its own: the others play on. */
  tick(onError: (err: Error) => void = () => {}): void {
    for (const mind of this.minds) {
      try {
        mind.tick(this.names, () => mind.meterAllows() ?? this.canAsk());
      } catch (err) {
        onError(err as Error);
      }
    }
    for (const helper of this.helpers) {
      try {
        helper.tick(this.names);
      } catch (err) {
        onError(err as Error);
      }
    }
  }
}
