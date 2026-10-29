"""List towns (id, name, temple position) from an OTBM map file.

Minimal OTBM reader: walks the node tree (0xFE start, 0xFF end, 0xFD escape) and decodes
only OTBM_TOWN nodes. Used to pick verified coordinates; it does not judge walkability.
Usage: python -I tools/otbm_towns.py <map.otbm>
"""
import struct
import sys

NODE_START, NODE_END, ESCAPE = 0xFE, 0xFF, 0xFD
OTBM_TOWN = 13


def iter_nodes(data):
    """Yield (type, props_bytes) for every node; props are unescaped bytes before first child."""
    stack = []
    i = 4  # skip file identifier
    while i < len(data):
        b = data[i]
        if b == NODE_START:
            if stack:
                stack[-1][2] = True  # parent now has children; stop collecting its props
            node_type = data[i + 1]
            stack.append([node_type, bytearray(), False])
            i += 2
        elif b == NODE_END:
            node_type, props, _ = stack.pop()
            yield node_type, bytes(props)
            i += 1
        else:
            if b == ESCAPE:
                i += 1
                b = data[i]
            if stack and not stack[-1][2]:
                stack[-1][1].append(b)
            i += 1


def main(path):
    with open(path, 'rb') as f:
        data = f.read()
    for node_type, props in iter_nodes(data):
        if node_type != OTBM_TOWN:
            continue
        town_id, = struct.unpack_from('<I', props, 0)
        name_len, = struct.unpack_from('<H', props, 4)
        name = props[6:6 + name_len].decode('latin-1')
        x, y, z = struct.unpack_from('<HHB', props, 6 + name_len)
        print(f'{town_id}\t{name}\t{x},{y},{z}')


if __name__ == '__main__':
    main(sys.argv[1])
