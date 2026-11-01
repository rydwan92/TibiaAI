"""Facts about a map for agents: floors, towns and every way between places.

Reads an OTBM file, items.xml and appearances.dat. A floor change is an item the data marks with
`floorchange` (stairs, ladders, ramps) or by name (rope spots, holes, sewer grates); a teleport
carries its destination in the map. Walkability comes from the `unpass` flag the engine itself
reads from appearances (Items::loadFromProtobuf), so a world of 18 million tiles is mapped without
making the engine build them all in memory. Writes nav-map.jsonl next to <out>: one line per 16x16
chunk with a hex bitmask of walkable tiles and the closed doors a player can open.
Usage: python -I tools/world_atlas.py <map.otbm> <items.xml> <appearances.dat> <out.json> [game-data.json]
"""
import json
import os
import re
import struct
import sys
from collections import Counter

NODE_START, NODE_END, ESCAPE = 0xFE, 0xFF, 0xFD
OTBM_TILE_AREA, OTBM_TILE, OTBM_ITEM, OTBM_TOWN, OTBM_HOUSETILE = 4, 5, 6, 13, 14
ATTR_ITEM = 9
ATTR_TELE_DEST = 8
ATTR_ACTION_ID = 4
ATTR_UNIQUE_ID = 5
ATTR_HOUSE_DOOR = 14
APPEARANCE_OBJECT = 1
FLAG_UNPASS = 13
WALK, DOOR, BLOCKED = 1, 2, 3
ATTR_SIZES = {1: None, 2: None, 4: 2, 5: 2, 6: 2, 7: None, 10: 2, 14: 1, 15: 1, 16: 4, 17: 4, 18: None, 19: None, 22: 2, 23: 1}
CHUNK = 16


def floor_items(path):
    """item id -> how it moves a player between floors."""
    found = {}
    text = open(path, encoding='utf-8', errors='ignore').read()
    for m in re.finditer(r'<item\s+(?:id|fromid)="(\d+)"(?:\s+toid="(\d+)")?([^>]*?)(/>|>(.*?)</item>)', text, re.S):
        first, last, head, _, body = m.groups()
        name = (re.search(r'name="([^"]*)"', head) or [None, ''])[1].lower()
        change = re.search(r'key="floorchange"\s+value="([^"]+)"', body or '')
        kind = None
        if change:
            kind = 'ladder' if 'ladder' in name else 'hole' if 'hole' in name or 'pitfall' in name or 'trapdoor' in name else 'stairs'
        elif 'ladder' in name:
            kind = 'ladder'
        elif name == 'rope spot' or 'rope spot' in name:
            kind = 'rope_spot'
        elif name in ('sewer grate', 'sewer'):
            kind = 'sewer'
        if kind:
            direction = 'down' if (change and change.group(1) == 'down') or kind in ('hole', 'sewer') else 'up'
            for item_id in range(int(first), int(last or first) + 1):
                found[item_id] = (kind, direction)
    return found


def typed_ids(path, kind):
    text = open(path, encoding='utf-8', errors='ignore').read()
    found = set()
    for m in re.finditer(r'<item\s+(?:id|fromid)="(\d+)"(?:\s+toid="(\d+)")?[^>]*?>(.*?)</item>', text, re.S):
        if re.search(rf'key="type"\s+value="{kind}"', m.group(3)):
            found.update(range(int(m.group(1)), int(m.group(2) or m.group(1)) + 1))
    return found


def teleport_destination(props):
    """Walks an item's attributes up to its destination; None when an attribute is unknown."""
    i = 2
    while i < len(props):
        attr = props[i]
        if attr == ATTR_TELE_DEST and i + 5 < len(props) + 1:
            x, y, z = struct.unpack_from('<HHB', props, i + 1)
            return {'x': x, 'y': y, 'z': z}
        if attr not in ATTR_SIZES:
            return None
        size = ATTR_SIZES[attr]
        if size is None:
            size = 2 + struct.unpack_from('<H', props, i + 1)[0]
        i += 1 + size
    return None


def varint(data, i):
    value, shift = 0, 0
    while True:
        b = data[i]
        i += 1
        value |= (b & 0x7F) << shift
        if b < 0x80:
            return value, i
        shift += 7


def fields(data):
    """Protobuf fields of a message: (number, value), length-delimited values as bytes."""
    i = 0
    while i < len(data):
        tag, i = varint(data, i)
        number, wire = tag >> 3, tag & 7
        if wire == 0:
            value, i = varint(data, i)
        elif wire == 2:
            size, i = varint(data, i)
            value = data[i:i + size]
            i += size
        elif wire == 5:
            value = data[i:i + 4]
            i += 4
        elif wire == 1:
            value = data[i:i + 8]
            i += 8
        else:
            raise ValueError(f'wire type {wire}')
        yield number, value


