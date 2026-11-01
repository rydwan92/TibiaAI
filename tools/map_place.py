"""New places on the map without touching the map: small OTBM files for Canary's world/custom folder.

The original map stays as it is. Each place is a JSON file in game/world/places; a tile written here
replaces that tile of the world when the server loads, and removing the file brings the old tile back.

  python -I tools/map_place.py peek <map.otbm> x y z radius       # what stands on the map around a point
  python -I tools/map_place.py build <places-dir> <out-dir> <items.xml>
  python -I tools/map_place.py read <file.otbm>                   # what a built file holds

Spec: { "name", "area": {"x","y","z","w","h"}, "floor": id, "tiles": [{"x","y","floor"?, "items": [{"id","text"?}]}],
"blocks": [ids that cannot be walked through] }. Coordinates in tiles are relative to the area.
"""
import json
import pathlib
import re
import struct
import sys

NODE_START, NODE_END, ESCAPE = 0xFE, 0xFF, 0xFD
OTBM_ROOT, OTBM_MAP_DATA, OTBM_TILE_AREA, OTBM_TILE, OTBM_ITEM, OTBM_TOWNS, OTBM_WAYPOINTS = 0, 2, 4, 5, 6, 12, 15
ATTR_DESCRIPTION, ATTR_TEXT, ATTR_ITEM = 1, 6, 9
HEADER_VERSION, ITEMS_MAJOR, ITEMS_MINOR = 4, 4, 4
MAP_WIDTH, MAP_HEIGHT = 35143, 34812  # as in otservbr.otbm: the last file loaded sets the size of the map
AREA_SIZE = 256
MAX_TILES = 2500  # a place, not a continent
MAX_TEXT = 200


def escaped(raw):
    out = bytearray()
    for b in raw:
        if b in (NODE_START, NODE_END, ESCAPE):
            out.append(ESCAPE)
        out.append(b)
    return bytes(out)


def node(node_type, props=b'', children=()):
    return bytes([NODE_START, node_type]) + escaped(props) + b''.join(children) + bytes([NODE_END])


def text_attr(attr, value):
    raw = value.encode('latin-1')
    return bytes([attr]) + struct.pack('<H', len(raw)) + raw


def item_node(item):
    props = struct.pack('<H', item['id'])
    if item.get('text'):
        if len(item['text']) > MAX_TEXT:
            raise ValueError(f"text longer than {MAX_TEXT}")
        props += text_attr(ATTR_TEXT, item['text'])
    return node(OTBM_ITEM, props)


def tile_node(x, y, floor, items):
    props = bytes([x % AREA_SIZE, y % AREA_SIZE, ATTR_ITEM]) + struct.pack('<H', floor)
    return node(OTBM_TILE, props, [item_node(i) for i in items])


def tiles_of(spec):
    """Every tile of a place, in absolute coordinates: the floor, with what stands on it."""
    area = spec['area']
    extra = {(t['x'], t['y']): t for t in spec.get('tiles', [])}
    for key in extra:
        if not (0 <= key[0] < area['w'] and 0 <= key[1] < area['h']):
            raise ValueError(f"{spec['name']}: tile {key} outside the area")
    if area['w'] * area['h'] > MAX_TILES:
        raise ValueError(f"{spec['name']}: too big")
    for dy in range(area['h']):
        for dx in range(area['w']):
            t = extra.get((dx, dy), {})
            yield area['x'] + dx, area['y'] + dy, area['z'], t.get('floor', spec['floor']), t.get('items', [])


