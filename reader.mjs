// Installed as read_documentation.js inside the user's CUA package copy.
import {existsSync} from 'node:fs';
import {readFile} from 'node:fs/promises';
import {compactCore, detailedDocs} from './context_profile.mjs';
import {contextFromTarget, runtimeContext} from './adaptive_docs.mjs';
let root = new URL('.', import.meta.url);
while (!existsSync(new URL('package.json',root))) {
  const parent = new URL('..',root);
  if (parent.href === root.href) throw new Error('Could not find CUA package');
  root = parent;
}
const docs = new URL('docs/',root);
async function context() {
  const surfaces = globalThis.nodeRepl?.env?.CUA_REPL_ENABLED_SURFACES;
  if (globalThis.cua) return runtimeContext(globalThis.cua, surfaces);
  // Upstream emits initial documentation after provider setup but before exposing
  // globalThis.cua. Reuse the same already-initialized provider's target property.
  // Do not substitute process.platform: the controlled computer may be remote.
  if (typeof surfaces !== 'string') return null;
  if (!surfaces.split(',').map(s=>s.trim()).includes('computer')) return contextFromTarget(null,surfaces);
  try {
    const {sky} = await import('../../../../../project/cua/sky_js/src/index.js');
    return contextFromTarget(sky.target,surfaces);
  } catch { return null; }
}
export async function read_documentation(name) {
  const text = await readFile(new URL(`tinysky-alt-${name}.md`,docs),'utf8');
  return name === 'core-cua-repl' ? compactCore(text,await context()) : text;
}
export async function show_documentation(topic='native', observed) {
  const original = await readFile(new URL('tinysky-alt-core-cua-repl.md',docs),'utf8');
  const text = detailedDocs(original,topic,observed ?? await context());
  // A layout mismatch already emitted the full core at bootstrap. Avoid duplicating it.
  if (observed && text === original) return;
  await globalThis.nodeRepl.write(text,`cua.detail.${topic}`);
}