def blocking_ids(path):
    """Item ids that stop a creature: Appearance.flags.unpass, as Items::loadFromProtobuf reads it."""
    blocked = set()
    for number, item in fields(open(path, 'rb').read()):
        if number != APPEARANCE_OBJECT:
            continue
        item_id, flags = 0, b''
        for field, value in fields(item):
            if field == 1:
                item_id = value
            elif field == 3:
                flags = value
        if any(field == FLAG_UNPASS and value for field, value in fields(flags)):
            blocked.add(item_id)
    return blocked


def closed_door_ids(path, blocking):
    """Doors that block and are not marked as locked in the editor."""
    text = open(path, encoding='utf-8', errors='ignore').read()
    found = set()
    for m in re.finditer(r'<item\s+(?:id|fromid)="(\d+)"(?:\s+toid="(\d+)")?([^>]*?)>(.*?)</item>', text, re.S):
        if 'locked' not in m.group(3) and re.search(r'key="type"\s+value="door"', m.group(4)):
            found.update(i for i in range(int(m.group(1)), int(m.group(2) or m.group(1)) + 1) if i in blocking)
    return found


def guarded(props):
    """A door with a script behind it or a house's door: not for anyone passing by."""
    i = 2
    while i < len(props):
        attr = props[i]
        if attr == ATTR_HOUSE_DOOR:
            return True
        if attr in (ATTR_ACTION_ID, ATTR_UNIQUE_ID) and i + 2 < len(props) and struct.unpack_from('<H', props, i + 1)[0] != 0:
            return True
        if attr not in ATTR_SIZES:
            return False
        size = ATTR_SIZES[attr]
        if size is None:
            size = 2 + struct.unpack_from('<H', props, i + 1)[0]
        i += 1 + size
    return False


def mark(nav, x, y, z, value):
    """Keeps the strongest fact about a tile: blocked beats door, door beats walkable."""
    cx, cy = x - x % CHUNK, y - y % CHUNK
    cell = nav.setdefault((cx, cy, z), bytearray(CHUNK * CHUNK))
    index = (y - cy) * CHUNK + x - cx
    cell[index] = max(cell[index], value)


def write_nav(nav, path):
    with open(path, 'w', encoding='utf-8', newline='\n') as f:
        for (cx, cy, z), cell in nav.items():
            rows, doors = [], []
            for r in range(CHUNK):
                hexa = ''
                for c in range(0, CHUNK, 4):
                    nibble = 0
                    for bit in range(4):
                        value = cell[r * CHUNK + c + bit]
                        if value == WALK:
                            nibble |= 8 >> bit
                        elif value == DOOR:
                            doors.append([cx + c + bit, cy + r])
                    hexa += format(nibble, 'x')
                rows.append(hexa)
            if any(row != '0000' for row in rows) or doors:
                line = {'x': cx, 'y': cy, 'z': z, 'rows': rows}
                if doors:
                    line['doors'] = doors
                f.write(json.dumps(line, separators=(',', ':')) + '\n')


def tile_items(props, offset):
    """Ground item id stored as an attribute on the tile."""
    ids = []
    i = offset
    while i < len(props):
        attr = props[i]
        if attr == ATTR_ITEM and i + 2 < len(props):
            ids.append(struct.unpack_from('<H', props, i + 1)[0])
            i += 3
        elif attr == 3:  # tile flags
            i += 5
        else:
            break
    return ids


def main(map_path, items_path, appearances_path, out_path, game_data_path=None):
    changes = floor_items(items_path)
    if game_data_path:
        game = json.load(open(game_data_path, encoding='utf-8'))
        changes.update({item_id: ('rope_spot', 'up') for item_id in game['ropeSpots']})
        changes.update({item_id: ('shovel_hole', 'down') for item_id in game['shovelHoles']})
    data = open(map_path, 'rb').read()
    tiles_per_floor = Counter()
    bounds = [10 ** 6, 10 ** 6, 0, 0]
    points = []
    towns = []
    gates = typed_ids(items_path, 'teleport')
    changes.update({item_id: ('locker', 'up') for item_id in typed_ids(items_path, 'depot')})
    nav = {}
    blocking = blocking_ids(appearances_path)
    doors = closed_door_ids(items_path, blocking)
    print({'blockingItems': len(blocking), 'doorItems': len(doors)})
    scan(data, changes, tiles_per_floor, bounds, points, towns, gates, (nav, blocking, doors))
    write_nav(nav, os.path.join(os.path.dirname(out_path), 'nav-map.jsonl'))
    summary = {
        'source': map_path.replace(chr(92), '/').split('/')[-1],
        'towns': towns,
        'bounds': {'minX': bounds[0], 'minY': bounds[1], 'maxX': bounds[2], 'maxY': bounds[3]},
        'tilesPerFloor': {str(k): v for k, v in sorted(tiles_per_floor.items())},
        'floorChanges': Counter(p['kind'] for p in points if p['kind'] != 'locker'),
        'points': [p for p in points if p['kind'] != 'locker'],
        'lockers': [{'x': p['x'], 'y': p['y'], 'z': p['z']} for p in points if p['kind'] == 'locker'],
    }
    with open(out_path, 'w', encoding='utf-8') as f:
        json.dump(summary, f, separators=(',', ':'))
    print(json.dumps({k: v for k, v in summary.items() if k not in ('points', 'lockers')}, indent=1))
    print({'chunks': len(nav)})


