// A look at the world without starting it, from the atlas and the datapack's spawn files.
//   node --disable-warning=ExperimentalWarning apps/brain/src/cli/world.ts near 32369,32241,7 [radius]
//   node --disable-warning=ExperimentalWarning apps/brain/src/cli/world.ts check
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gap, loadNav, tileKey } from '../players/nav.ts';
import { loadWorldFacts } from '../players/knowledge.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
const atlasDir = join(root, 'runtime', 'atlas');
if (!existsSync(join(atlasDir, 'atlas.json'))) {
  console.error('No atlas: run scripts\\player-agents.ps1 -Start once');
  process.exit(2);
}
const facts = loadWorldFacts(join(root, 'packages', 'contracts', 'game-data.json'), join(atlasDir, 'atlas.json'), join(root, 'packages', 'contracts', 'hunting-grounds.json'));
const nav = loadNav(atlasDir, facts.points);
const agents = JSON.parse(readFileSync(join(root, 'packages', 'contracts', 'agents.json'), 'utf8')) as { agents: Record<string, { npcName: string; waypoints: Record<string, { x: number; y: number; z: number }> }> };

function spawnFile(name: string): string {
  const source = join(root, 'vendor', 'canary-src');
  const dir = readdirSync(source).find((d) => d.startsWith('canary-'));
  return readFileSync(join(source, dir!, 'data-otservbr-global', 'world', name), 'utf8');
}

function datapackNpcs(): { name: string; x: number; y: number; z: number }[] {
  const found = [];
  for (const m of spawnFile('otservbr-npc.xml').matchAll(/<npc centerx="(\d+)" centery="(\d+)" centerz="(\d+)"[^>]*>\s*<npc name="([^"]+)" x="(-?\d+)" y="(-?\d+)"/g)) {
    found.push({ name: m[4], x: Number(m[1]) + Number(m[5]), y: Number(m[2]) + Number(m[6]), z: Number(m[3]) });
  }
  return found;
}

function near(at: { x: number; y: number; z: number }, radius: number): void {
  const close = <T extends { x: number; y: number; z: number }>(list: T[]) => list.filter((p) => p.z === at.z && gap(p, at) <= radius);
  console.log(`Pole ${at.x},${at.y},${at.z}: ${nav.walkable(at.x, at.y, at.z) ? 'przechodnie' : 'nieprzechodnie'}`);
  const town = [...facts.towns].sort((a, b) => gap(a.temple, at) - gap(b.temple, at))[0];
  console.log(`Najblizsze miasto: ${town?.name} (${town ? gap(town.temple, at) : '?'} pol)`);
  const ours = Object.values(agents.agents).flatMap((a) => Object.entries(a.waypoints).map(([id, p]) => ({ name: `${a.npcName}/${id}`, ...p })));
  for (const [title, list] of [['Nasi NPC', close(ours)], ['NPC z datapacku', close(datapackNpcs())], ['Przejscia', close(facts.points.map((p) => ({ name: `${p.kind} ${p.dir}`, x: p.x, y: p.y, z: p.z })))], ['Lowiska', close((facts.grounds ?? []).map((g) => ({ name: `${g.name}: ${g.monsters.join(', ')}`, x: g.x, y: g.y, z: g.z })))]] as const) {
    console.log(`${title}: ${list.length}`);
    for (const p of list.slice(0, 12)) console.log(`  ${p.name}  ${p.x},${p.y},${p.z}  (${gap(p, at)} pol)`);
  }
}

function check(): void {
  const temple = facts.towns.find((t) => t.name === 'Thais')!.temple;
  const reach = nav.returnableTo(temple, nav.reachableFrom(temple));
  let bad = 0;
  for (const a of Object.values(agents.agents)) {
    for (const [id, p] of Object.entries(a.waypoints)) {
      const side = [[0, 0], [0, 1], [1, 0], [-1, 0], [0, -1]].some(([dx, dy]) => reach.has(tileKey(p.x + dx, p.y + dy, p.z)));
      if (!side) bad++;
      console.log(`${side ? 'OK  ' : 'BRAK'} ${a.npcName}/${id} ${p.x},${p.y},${p.z}`);
    }
  }
  console.log(bad === 0 ? 'Wszystkie punkty NPC osiagalne z Thais' : `${bad} punktow bez drogi z Thais`);
  process.exitCode = bad === 0 ? 0 : 1;
}

const [command, where, radius] = process.argv.slice(2);
if (command === 'near' && where) {
  const [x, y, z] = where.split(',').map(Number);
  near({ x, y, z }, Number(radius ?? 20));
} else if (command === 'check') check();
else {
  console.error('near x,y,z [radius] | check');
  process.exitCode = 2;
}
