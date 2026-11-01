// Navigation for player agents: the map as the engine reads it (runtime/atlas/nav-map.jsonl from
// tools/world_atlas.py, one bit per tile, plus closed doors) and every floor change and teleport from
// the atlas. The world has 18 million tiles, so chunks are bit rows and sets are bitmaps. A route is computed
// here and walked by the client in short legs; the server still checks each step, so a stale map
// only costs a replan.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { FloorPoint } from './types.ts';

export interface Pos {
  x: number;
  y: number;
  z: number;
}

export interface RouteStep extends Pos {
  /** Set when this step is more than walking: a floor change, a teleport or a door. */
  kind?: string;
  /** Where a link leads. */
  to?: Pos;
  /** What to say to the captain for this passage. */
  word?: string;
}

/** A captain and his passages, from tools/make_boats.py. */
export interface Boat extends Pos {
  npc: string;
  stops: { word: string; price: number; to: Pos }[];
}

interface Link {
  to: Pos;
  kind: string;
  at: Pos;
  word?: string;
  price?: number;
}

const CHUNK = 16;
const MAX_NODES = 1_500_000;
const LEG = 6;
const DOOR_COST = 4;
const LINK_COST = 4;
const BOAT_COST = 60;
const NEIGHBOURS: [number, number][] = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
/** Standing on these changes the floor, so a route never crosses them by accident. */
const WALK_ON = new Set(['stairs', 'hole', 'teleport']);
const ROW_SIZE = 65_536; // coordinates are 16 bits: the real map passes x and y = 32768
const FLOOR_SIZE = ROW_SIZE * ROW_SIZE;

export const gap = (a: { x: number; y: number }, b: { x: number; y: number }): number => Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));

export const tileKey = (x: number, y: number, z: number): number => z * FLOOR_SIZE + y * ROW_SIZE + x;

function fromKey(node: number): Pos {
  const z = Math.floor(node / FLOOR_SIZE);
  const rest = node - z * FLOOR_SIZE;
  const y = Math.floor(rest / ROW_SIZE);
  return { x: rest - y * ROW_SIZE, y, z };
}

/** Binary heap of [priority, node]; small and fast enough for one route per decision. */
class Heap {
  private readonly items: [number, number][] = [];

  get size(): number {
    return this.items.length;
  }

  push(item: [number, number]): void {
    const h = this.items;
    h.push(item);
    let i = h.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (h[parent][0] <= h[i][0]) break;
      [h[parent], h[i]] = [h[i], h[parent]];
      i = parent;
    }
  }

  pop(): [number, number] {
    const h = this.items;
    const top = h[0];
    const last = h.pop()!;
    if (h.length > 0) {
      h[0] = last;
      let i = 0;
      for (;;) {
        const a = 2 * i + 1;
        const b = a + 1;
        let m = i;
        if (a < h.length && h[a][0] < h[m][0]) m = a;
        if (b < h.length && h[b][0] < h[m][0]) m = b;
        if (m === i) break;
        [h[m], h[i]] = [h[i], h[m]];
        i = m;
      }
    }
    return top;
  }
}

const chunkKey = (x: number, y: number, z: number) => tileKey(x - (x % CHUNK), y - (y % CHUNK), z);

/** A set of tiles at a few bytes per chunk. */
export class TileSet {
  private readonly chunks = new Map<number, Uint16Array>();

  has(key: number): boolean {
    const { x, y, z } = fromKey(key);
    const rows = this.chunks.get(chunkKey(x, y, z));
    return rows !== undefined && (rows[y % CHUNK] & (0x8000 >> (x % CHUNK))) !== 0;
  }

  /** False when the tile was already in. */
  add(key: number): boolean {
    const { x, y, z } = fromKey(key);
    const at = chunkKey(x, y, z);
    let rows = this.chunks.get(at);
    if (!rows) {
      rows = new Uint16Array(CHUNK);
      this.chunks.set(at, rows);
    }
    const bit = 0x8000 >> (x % CHUNK);
    if (rows[y % CHUNK] & bit) return false;
    rows[y % CHUNK] |= bit;
    return true;
  }
}

export class NavGrid {
  private readonly rows = new Map<number, Uint16Array>();
  private readonly doors = new Set<number>();
  private readonly closed = new Set<number>();
  private readonly links = new Map<number, Link>();
  private readonly linksInto = new Map<number, Link[]>();
  private readonly boats = new Map<number, Link[]>();
  private walkOn = new Set<number>();

  /** One surveyed chunk: rows of hex nibbles, and closed doors as [x, y]. */
  addChunk(x: number, y: number, z: number, rows: string[], doors: [number, number][] = []): void {
    this.rows.set(tileKey(x, y, z), Uint16Array.from(rows, (row) => parseInt(row, 16)));
    for (const [dx, dy] of doors) this.doors.add(tileKey(dx, dy, z));
  }

