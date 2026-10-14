#!/usr/bin/python3
import argparse
import hashlib, json, os, sys
from pathlib import Path
root = Path(__file__).resolve().parent
m = json.loads((root / 'manifest.json').read_text())
env = os.environ.copy()
if env.get('CUA_REPL_ENABLED_SURFACES'):
    try:
        valid = all(hashlib.sha256((Path(m['upstream_root']) / rel).read_bytes()).hexdigest() == h
                    for rel, h in m['sha256'].items())
    except OSError:
        valid = False
    if valid:
        # Preserve all policy, metadata, trusted services and host IPC settings.
        original = env.get('NODE_REPL_NODE_MODULE_DIRS', '')
        env['NODE_REPL_NODE_MODULE_DIRS'] = str(root / 'node_modules') + (os.pathsep + original if original else '')
    else:
        print('CUA documentation overlay disabled: upstream changed; using stock runtime.', file=sys.stderr)
os.execve(m['original_node_repl'], [m['original_node_repl'], *sys.argv[1:]], env)
