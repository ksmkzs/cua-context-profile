import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,copyFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {fixture} from './tests/fixture.mjs';

test('bootstrap reader detects provider target before global cua exists and leaves policy bytes intact',async()=>{
  const root=await mkdtemp(join(tmpdir(),'adaptive-reader-'));
  const savedCua=globalThis.cua,savedNode=globalThis.nodeRepl;
  try {
    const dir=join(root,'lib/js/oai_js_cua/src/tinysky_alt');
    const sky=join(root,'project/cua/sky_js/src');
    await mkdir(dir,{recursive:true});await mkdir(sky,{recursive:true});await mkdir(join(root,'docs'));
    await writeFile(join(root,'package.json'),' {"type":"module"}');
    for (const [from,to] of [['reader.mjs','read_documentation.js'],['adaptive.mjs','adaptive_docs.mjs'],['profile.mjs','context_profile.mjs']]) {
      await copyFile(new URL(from,import.meta.url),join(dir,to));
    }
    await writeFile(join(sky,'index.js'),'export const sky = {target: "linux"};');
    await writeFile(join(root,'docs/tinysky-alt-core-cua-repl.md'),fixture);
    const policy='UNMODIFIED POLICY\nApproval stays with upstream.\n';
    await writeFile(join(root,'docs/tinysky-alt-confirmations.md'),policy);
    delete globalThis.cua;
    const outputs=[];
    globalThis.nodeRepl={env:{CUA_REPL_ENABLED_SURFACES:'computer'},write:async(t,k)=>outputs.push([t,k])};
    const reader=await import(pathToFileURL(join(dir,'read_documentation.js')));
    const first=await reader.read_documentation('core-cua-repl');
    assert(first.includes('Computer Use — Linux'));assert(!first.includes('Computer Use — macOS'));
    assert.equal(await reader.read_documentation('confirmations'),policy);
    await reader.show_documentation('native');assert(outputs[0][0].includes('Native reference — Linux'));
    // Once bindings exist, their actual target wins over the bootstrap provider.
    globalThis.cua={computer:{target:'windows'},getApp(){},listApps(){}};
    assert((await reader.read_documentation('core-cua-repl')).includes('Computer Use — Windows'));
    globalThis.cua.computer.target='unknown';
    assert.equal(await reader.read_documentation('core-cua-repl'),fixture);
    await reader.show_documentation('full');assert.equal(outputs.at(-1)[0],fixture);
  } finally {
    if(savedCua===undefined)delete globalThis.cua;else globalThis.cua=savedCua;
    if(savedNode===undefined)delete globalThis.nodeRepl;else globalThis.nodeRepl=savedNode;
    await rm(root,{recursive:true,force:true});
  }
});
