"""Scenes for testing agents in the real game, driven from outside (DOCS/TESTING.md).

The stand-in client (scripts/stand-in.ps1) plays a person. What it heard comes from its own client, so a
scene's result does not depend on what an agent wrote about itself. Force hooks are the test hooks of
the mind (runtime/players/<key>/force.json).

  python tools/scene.py where
  python tools/scene.py walk-agent luna            # the agent walks to the stand-in
  python tools/scene.py say "hej Luna" [--to Luna] [--wait 40]
  python tools/scene.py follow Luna
  python tools/scene.py heard [--since 600]
  python tools/scene.py away 40                    # the stand-in logs out properly and returns by itself
  python tools/scene.py age luna "Knight Sample" 8
  python tools/scene.py prank ravn Kael            # walks one agent to the other, then the joke
"""
import argparse
import json
import pathlib
import time

ROOT = pathlib.Path(__file__).resolve().parent.parent
PLAYERS = ROOT / 'runtime' / 'players'
STAND_IN = ROOT / 'runtime' / 'players-standin'
GOAL_ID = int(time.time()) % 1000000


def state(directory):
    try:
        return json.loads((directory / 'state.json').read_text(encoding='utf-8'))
    except (OSError, ValueError):
        return None


def orders():
    try:
        return json.loads((STAND_IN / 'orders.json').read_text(encoding='utf-8'))
    except (OSError, ValueError):
        return {'goal': {'type': 'idle', 'id': 0}, 'say': []}


def write_orders(value):
    path = STAND_IN / 'orders.json'
    path.with_suffix('.tmp').write_text(json.dumps(value), encoding='utf-8')
    path.with_suffix('.tmp').replace(path)


def heard(since_s):
    path = STAND_IN / 'events.jsonl'
    if not path.exists():
        return []
    border = time.time() * 1000 - since_s * 1000
    lines = []
    for raw in path.read_text(encoding='utf-8', errors='ignore').splitlines():
        try:
            event = json.loads(raw)
        except ValueError:
            continue
        if event.get('kind') == 'heard' and event.get('atMs', 0) >= border:
            lines.append(event)
    return lines


def print_heard(events):
    for e in events:
        at = time.strftime('%H:%M:%S', time.localtime(e['atMs'] / 1000))
        print(f"{at} {'[prywatnie] ' if e.get('private') else ''}{e.get('from')}: {e.get('text')}")


def force(key, wanted):
    (PLAYERS / key / 'force.json').write_text(json.dumps(wanted), encoding='utf-8')


def say(text, to, wait):
    now_ms = int(time.time() * 1000)
    current = orders()
    line = {'id': f'standin-{now_ms}', 'text': text, 'atMs': now_ms}
    if to:
        line['to'] = to
    current['say'] = (current.get('say') or [])[-5:] + [line]
    write_orders(current)
    started = time.time()
    seen = 0
    while time.time() - started < wait:
        time.sleep(2)
        events = [e for e in heard(wait + 5) if e['atMs'] >= now_ms and e.get('from') != 'Knight Sample']
        if len(events) > seen:
            print_heard(events[seen:])
            seen = len(events)
    if seen == 0:
        print('(cisza)')


def near(a, b, tiles):
    return a and b and a['z'] == b['z'] and max(abs(a['x'] - b['x']), abs(a['y'] - b['y'])) <= tiles


def wait_for(check, seconds):
    started = time.time()
    while time.time() - started < seconds:
        if check():
            return True
        time.sleep(3)
    return False


def main():
    parser = argparse.ArgumentParser()
    sub = parser.add_subparsers(dest='cmd', required=True)
    sub.add_parser('where')
    walk = sub.add_parser('walk-agent')
    walk.add_argument('key')
    talk = sub.add_parser('say')
    talk.add_argument('text')
    talk.add_argument('--to')
    talk.add_argument('--wait', type=int, default=30)
    follow = sub.add_parser('follow')
    follow.add_argument('name')
    away = sub.add_parser('away')
    away.add_argument('seconds', type=int)
    log = sub.add_parser('heard')
    log.add_argument('--since', type=int, default=600)
    age = sub.add_parser('age')
    age.add_argument('key')
    age.add_argument('name')
    age.add_argument('days', type=float)
    prank = sub.add_parser('prank')
    prank.add_argument('key')
    prank.add_argument('name')
    args = parser.parse_args()

    if args.cmd == 'where':
        s = state(STAND_IN)
        print('stand-in', s and (s['x'], s['y'], s['z'], s['hp'], [c['name'] for c in s['seen'] if c['kind'] == 'player']))
        for d in sorted(PLAYERS.iterdir()):
            a = state(d)
            if a:
                print(d.name, a['x'], a['y'], a['z'], f"hp {a['hp']}/{a['hpMax']}", 'lvl', a['level'], [c['name'] for c in a['seen'] if c['kind'] == 'player'])
    elif args.cmd == 'walk-agent':
        s = state(STAND_IN)
        force(args.key, {'route': {'x': s['x'] + 1, 'y': s['y'] + 1, 'z': s['z']}})
        ok = wait_for(lambda: near(state(PLAYERS / args.key), state(STAND_IN), 7), 300)
        print('blisko' if ok else 'nie dotarl')
    elif args.cmd == 'say':
        say(args.text, args.to, args.wait)
    elif args.cmd == 'follow':
        current = orders()
        current['goal'] = {'type': 'follow', 'id': GOAL_ID, 'name': args.name}
        write_orders(current)
        print('ide za', args.name)
    elif args.cmd == 'away':
        current = orders()
        current['rest'] = {'id': GOAL_ID, 'seconds': args.seconds}
        write_orders(current)
        print('wychodzi')
    elif args.cmd == 'heard':
        print_heard(heard(args.since))
    elif args.cmd == 'age':
        force(args.key, {'aged': {'name': args.name, 'days': args.days}})
        print('ok')
    elif args.cmd == 'prank':
        other = next(d for d in PLAYERS.iterdir() if (state(d) or {}).get('name') == args.name)
        target = state(other)
        force(args.key, {'route': {'x': target['x'], 'y': target['y'], 'z': target['z']}})
        ok = wait_for(lambda: near(state(PLAYERS / args.key), state(other), 5), 240)
        if not ok:
            print('nie dotarl')
            return
        force(args.key, {'prank': args.name})
        print('zart')


if __name__ == '__main__':
    main()