  /** Tiles our own places put something solid on: the atlas of the original map does not know them. */
  close(tiles: Pos[]): void {
    for (const t of tiles) this.closed.add(tileKey(t.x, t.y, t.z));
  }

  walkable(x: number, y: number, z: number): boolean {
    if (this.closed.has(tileKey(x, y, z))) return false;
    const rows = this.rows.get(chunkKey(x, y, z));
    return rows !== undefined && (rows[y % CHUNK] & (0x8000 >> (x % CHUNK))) !== 0;
  }

  private landing(p: Pos, z: number, avoid: Set<number>): Pos | null {
    for (let r = 0; r <= 2; r++) {
      for (let dx = -r; dx <= r; dx++) {
        for (let dy = -r; dy <= r; dy++) {
          if (this.walkable(p.x + dx, p.y + dy, z) && !avoid.has(tileKey(p.x + dx, p.y + dy, z))) return { x: p.x + dx, y: p.y + dy, z };
        }
      }
    }
    return null;
  }

  addFloorLinks(points: FloorPoint[]): void {
    const walkOn = new Set(points.filter((p) => WALK_ON.has(p.kind)).map((p) => tileKey(p.x, p.y, p.z)));
    this.walkOn = walkOn;
    for (const p of points) {
      const to = p.to ? this.landing(p.to, p.to.z, walkOn) : this.landing(p, p.z + (p.dir === 'down' ? 1 : -1), walkOn);
      if (!to) continue;
      const link = { to, kind: p.kind, at: { x: p.x, y: p.y, z: p.z } };
      this.links.set(tileKey(p.x, p.y, p.z), link);
      const into = tileKey(to.x, to.y, to.z);
      this.linksInto.set(into, [...(this.linksInto.get(into) ?? []), link]);
    }
  }

  /** A captain stands on one tile and sails to many places, so passages are links of their own. */
  addBoats(boats: Boat[]): void {
    for (const b of boats) {
      const at = { x: b.x, y: b.y, z: b.z };
      const key = tileKey(b.x, b.y, b.z);
      for (const stop of b.stops) {
        // Ships land people on deck tiles the map marks as stairs; the route must start beside them.
        const to = this.landing(stop.to, stop.to.z, this.walkOn);
        if (!to) continue;
        const link = { to, kind: 'boat', at, word: stop.word, price: stop.price };
        this.boats.set(key, [...(this.boats.get(key) ?? []), link]);
        const into = tileKey(to.x, to.y, to.z);
        this.linksInto.set(into, [...(this.linksInto.get(into) ?? []), link]);
      }
    }
  }

