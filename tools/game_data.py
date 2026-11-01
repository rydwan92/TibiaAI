"""Game knowledge for agents, read from this server's own datapack, not from guides.

Monsters come from the running datapack (the only ones this world can spawn); spells, runes and tools from
data/. Output: packages/contracts/game-data.json, shared by Brain and the player adapter.
Usage: python -I tools/game_data.py <canary source dir> <out.json>
"""
import glob
import json
import os
import re
import sys

DATAPACK = 'data-otservbr-global'

VOCATIONS = {'sorcerer': 'sorcerer', 'druid': 'druid', 'paladin': 'paladin', 'knight': 'knight', 'monk': 'monk'}


def field(text, name, default=None, cast=int):
    m = re.search(rf'{name}\s*=\s*"?(-?[\w .\']+)"?', text)
    if not m:
        return default
    try:
        return cast(m.group(1))
    except ValueError:
        return default


def monsters(root):
    out = {}
    for path in sorted(glob.glob(os.path.join(root, DATAPACK, 'monster', '**', '*.lua'), recursive=True)):
        text = open(path, encoding='utf-8', errors='ignore').read()
        name = re.search(r'createMonsterType\("([^"]+)"\)', text)
        if not name:
            continue
        attacks = re.search(r'monster\.attacks\s*=\s*\{(.*?)\n\}', text, re.S)
        kinds, peak = set(), 0
        for row in re.findall(r'\{[^{}]*name\s*=\s*"([^"]+)"[^{}]*\}', attacks.group(1) if attacks else ''):
            kinds.add(row)
        for low in re.findall(r'minDamage\s*=\s*(-?\d+)', attacks.group(1) if attacks else ''):
            peak = max(peak, abs(int(low)))
        for high in re.findall(r'maxDamage\s*=\s*(-?\d+)', attacks.group(1) if attacks else ''):
            peak = max(peak, abs(int(high)))
        weak, strong = [], []
        elements = re.search(r'monster\.elements\s*=\s*\{(.*?)\n\}', text, re.S)
        for kind, percent in re.findall(r'type\s*=\s*COMBAT_(\w+?)DAMAGE,\s*percent\s*=\s*(-?\d+)', elements.group(1) if elements else ''):
            value = int(percent)
            (strong if value > 0 else weak if value < 0 else []).append(kind.lower())
        immune = re.findall(r'type\s*=\s*"(\w+)",\s*condition\s*=\s*\w+,\s*combat\s*=\s*true', text)
        loot = re.search(r'monster\.loot\s*=\s*\{(.*?)\n\}', text, re.S)
        items = re.findall(r'name\s*=\s*"([^"]+)"', loot.group(1) if loot else '')
        out[name.group(1)] = {
            'health': field(text, r'monster\.health', 0),
            'experience': field(text, r'monster\.experience', 0),
            'speed': field(text, r'monster\.speed', 0),
            'runHealth': field(text, r'runHealth', 0),
            'peakDamage': peak,
            'attacks': sorted(kinds),
            'weakTo': weak,
            'resists': strong,
            'immuneTo': immune,
            'loot': items[:8],
            'hostile': 'hostile = false' not in text,
            'family': os.path.basename(os.path.dirname(path)),
        }
    return out


def vocations_of(text):
    return sorted({v for k, v in VOCATIONS.items() if re.search(rf'vocation\("[^)]*{k}', text, re.I) or re.search(rf'"{k}', text, re.I)})


def spells(root):
    out = {}
    for path in sorted(glob.glob(os.path.join(root, 'data', 'scripts', 'spells', '**', '*.lua'), recursive=True)):
        text = open(path, encoding='utf-8', errors='ignore').read()
        name = re.search(r'spell:name\("([^"]+)"\)', text)
        words = re.search(r'spell:words\("([^"]+)"\)', text)
        if not name or not words:
            continue
        out[name.group(1)] = {
            'words': words.group(1),
            'group': os.path.basename(os.path.dirname(path)),
            'level': int((re.search(r'spell:level\((\d+)\)', text) or [0, 0])[1]),
            'mana': int((re.search(r'spell:mana\((\d+)\)', text) or [0, 0])[1]),
            'premium': bool(re.search(r'spell:isPremium\(true\)', text)),
            'vocations': sorted({v for k, v in VOCATIONS.items() if re.search(rf'spell:vocation\([^)]*{k}', text, re.I)}),
            'needsTarget': bool(re.search(r'spell:needTarget\(true\)', text)),
        }
    return out


def runes(root):
    out = {}
    for path in sorted(glob.glob(os.path.join(root, 'data', 'scripts', 'runes', '*.lua'))):
        text = open(path, encoding='utf-8', errors='ignore').read()
        name = re.search(r'(?:rune|spell):name\("([^"]+)"\)', text)
        rune_id = re.search(r'(?:rune|spell):runeId\((\d+)\)', text)
        if not name or not rune_id:
            continue
        out[name.group(1)] = {
            'id': int(rune_id.group(1)),
            'level': int((re.search(r':level\((\d+)\)', text) or [0, 0])[1]),
            'magicLevel': int((re.search(r':magicLevel\((\d+)\)', text) or [0, 0])[1]),
            'needsTarget': bool(re.search(r':needTarget\(true\)', text)),
            'group': (re.search(r':group\("(\w+)"\)', text) or [0, ''])[1],
            'vocations': sorted({v for k, v in VOCATIONS.items() if re.search(rf':vocation\([^)]*{k}', text, re.I)}),
        }
    return out


def id_table(root, name):
    """Numbers of a global Lua table such as ropeSpots or holes."""
    for path in glob.glob(os.path.join(root, 'data*', '**', '*.lua'), recursive=True):
        text = open(path, encoding='utf-8', errors='ignore').read()
        m = re.search(rf'^(?:local\s+)?{name}\s*=\s*\{{(.*?)\}}', text, re.M | re.S)
        if m:
            return sorted(set(int(x) for x in re.findall(r'\d+', m.group(1))))
    return []


def main(root, out_path):
    data = {
        '_comment': 'Generated by tools/game_data.py from the pinned Canary datapack. Do not edit; regenerate.',
        'source': os.path.basename(root.rstrip('/\\')),
        'monsters': monsters(root),
        'spells': spells(root),
        'runes': runes(root),
        'tools': {'rope': 3003, 'shovel': 3457, 'pick': 3456, 'machete': 3308},
        'ropeSpots': id_table(root, 'ropeSpots'),
        'shovelHoles': id_table(root, 'holes'),
    }
    with open(out_path, 'w', encoding='utf-8', newline='\n') as f:
        json.dump(data, f, ensure_ascii=False, indent=0, sort_keys=True)
    print({k: len(v) for k, v in data.items() if isinstance(v, (dict, list))})


if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2])
