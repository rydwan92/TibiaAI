// All player agents together, with one shared budget of model calls.
import { join } from 'node:path';
import { PlayerMind } from './mind.ts';
import type { NavGrid } from './nav.ts';
import type { PlayerDef, WorldFacts } from './types.ts';
import type { NpcMemoryStore } from '../npc/store.ts';
import type { LocalModelClient } from '../providers/local-model.ts';

const CALLS_PER_MINUTE = 8;

export interface PlayersFile {
  home: string;
  identity: string;
  merchant: string;
  supplies: Record<string, { id: number; count: number }[]>;
  vocations?: Record<string, string>;
  reflexes: { tooStrongFactor: number };
  agents: Record<string, PlayerDef>;
}

/** A body without a mind still fights and heals. */
export class PlayerFleet {
  private readonly minds: PlayerMind[];
  private readonly names: Set<string>;
  private calls: number[] = [];
  private readonly now: () => number;

  constructor(root: string, file: PlayersFile, world: WorldFacts, store: NpcMemoryStore, client: LocalModelClient | null, now: () => number = Date.now, nav: NavGrid | null = null) {
    this.now = now;
    const facts = { ...world, vocationTips: file.vocations };
    this.minds = Object.entries(file.agents).map(([key, def]) => new PlayerMind(key, def, join(root, key), facts, store, client, file.reflexes.tooStrongFactor, now, nav));
    this.names = new Set(Object.values(file.agents).map((d) => d.character));
  }

  private canAsk = (): boolean => {
    this.calls = this.calls.filter((t) => this.now() - t < 60_000);
    if (this.calls.length >= CALLS_PER_MINUTE) return false;
    this.calls.push(this.now());
    return true;
  };

  /** A model that comes up late takes over; until then temperament decides. */
  useClient(client: LocalModelClient): void {
    for (const mind of this.minds) mind.useClient(client);
  }

  tick(): void {
    for (const mind of this.minds) mind.tick(this.names, this.canAsk);
  }
}
