"""Select a complete known documentation layout; never bless missing files."""
from pathlib import Path

REL = Path('dist/lib/js/oai_js_cua/src/tinysky_alt')

def guard_files(source, macos=False):
    legacy = 'docs/tinysky-alt-core-cua-repl.md'
    core = [legacy] if (source/legacy).is_file() else [
        f'docs/tinysky-alt-core-cua-repl-{target}.md' for target in ('mac','linux','windows','no-cua')]
    files = ['package.json', *core, 'docs/tinysky-alt-confirmations.md']
    files += [str(REL/name) for name in ('read_documentation.js','globals.js','create_documentation.js',
                                       'create_tinysky_alt.js','create_bootstrap_emitter.js')]
    files += ['../../../../manifest.json']
    if macos:
        files += ['../../../../../../Info.plist']
    missing = [name for name in files if not (source/name).is_file()]
    if missing:
        raise RuntimeError('Incomplete CUA documentation layout: ' + ', '.join(missing))
    return files