def scan(data, changes, tiles_per_floor, bounds, points, towns, gates, walk):
    """Explicit parser: a node's own bytes end at its first child."""
    i = 4
    stack = []  # [type, props, closed_props, base]
    while i < len(data):
        b = data[i]
        if b == NODE_START:
            if stack and not stack[-1][2]:
                stack[-1][2] = True
                on_props(stack, changes, tiles_per_floor, bounds, points, towns, gates, walk)
            stack.append([data[i + 1], bytearray(), False, None])
            i += 2
        elif b == NODE_END:
            if not stack[-1][2]:
                stack[-1][2] = True
                on_props(stack, changes, tiles_per_floor, bounds, points, towns, gates, walk)
            stack.pop()
            i += 1
        else:
            if b == ESCAPE:
                i += 1
                b = data[i]
            if not stack[-1][2]:
                stack[-1][1].append(b)
            i += 1


def on_props(stack, changes, tiles_per_floor, bounds, points, towns, gates, walk):
    nav, blocking, doors = walk
    node = stack[-1]
    node_type, props = node[0], node[1]
    if node_type == OTBM_TOWN and len(props) > 6:
        size = struct.unpack_from('<H', props, 4)[0]
        x, y, z = struct.unpack_from('<HHB', props, 6 + size)
        towns.append({'id': struct.unpack_from('<I', props)[0], 'name': props[6:6 + size].decode('latin-1'), 'temple': {'x': x, 'y': y, 'z': z}})
    elif node_type == OTBM_TILE_AREA and len(props) >= 5:
        node[3] = struct.unpack_from('<HHB', props)
    elif node_type in (OTBM_TILE, OTBM_HOUSETILE):
        base = stack[-2][3]
        if base is None or len(props) < 2:
            return
        x, y, z = base[0] + props[0], base[1] + props[1], base[2]
        node[3] = (x, y, z)
        tiles_per_floor[z] += 1
        bounds[0], bounds[1] = min(bounds[0], x), min(bounds[1], y)
        bounds[2], bounds[3] = max(bounds[2], x), max(bounds[3], y)
        offset = 2 + (4 if node_type == OTBM_HOUSETILE else 0)
        for item_id in tile_items(props, offset):
            mark(nav, x, y, z, BLOCKED if item_id in blocking else WALK)
            if item_id in changes:
                points.append({'x': x, 'y': y, 'z': z, 'kind': changes[item_id][0], 'dir': changes[item_id][1], 'item': item_id})
    elif node_type == OTBM_ITEM and len(stack) >= 2 and len(props) >= 2:
        where = stack[-2][3]
        item_id = struct.unpack_from('<H', props)[0]
        if where and isinstance(where, tuple) and len(where) == 3 and stack[-2][0] in (OTBM_TILE, OTBM_HOUSETILE):
            value = WALK
            if item_id in doors and stack[-2][0] == OTBM_TILE and not guarded(props):
                value = DOOR
            elif item_id in blocking:
                value = BLOCKED
            mark(nav, where[0], where[1], where[2], value)
        if where and item_id in gates and isinstance(where, tuple) and len(where) == 3:
            to = teleport_destination(props)
            if to and to['x'] > 0:
                points.append({'x': where[0], 'y': where[1], 'z': where[2], 'kind': 'teleport', 'dir': 'up', 'item': item_id, 'to': to})
        if where and isinstance(where, tuple) and len(where) == 3 and item_id in changes and stack[-2][0] in (OTBM_TILE, OTBM_HOUSETILE):
            points.append({'x': where[0], 'y': where[1], 'z': where[2], 'kind': changes[item_id][0], 'dir': changes[item_id][1], 'item': item_id})


if __name__ == '__main__':
    main(*sys.argv[1:6])
