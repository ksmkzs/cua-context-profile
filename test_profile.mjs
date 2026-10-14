import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {compactCore, detailedDocs} from './profile.mjs';
// Synthetic fixture is authored here; vendor documentation is never redistributed.
const fixture = '## API\n```typescript\ninterface App { selectText(): void; performSecondaryAction(): void; setValue(): void; drag(): void; }\ntype BrowserInfo = {};\n```\n## Native apps\nExample\n## Workflow\nObserve first\n## Output\nAvoid duplicate output\n## Notes\n- Preserve qualifiers.\n' + 'Example reference text. '.repeat(1000);
const original = process.env.CUA_PACKAGE
  ? await readFile(`${process.env.CUA_PACKAGE}/docs/tinysky-alt-core-cua-repl.md`, 'utf8') : fixture;
const native = compactCore(original, 'darwin', 'computer');
const both = compactCore(original, 'darwin', 'computer,browser');
assert(native.length < original.length / 2);
assert(!native.includes('await cua.listBrowsers'));
assert(both.includes('await cua.listBrowsers'));
assert(!compactCore(original, 'darwin', 'browser').includes('const app ='));
assert.equal(compactCore(original, 'linux', 'computer'), original);
assert.equal(compactCore(original, 'win32', 'computer'), original);
assert.equal(detailedDocs(original, 'full', 'darwin'), original);
assert.throws(() => detailedDocs(original, '../../secret', 'darwin'));
for (const name of ['selectText', 'performSecondaryAction', 'setValue', 'drag']) {
  assert(detailedDocs(original, 'native', 'darwin').includes(name));
}
for (const text of [native, both]) {
  assert(text.includes('unless the user\nspecifically requests'));
  assert(text.includes('confirmation requirements still apply'));
  assert(text.includes('getAXState() before deciding'));
  assert(text.includes('verify success or report the blocker'));
  assert(text.includes('cua.rewriteDocumentation()'));
}
console.log(JSON.stringify({passed:true, original:original.length, native:native.length, both:both.length}));
