#!/usr/bin/env python3
"""Install a reversible documentation-only CUA overlay, outside ChatGPT.app."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys

HERE = Path(__file__).resolve().parent
APP = None
BASE = None
SOURCE = None
DEST = Path.home() / '.codex/cua-context-profile'
MODULES = DEST / 'node_modules'
PACKAGE = MODULES / '@oai/cua'
REL = Path('dist/lib/js/oai_js_cua/src/tinysky_alt')
GUARDS = ['package.json', 'docs/tinysky-alt-core-cua-repl.md',
          'docs/tinysky-alt-confirmations.md', str(REL / 'read_documentation.js'),
          str(REL / 'globals.js'), str(REL / 'create_documentation.js'),
          str(REL / 'create_tinysky_alt.js'), str(REL / 'create_bootstrap_emitter.js'),
          '../../../../manifest.json', '../../../../../../Info.plist']

def digest(p):
    return hashlib.sha256(p.read_bytes()).hexdigest()

def main():
    global APP, BASE, SOURCE, DEST, MODULES, PACKAGE
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--app', type=Path, help='Installed Codex/ChatGPT app bundle')
    parser.add_argument('--dest', type=Path, default=DEST)
    args = parser.parse_args()
    candidates = [args.app] if args.app else [Path('/Applications/Codex.app'), Path('/Applications/ChatGPT.app'), Path.home()/'Applications/Codex.app', Path.home()/'Applications/ChatGPT.app']
    APP = next((p.resolve() for p in candidates if p and (p/'Contents/Resources/cua_node/lib/node_modules/@oai/cua').is_dir()), None)
    if APP is None:
        raise SystemExit('No supported CUA bundle found; supply --app PATH')
    BASE = APP / 'Contents/Resources/cua_node'
    SOURCE = BASE / 'lib/node_modules/@oai/cua'
    DEST = args.dest.expanduser().resolve()
    MODULES = DEST / 'node_modules'
    PACKAGE = MODULES / '@oai/cua'
    if sys.platform != 'darwin':
        raise SystemExit('This installer is for macOS only')
    if DEST.exists():
        raise SystemExit(f'Existing installation preserved: {DEST}')
    hashes = {rel: digest(SOURCE / rel) for rel in GUARDS}
    original = (SOURCE / REL / 'globals.js').read_text()
    marker = 'Reflect.set(globalThis,"cua",n);'
    if original.count(marker) != 1:
        raise SystemExit('Unrecognized globals layout; nothing changed')
    subprocess.run([str(BASE/'bin/node'), str(HERE/'test_profile.mjs')], env={**os.environ, 'CUA_PACKAGE': str(SOURCE)}, check=True)
    previous = subprocess.run(['launchctl', 'getenv', 'CODEX_NODE_REPL_PATH'],
                              capture_output=True, text=True).stdout.strip()
    shutil.copytree(SOURCE, PACKAGE, symlinks=True)
    shutil.copyfile(HERE / 'profile.mjs', PACKAGE / REL / 'context_profile.mjs')
    shutil.copyfile(HERE / 'adaptive.mjs', PACKAGE / REL / 'adaptive_docs.mjs')
    shutil.copyfile(HERE / 'reader.mjs', PACKAGE / REL / 'read_documentation.js')
    (PACKAGE / REL / 'globals.js').write_text(
        'import {show_documentation} from "./read_documentation.js";\n' +
        'import {attachAdaptiveDocs} from "./adaptive_docs.mjs";\n' +
        original.replace(marker,
            'Object.defineProperty(n,"documentation",{value:show_documentation,enumerable:true});' +
            'attachAdaptiveDocs(n,{surfaces:()=>globalThis.nodeRepl?.env?.CUA_REPL_ENABLED_SURFACES,emitDetail:show_documentation});' + marker))
    manifest = {'upstream_root': str(SOURCE), 'sha256': hashes,
                'original_node_repl': str(BASE / 'bin/node_repl'),
                'previous_launchctl_override': previous, 'app': str(APP)}
    (DEST / 'manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')
    wrapper = DEST / 'node-repl'
    shutil.copyfile(HERE / 'wrapper.py', wrapper)
    wrapper.chmod(0o755)
    print(json.dumps({'prepared': str(DEST), 'wrapper': str(wrapper)}))

if __name__ == '__main__':
    main()
