#!/usr/bin/env python3
"""Prepare a documentation overlay from an installed Windows desktop bundle."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys

HERE = Path(__file__).resolve().parent
REL = Path('dist/lib/js/oai_js_cua/src/tinysky_alt')

def main():
    if sys.platform != 'win32':
        raise SystemExit('Run this installer on Windows')
    import winreg
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--app', type=Path, required=True, help='Installed app directory containing resources')
    parser.add_argument('--dest', type=Path, default=Path.home()/'.codex/cua-context-profile')
    args = parser.parse_args()
    app = args.app.resolve()
    base = app/'resources/cua_node'
    source = base/'bin/node_modules/@oai/cua'
    dest = args.dest.expanduser().resolve()
    compiler = Path(os.environ['WINDIR'])/'Microsoft.NET/Framework64/v4.0.30319/csc.exe'
    runtime = base/'bin/node_repl.exe'
    node = base/'bin/node.exe'
    if dest.exists():
        raise SystemExit(f'Existing installation preserved: {dest}')
    for path in (source/'package.json', compiler, runtime, node):
        if not path.is_file():
            raise SystemExit(f'Required installed file missing: {path}')
    guards = ['package.json', 'docs/tinysky-alt-core-cua-repl.md', 'docs/tinysky-alt-confirmations.md']
    guards += [str(REL/name) for name in ('read_documentation.js','globals.js','create_documentation.js','create_tinysky_alt.js','create_bootstrap_emitter.js')]
    guards += ['../../../../manifest.json']  # four parents from bin/node_modules/@oai/cua
    hashes = {rel: hashlib.sha256((source/rel).read_bytes()).hexdigest() for rel in guards}
    original = (source/REL/'globals.js').read_text(encoding='utf8')
    marker = 'Reflect.set(globalThis,"cua",n);'
    if original.count(marker) != 1:
        raise SystemExit('Unrecognized globals layout; nothing changed')
    subprocess.run([str(node),str(HERE/'test_profile.mjs')], env={**os.environ,'CUA_PACKAGE':str(source)},check=True)
    previous = None
    try:
        with winreg.OpenKey(winreg.HKEY_CURRENT_USER, 'Environment') as key:
            previous, kind = winreg.QueryValueEx(key,'CODEX_NODE_REPL_PATH')
            if kind != winreg.REG_SZ:
                raise SystemExit('Existing override has an unsupported registry type; preserved')
    except FileNotFoundError:
        pass
    if previous:
        raise SystemExit('An existing user override is configured; preserved')
    # All validation above happens before creating the destination.
    try:
        package = dest/'node_modules/@oai/cua'
        shutil.copytree(source,package)
        for src,target in [('profile.mjs','context_profile.mjs'),('adaptive.mjs','adaptive_docs.mjs'),('reader.mjs','read_documentation.js')]:
            shutil.copyfile(HERE/src,package/REL/target)
        (package/REL/'globals.js').write_text(
            'import {show_documentation} from "./read_documentation.js";\n'
            'import {attachAdaptiveDocs} from "./adaptive_docs.mjs";\n' +
            original.replace(marker,'Object.defineProperty(n,"documentation",{value:show_documentation,enumerable:true});'
                'attachAdaptiveDocs(n,{surfaces:()=>globalThis.nodeRepl?.env?.CUA_REPL_ENABLED_SURFACES,emitDetail:show_documentation});'+marker),encoding='utf8')
        manifest = {'upstream_root':str(source),'sha256':hashes,'original_node_repl':str(runtime),
                    'previous_user_override':previous,'app':str(app),'platform':'win32',
                    'runtime_manifest_sha256':hashlib.sha256((base/'manifest.json').read_bytes()).hexdigest()}
        (dest/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n',encoding='utf8')
        subprocess.run([str(compiler),'/nologo','/target:exe','/reference:System.Web.Extensions.dll',
                        '/out:'+str(dest/'node-repl.exe'),str(HERE/'windows-wrapper.cs')],check=True)
        shutil.copyfile(HERE/'activate_windows.py',dest/'activate_windows.py')
    except BaseException:
        if dest.exists(): shutil.rmtree(dest)
        raise
    print(json.dumps({'prepared':str(dest),'wrapper':str(dest/'node-repl.exe'),'activated':False}))

if __name__ == '__main__':
    main()