  /** The closest tile to walk to around a point, for going in a direction rather than to a place. */
  nearestWalkable(p: Pos, radius: number): Pos | null {
    for (let r = 0; r <= radius; r++) {
      for (let dx = -r; dx <= r; dx++) {
        for (let dy = -r; dy <= r; dy++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) === r && this.walkable(p.x + dx, p.y + dy, p.z) && !this.walkOn.has(tileKey(p.x + dx, p.y + dy, p.z))) return { x: p.x + dx, y: p.y + dy, z: p.z };
        }
      }
    }
    return null;
  }

  /** Where a floor change at this tile leads, for walking there by a proper route. */
  linkTarget(at: Pos): Pos | null {
    return this.links.get(tileKey(at.x, at.y, at.z))?.to ?? null;
  }

  get linkCount(): number {
    return this.links.size;
  }

  get doorCount(): number {
    return this.doors.size;
  }

  /** Every way out of a tile, as the same moves a route may use. */
  private moves(node: number, start: number, blocked: Set<number> | undefined, visit: (next: number, step: number, link?: Link) => void, gold = Infinity): void {
    const { x, y, z } = fromKey(node);
    const here = this.links.get(node);
    if (here && !blocked?.has(node) && WALK_ON.has(here.kind)) {
      visit(tileKey(here.to.x, here.to.y, here.to.z), LINK_COST, here);
      if (node !== start) return;
    }
    for (const [dx, dy] of NEIGHBOURS) {
      const nx = x + dx;
      const ny = y + dy;
      const next = tileKey(nx, ny, z);
      if (blocked?.has(next)) continue;
      for (const boat of this.boats.get(next) ?? []) {
        if ((boat.price ?? 0) <= gold) visit(tileKey(boat.to.x, boat.to.y, boat.to.z), BOAT_COST, boat);
      }
      const near = this.links.get(next);
      if (near && !WALK_ON.has(near.kind)) visit(tileKey(near.to.x, near.to.y, near.to.z), LINK_COST, near); // ladders and rope spots are used from beside
      if (this.doors.has(next)) {
        if (dx === 0 || dy === 0) visit(next, DOOR_COST);
      } else if (this.walkable(nx, ny, z)) {
        visit(next, dx !== 0 && dy !== 0 ? 1.5 : 1);
      }
    }
    if (here && !blocked?.has(node) && !WALK_ON.has(here.kind)) visit(tileKey(here.to.x, here.to.y, here.to.z), LINK_COST, here);
  }

  /** A* over tiles, doors, floor links and paid passages; short legs for the client, or null when out of reach. */
  route(from: Pos, to: Pos, blocked?: Set<number>, gold = Infinity): RouteStep[] | null {
    const goal = tileKey(to.x, to.y, to.z);
    const start = tileKey(from.x, from.y, from.z);
    const open = new Heap();
    const cost = new Map<number, number>([[start, 0]]);
    const parent = new Map<number, number>();
    const via = new Map<number, Link>();
    open.push([0, start]);
    let seen = 0;
    while (open.size > 0 && seen++ < MAX_NODES) {
      const node = open.pop()[1];
      if (node === goal) return this.legs(node, start, parent, via);
      const base = cost.get(node)!;
      this.moves(node, start, blocked, (next, step, link) => {
        const c = base + step;
        if (c >= (cost.get(next) ?? Infinity)) return;
        cost.set(next, c);
        parent.set(next, node);
        if (link) via.set(next, link);
        else via.delete(next);
        const p = fromKey(next);
        open.push([c + Math.max(Math.abs(p.x - to.x), Math.abs(p.y - to.y)) + Math.abs(p.z - to.z) * 6, next]);
      }, gold);
    }
    return null;
  }

  private legs(end: number, start: number, parent: Map<number, number>, via: Map<number, Link>): RouteStep[] {
    const nodes: number[] = [];
    for (let n = end; n !== start; n = parent.get(n)!) nodes.push(n);
    nodes.reverse();
    const steps: RouteStep[] = [];
    let since = 0;
    nodes.forEach((node, i) => {
      const link = via.get(node);
      if (link) {
        steps.push({ ...link.at, kind: link.kind, to: link.to, ...(link.word ? { word: link.word } : {}) });
        since = 0;
        return;
      }
      if (this.doors.has(node)) {
        steps.push({ ...fromKey(node), kind: 'door' });
        since = 0;
        return;
      }
      since++;
      if (since >= LEG || i === nodes.length - 1) {
        steps.push(fromKey(node));
        since = 0;
      }
    });
    return steps;
  }

  /** Everything a character standing at `from` can ever reach. */
  reachableFrom(from: Pos): TileSet {
    const start = tileKey(from.x, from.y, from.z);
    const seen = new TileSet();
    seen.add(start);
    const stack = [start];
    while (stack.length > 0) {
      this.moves(stack.pop()!, start, undefined, (next) => {
        if (seen.add(next)) stack.push(next);
      });
    }
    return seen;
  }

  /** Who can step straight to this tile: the moves of `moves`, read backwards. */
  private movesInto(node: number, visit: (from: number) => void): void {
    const { x, y, z } = fromKey(node);
    const stepsFrom = (px: number, py: number, pz: number, intoDoor: boolean) => {
      for (const [dx, dy] of NEIGHBOURS) {
        const nx = px + dx;
        const ny = py + dy;
        const key = tileKey(nx, ny, pz);
        const link = this.links.get(key);
        if (link && WALK_ON.has(link.kind)) continue; // standing there already means leaving
        const door = this.doors.has(key);
        if ((door || intoDoor) && dx !== 0 && dy !== 0) continue;
        if (door || this.walkable(nx, ny, pz)) visit(key);
      }
    };
    stepsFrom(x, y, z, this.doors.has(node));
    for (const link of this.linksInto.get(node) ?? []) {
      visit(tileKey(link.at.x, link.at.y, link.at.z));
      if (!WALK_ON.has(link.kind)) stepsFrom(link.at.x, link.at.y, link.at.z, false);
    }
  }

  /** Tiles from which `home` can be reached again: teleports are often one way, so a trip must not be. */
  returnableTo(home: Pos, reach: TileSet): TileSet {
    const start = tileKey(home.x, home.y, home.z);
    const seen = new TileSet();
    seen.add(start);
    const stack = [start];
    while (stack.length > 0) {
      this.movesInto(stack.pop()!, (from) => {
        if (reach.has(from) && seen.add(from)) stack.push(from);
      });
    }
    return seen;
  }
}

export function loadNav(dir: string, points: FloorPoint[]): NavGrid {
  const grid = new NavGrid();
  const file = join(dir, 'nav-map.jsonl');
  if (existsSync(file)) {
    for (const line of readFileSync(file, 'utf8').split('\n')) {
      if (!line) continue;
      const c = JSON.parse(line) as { x: number; y: number; z: number; rows: string[]; doors?: [number, number][] };
      grid.addChunk(c.x, c.y, c.z, c.rows, c.doors);
    }
  }
  grid.addFloorLinks(points);
  return grid;
}