def encode(spec):
    groups = {}
    for x, y, z, floor, items in tiles_of(spec):
        groups.setdefault((x // AREA_SIZE, y // AREA_SIZE, z), []).append(tile_node(x, y, floor, items))
    areas = [node(OTBM_TILE_AREA, struct.pack('<HHB', ax * AREA_SIZE, ay * AREA_SIZE, z), tiles) for (ax, ay, z), tiles in sorted(groups.items())]
    data = node(OTBM_MAP_DATA, text_attr(ATTR_DESCRIPTION, spec['name']), [*areas, node(OTBM_TOWNS), node(OTBM_WAYPOINTS)])
    header = struct.pack('<IHHII', HEADER_VERSION, MAP_WIDTH, MAP_HEIGHT, ITEMS_MAJOR, ITEMS_MINOR)
    return b'\0\0\0\0' + node(OTBM_ROOT, header, [data])


def walk(data):
    """Yields (type, props, depth) for every node when it closes; props stop at the first child."""
    stack = []
    i = 4
    while i < len(data):
        b = data[i]
        if b == NODE_START:
            if stack:
                stack[-1][2] = True
            stack.append([data[i + 1], bytearray(), False])
            i += 2
        elif b == NODE_END:
            node_type, props, _ = stack.pop()
            yield node_type, bytes(props), len(stack)
            i += 1
        else:
            if b == ESCAPE:
                i += 1
                b = data[i]
            if stack and not stack[-1][2]:
                stack[-1][1].append(b)
            i += 1


def read_tiles(data, window=None):
    """(x, y, z) -> list of item ids, ground first. A window (x0, y0, x1, y1, z) keeps a whole map in memory bounds."""
    tiles = {}
    stack = []
    base = None
    i = 4
    while i < len(data):
        b = data[i]
        if b == NODE_START:
            if stack:
                stack[-1][1] = True
                finish(stack[-1], tiles, stack, base, window)
                if stack[-1][0] == OTBM_TILE_AREA and stack[-1][3] is not None:
                    base = stack[-1][3]
            stack.append([data[i + 1], False, bytearray(), None])
            i += 2
        elif b == NODE_END:
            top = stack[-1]
            if not top[1]:
                finish(top, tiles, stack, base, window)
                if top[0] == OTBM_TILE_AREA and top[3] is not None:
                    base = top[3]
            stack.pop()
            i += 1
        else:
            if b == ESCAPE:
                i += 1
                b = data[i]
            if stack and not stack[-1][1]:
                stack[-1][2].append(b)
            i += 1
    return tiles


def finish(entry, tiles, stack, base, window=None):
    if entry[3] is not None:
        return
    node_type, _, props, _ = entry
    if node_type == OTBM_TILE_AREA:
        entry[3] = struct.unpack_from('<HHB', props, 0)
    elif node_type == OTBM_TILE and base and len(props) >= 2:
        key = (base[0] + props[0], base[1] + props[1], base[2])
        entry[3] = key
        if window and not (window[0] <= key[0] <= window[2] and window[1] <= key[1] <= window[3] and key[2] == window[4]):
            return
        ids = tiles.setdefault(key, [])
        if len(props) >= 5 and props[2] == ATTR_ITEM:
            ids.append(struct.unpack_from('<H', props, 3)[0])
    elif node_type == OTBM_ITEM and len(props) >= 2 and len(stack) >= 2:
        entry[3] = True
        owner = stack[-2][3]
        if owner in tiles:
            tiles[owner].append(struct.unpack_from('<H', props, 0)[0])


def known_items(items_xml):
    known = set()
    for m in re.finditer(r'<item\s+(?:id="(\d+)"|fromid="(\d+)"\s+toid="(\d+)")', pathlib.Path(items_xml).read_text(encoding='utf-8', errors='ignore')):
        if m.group(1):
            known.add(int(m.group(1)))
        else:
            known.update(range(int(m.group(2)), int(m.group(3)) + 1))
    return known


def build(places_dir, out_dir, items_xml):
    known = known_items(items_xml)
    out = pathlib.Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)
    for old in out.glob('stevium-*.otbm'):
        old.unlink()
    taken = {}
    blocked = []
    for path in sorted(pathlib.Path(places_dir).glob('*.json')):
        spec = json.loads(path.read_text(encoding='utf-8'))
        stops = set(spec.get('blocks', []))
        for x, y, z, floor, items in tiles_of(spec):
            for item_id in [floor] + [i['id'] for i in items]:
                if item_id not in known:
                    raise ValueError(f'{path.name}: unknown item {item_id}')
            if (x, y, z) in taken:
                raise ValueError(f'{path.name}: tile {x},{y},{z} already used by {taken[(x, y, z)]}')
            taken[(x, y, z)] = path.name
            if any(i['id'] in stops for i in items):
                blocked.append({'x': x, 'y': y, 'z': z})
        (out / f'stevium-{path.stem}.otbm').write_bytes(encode(spec))
        print(f"{spec['name']}: {spec['area']['w'] * spec['area']['h']} pol")
    return blocked


def peek(map_path, x, y, z, radius):
    tiles = read_tiles(pathlib.Path(map_path).read_bytes(), (x - radius, y - radius, x + radius, y + radius, z))
    for yy in range(y - radius, y + radius + 1):
        print(yy, ' '.join('/'.join(map(str, tiles.get((xx, yy, z), ['-']))) for xx in range(x - radius, x + radius + 1)))


def main():
    command = sys.argv[1]
    if command == 'peek':
        peek(sys.argv[2], *map(int, sys.argv[3:7]))
    elif command == 'build':
        blocked = build(sys.argv[2], sys.argv[3], sys.argv[4])
        pathlib.Path(sys.argv[3], 'stevium-blocked.json').write_text(json.dumps(blocked), encoding='utf-8')
    elif command == 'read':
        tiles = read_tiles(pathlib.Path(sys.argv[2]).read_bytes())
        print(len(tiles), 'pol')
        for key in sorted(tiles)[:12]:
            print(key, tiles[key])


if __name__ == '__main__':
    main()
