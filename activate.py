#!/usr/bin/env python3
"""Activate or restore the desktop overlay for this login session."""
import argparse
import json
from pathlib import Path
import subprocess

p = argparse.ArgumentParser(description=__doc__)
p.add_argument('--dest', type=Path, default=Path.home()/'.codex/cua-context-profile')
p.add_argument('--restore', action='store_true')
a = p.parse_args()
root = a.dest.expanduser().resolve()
wrapper = str(root/'node-repl')
manifest = json.loads((root/'manifest.json').read_text())
current = subprocess.run(['launchctl', 'getenv', 'CODEX_NODE_REPL_PATH'], capture_output=True, text=True).stdout.strip()
if a.restore:
    if current not in ('', wrapper):
        raise SystemExit('Another override is active; preserving it')
    value = manifest['previous_launchctl_override']
else:
    if not Path(wrapper).is_file():
        raise SystemExit('Install the profile first')
    if current not in ('', wrapper):
        raise SystemExit('Another override is active; preserving it')
    value = wrapper
subprocess.run(['launchctl', 'setenv', 'CODEX_NODE_REPL_PATH', value] if value else ['launchctl', 'unsetenv', 'CODEX_NODE_REPL_PATH'], check=True)
print('Restored.' if a.restore else 'Active for the next desktop app launch. Quit and reopen normally; no app was restarted.')
