"""Print the world journal (runtime/logs/world-journal.jsonl) compactly, for one world session.

Usage: python -I tools/journal.py [--session ID|current] [--kinds a,b] [--tail N]
'current' reads the session id from runtime/mailbox/world.json.
"""
import argparse
import json
import pathlib

ROOT = pathlib.Path(__file__).resolve().parent.parent


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--session', default='current')
    ap.add_argument('--kinds', default='')
    ap.add_argument('--tail', type=int, default=0)
    args = ap.parse_args()
    session = args.session
    if session == 'current':
        session = json.loads((ROOT / 'runtime/mailbox/world.json').read_text())['worldSessionId']
    kinds = set(filter(None, args.kinds.split(',')))
    rows = []
    for line in (ROOT / 'runtime/logs/world-journal.jsonl').read_text(encoding='utf-8', errors='replace').splitlines():
        d = json.loads(line)
        if d.get('worldSessionId') != session or (kinds and d['kind'] not in kinds):
            continue
        rest = {k: v for k, v in d.items() if k not in ('ts', 'worldSessionId', 'kind', 'agentKey')}
        rows.append(f"{d['ts'][11:19]} {d['kind']:<24} {json.dumps(rest, ensure_ascii=False)}")
    print(f'session {session}')
    print('\n'.join(rows[-args.tail:] if args.tail else rows))


if __name__ == '__main__':
    main()
