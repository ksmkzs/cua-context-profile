import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {compactCore, detailedDocs} from './profile.mjs';
import {contextFromTarget, runtimeContext, attachAdaptiveDocs} from './adaptive.mjs';
import {fixture} from './tests/fixture.mjs';
const original = process.env.CUA_PACKAGE
  ? await readFile(`${process.env.CUA_PACKAGE}/docs/tinysky-alt-core-cua-repl.md`,'utf8') : fixture;
function runtime(target='mac') {
  return {computer:{target}, listApps(){}, getApp:async()=>({binding:true}),
    getBrowser:async()=>({provider:true}), getTab:async()=>({tab:true}),
    createBrowserTab:async()=>({created:true}), rewriteDocumentation:async()=>{}};
}
for (const [target,platform,label] of [['mac','darwin','macOS'],['linux','linux','Linux'],['windows','win32','Windows']]) {
  test(`selects ${label} from the controlled computer`,()=>{
    const c=runtimeContext(runtime(target),'computer');
    assert.equal(c.platform,platform);
    const compact=compactCore(original,c);
    assert(compact.includes(label));assert(compact.length<original.length/2);
    assert.equal(compact.includes('windowId: 123'),platform!=='darwin');
    assert(!compact.includes('await cua.listBrowsers'));
    const detail=detailedDocs(original,'native',c);
    assert(detail.includes('Native reference'));assert(detail.includes('drag'));
    if (platform!=='darwin') assert(!detail.includes('  selectText('));
    if (platform==='linux') assert(!detail.includes('  setValue('));
    if (platform==='win32') assert(detail.includes('AX-only observation clears'));
  });
}
test('browser-only context requires no native target or host OS',()=>{
  const c=runtimeContext({getBrowser(){},getTab(){}},'browser');
  assert.equal(c.platform,null);
  const core=compactCore(original,c);assert(core.includes('browser only'));assert(!core.includes('const app ='));
  const detail=detailedDocs(original,'browser',c);
  assert(detail.includes('DOM-only'));assert(!detail.includes('type AppInfo'));
  assert.equal(detailedDocs(original,'native',c),'native access is not enabled in this runtime.');
});
test('unknown target/config/layout returns complete original',()=>{
  for (const c of [null,runtimeContext(runtime('future'),'computer'),runtimeContext(runtime(),undefined),runtimeContext(runtime(),'computer,unknown'),runtimeContext({},'computer')]) {
    assert.equal(compactCore(original,c),original);
    assert.equal(detailedDocs(original,'native',c),original);
  }
  const c=contextFromTarget('mac','computer');
  assert.equal(compactCore('changed layout',c),'changed layout');
  assert.equal(detailedDocs('changed layout','native',c),'changed layout');
  assert.equal(detailedDocs(original,'full',c),original);
  assert.throws(()=>detailedDocs(original,'../../secret',c));
});
test('baseline rules remain in every split entry guide',()=>{
  for (const target of ['mac','linux','windows']) {
    const text=compactCore(original,contextFromTarget(target,'browser,computer'));
    for (const required of ['confirmation requirements still apply','untrusted','getAXState() before deciding','Verify success or report the blocker','cua.rewriteDocumentation()']) assert(text.includes(required));
  }
});
test('selection automatically emits each surface once and preserves results/arguments/receiver',async()=>{
  const cua=runtime(),calls=[];const result={unique:1};
  cua.getApp=async function(...args){assert.equal(this,cua);calls.push(args);return result;};
  attachAdaptiveDocs(cua,{surfaces:()=> 'computer,browser',emitDetail:async(topic)=>calls.push(topic)});
  assert.equal(await cua.getApp('a'),result);await cua.getApp('b');await cua.getBrowser();await cua.getTab('t');
  assert.equal(calls.filter(x=>x==='native').length,1);assert.equal(calls.filter(x=>x==='browser').length,1);
  assert.deepEqual(calls[1],['a']);
});
test('concurrent binding calls share documentation without sharing UI operations',async()=>{
  const cua=runtime();let docs=0,bindings=0;
  cua.getApp=async()=>++bindings;
  attachAdaptiveDocs(cua,{surfaces:()=> 'computer',emitDetail:async()=>{docs++;await new Promise(r=>setTimeout(r,5));}});
  await Promise.all([cua.getApp('a'),cua.getApp('b')]);assert.equal(docs,1);assert.equal(bindings,2);
});
test('compaction re-emits references even for existing app bindings',async()=>{
  const cua=runtime(),log=[];cua.rewriteDocumentation=async()=>log.push('upstream');
  attachAdaptiveDocs(cua,{surfaces:()=> 'computer,browser',emitDetail:async(t)=>log.push(t)});
  await cua.getApp('a');await cua.rewriteDocumentation();await cua.getApp('a');
  assert.deepEqual(log,['native','upstream','native']);
});
test('changed target gets its own reference; no host OS inference',async()=>{
  const cua=runtime('linux'),seen=[];
  attachAdaptiveDocs(cua,{surfaces:()=> 'computer',emitDetail:async(t,c)=>seen.push(c.platform)});
  await cua.getApp({windowId:1});cua.computer.target='windows';await cua.getApp({windowId:2});
  assert.deepEqual(seen,['linux','win32']);
});
test('documentation failure cannot cause an already-performed UI operation to be replayed',async()=>{
  const cua=runtime();let calls=0,reads=0;cua.getApp=async()=>calls++;
  attachAdaptiveDocs(cua,{surfaces:()=> 'computer',emitDetail:async()=>{if(++reads===1)throw Error('reference unavailable');}});
  await assert.rejects(cua.getApp('a'),/reference unavailable/);assert.equal(calls,0);
  await cua.getApp('a');assert.equal(calls,1);assert.equal(reads,2);
});
test('unknown context does not probe or replace original methods with guessed behavior',async()=>{
  const cua=runtime('unknown');let emitted=0;
  attachAdaptiveDocs(cua,{surfaces:()=> 'computer',emitDetail:async()=>emitted++});
  assert.deepEqual(await cua.getApp('a'),{binding:true});assert.equal(emitted,0);
});
