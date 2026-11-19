import test from 'node:test';
import assert from 'node:assert/strict';
import {PassThrough} from 'node:stream';
import {createInterface} from 'node:readline';
import {fileURLToPath} from 'node:url';
import {spawn, spawnSync} from 'node:child_process';
import {start, replacedSince, STALE_HINT} from '../proxy.mjs';
import {mkdtempSync, renameSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

const fake = fileURLToPath(new URL('./fake-runtime.mjs', import.meta.url));
const spawnSyncText = (command, args) => { const r = spawnSync(command, args, {encoding: 'utf8'}); return r.stdout; };
function harness({filters = [], env = {}, ...more} = {}) {
  const input = new PassThrough(), output = new PassThrough(), lines = [], waiters = [];
  createInterface({input: output}).on('line', line => { lines.push(line); waiters.splice(0).forEach(w => w()); });
  const proxy = start({command: process.execPath, args: [fake], input, output, filters, cancelGraceMs: 50, ...more,
    env: {PATH: process.env.PATH, NODE_REPL_JS_BANNER: 'BASE;', ...env}});
  const reply = async id => {
    for (;;) {
      const hit = lines.map(l => JSON.parse(l)).find(m => m.id === id && m.method === undefined);
      if (hit) return hit;
      await new Promise(resolve => waiters.push(resolve));
    }
  };
  const send = message => input.write((typeof message === 'string' ? message : JSON.stringify(message)) + '\n');
  const call = (id, code, extra = {}) => send({jsonrpc: '2.0', id, method: 'tools/call', params: {name: 'js', arguments: {code}, ...extra}});
  return {proxy, lines, reply, send, call, end: async () => { input.end(); return proxy.done; }};
}
const echo = reply => JSON.parse(reply.result.content[0].text);
const noop = {name: 'noop'};

test('messages it does not own pass through byte for byte', async () => {
  const h = harness({filters: [noop]});
  const raw = '{"jsonrpc":"2.0",   "id":1,"method":"ping", "params":{"a":  1}}';
  h.send(raw);
  assert.equal((await h.reply(1)).result.raw, raw);
  assert.equal(await h.end(), 0);
});

test('a client without turn metadata gets one identity for the whole connection', async () => {
  const h = harness({filters: [noop]});
  h.send({jsonrpc: '2.0', id: 0, method: 'initialize', params: {clientInfo: {name: 'claude-code'}}});
  h.call(1, 'a'); h.call(2, 'b');
  const [a, b] = [echo(await h.reply(1)), echo(await h.reply(2))];
  const ta = a._meta['x-codex-turn-metadata'], tb = b._meta['x-codex-turn-metadata'];
  assert.equal(ta.session_id, tb.session_id);
  assert.deepEqual([ta.client_name, ta.turn_id, ta.thread_id], ['claude-code', 'turn-1', ta.session_id]);
  h.send({jsonrpc: '2.0', id: 3, method: 'tools/call', params: {name: 'turn_ended', arguments: {hook_event_name: 'Stop', session_id: 'x', turn_id: 'y'}}});
  assert.deepEqual(echo(await h.reply(3)).args, {hook_event_name: 'Stop', session_id: ta.session_id, turn_id: 'turn-1'});
  h.call(4, 'c');
  assert.equal(echo(await h.reply(4))._meta['x-codex-turn-metadata'].turn_id, 'turn-2');
  await h.end();
});

test('a client that sends turn metadata keeps it, and its turn_ended is untouched', async () => {
  const h = harness({filters: [noop]});
  const identity = {session_id: 's', thread_id: 't', turn_id: 'u'};
  h.call(1, 'a', {_meta: {'x-codex-turn-metadata': identity}});
  assert.deepEqual(echo(await h.reply(1))._meta, {'x-codex-turn-metadata': identity});
  h.send({jsonrpc: '2.0', id: 2, method: 'tools/call', params: {name: 'turn_ended', arguments: {session_id: 'x'}}});
  assert.deepEqual(echo(await h.reply(2)).args, {session_id: 'x'});
  await h.end();
});

test('filters see calls in order, can pass metadata in, answer early, and rewrite results', async () => {
  const seen = [];
  const filter = {name: 'f', banner: '{ F }',
    async beforeCall(call) {
      seen.push(`before ${call.args.code} ${call.session}`);
      if (call.args.code === 'BLOCK') return {result: {isError: true, content: [{type: 'text', text: 'blocked'}]}};
      call.meta.f = {pinned: true};
    },
    afterCall(call, result) { seen.push(`after ${call.args.code}`); return {...result, content: [...result.content, {type: 'text', text: 'added'}]}; }};
  const h = harness({filters: [filter]});
  const identity = {'x-codex-turn-metadata': {thread_id: 'T'}};
  h.call(1, 'SLOW', {_meta: identity}); h.call(2, 'BLOCK', {_meta: identity}); h.call(3, 'c', {_meta: identity});
  const [a, b, c] = [await h.reply(1), await h.reply(2), await h.reply(3)];
  assert.deepEqual(echo(a)._meta['cua-proxy'], {f: {pinned: true}});
  assert.equal(echo(a).banner, 'BASE;try { F } catch {}\n');
  assert.equal(a.result.content.at(-1).text, 'added');
  assert.deepEqual(b.result.content.map(x => x.text), ['blocked', 'added']);
  assert.equal(echo(c).args.code, 'c');
  assert.deepEqual(seen, ['before SLOW T', 'after SLOW', 'before BLOCK T', 'after BLOCK', 'before c T', 'after c']);
  await h.end();
});

test('server requests such as approvals travel both ways while a call is open', async () => {
  const h = harness({filters: [noop]});
  h.send({jsonrpc: '2.0', id: 77, method: 'tools/call', params: {name: 'js', arguments: {code: 'ASK'}}});
  for (;;) { if (h.lines.some(l => l.includes('elicitation/create'))) break; await new Promise(r => setTimeout(r, 5)); }
  h.send({jsonrpc: '2.0', id: 'ask-1', result: {action: 'decline'}});
  assert.equal((await h.reply(77)).result.content[0].text, 'answered decline');
  await h.end();
});

test('the tool list can be limited to the tools the desktop app itself enables, and filters may adjust it', async () => {
  const relabel = {name: 'f', tools: list => list.map(t => ({...t, description: 'seen'}))};
  const h = harness({filters: [relabel], env: {CUA_PROXY_TOOLS: 'js,js_reset,turn_ended'}});
  h.send({jsonrpc: '2.0', id: 1, method: 'tools/list', params: {}});
  const tools = (await h.reply(1)).result.tools;
  assert.deepEqual(tools.map(t => t.name), ['js', 'js_reset', 'turn_ended']);
  assert.ok(tools.every(t => t.description === 'seen'));
  await h.end();
});

test('cancelling: a waiting call is dropped, an open call releases the queue, filters are told', async () => {
  const after = [];
  const h = harness({filters: [{name: 'f', afterCall(call, result) { after.push([call.args.code, result === undefined]); }}]});
  h.call(1, 'HANG'); h.call(2, 'never'); h.call(3, 'c');
  await new Promise(resolve => setTimeout(resolve, 40));   // call 1 is now open in the runtime
  h.send({jsonrpc: '2.0', method: 'notifications/cancelled', params: {requestId: 2}});
  h.send({jsonrpc: '2.0', method: 'notifications/cancelled', params: {requestId: 1}});
  assert.equal(echo(await h.reply(3)).args.code, 'c');
  assert.deepEqual(after, [['HANG', true], ['c', false]]);
  assert.equal(h.lines.some(l => JSON.parse(l).id === 2), false);
  await h.end();
});

test('when the runtime dies an open call gets an error and filters are closed', async () => {
  let closed = 0;
  const h = harness({filters: [{name: 'f', close() { closed += 1; }}]});
  h.call(1, 'EXIT');
  assert.match((await h.reply(1)).error.message, /runtime exited/);
  assert.equal(await h.proxy.done, 3);
  assert.equal(closed, 1);
});

test('without the CUA banner in the environment it is a plain pipe', async () => {
  const h = harness({filters: [{name: 'f', banner: '{ F }', beforeCall() { throw new Error('must not run'); }}], env: {NODE_REPL_JS_BANNER: undefined}});
  h.call(1, 'a');
  const body = echo(await h.reply(1));
  assert.equal(body.banner, null);
  assert.equal(body._meta, undefined);
  await h.end();
});

test('run as a program: a termination signal, or the client going away, ends it together with the runtime', async () => {
  const main = fileURLToPath(new URL('../proxy.mjs', import.meta.url));
  for (const how of ['SIGTERM', 'close']) {
    const proxy = spawn(process.execPath, [main, fake], {stdio: ['pipe', 'pipe', 'inherit'],
      env: {PATH: process.env.PATH, CUA_PROXY_UPSTREAM: process.execPath, CUA_PROXY_DOCS: 'off', NODE_REPL_JS_BANNER: 'B'}});
    const first = new Promise(resolve => createInterface({input: proxy.stdout}).once('line', resolve));
    proxy.stdin.write('{"jsonrpc":"2.0","id":1,"method":"ping","params":{}}\n');
    assert.match(await first, /"id":1/);
    const runtime = Number(String(spawnSyncText('pgrep', ['-P', String(proxy.pid)])).trim().split('\n')[0]);
    assert.ok(runtime > 0);
    const exited = new Promise(resolve => proxy.once('exit', code => resolve(code)));
    if (how === 'SIGTERM') proxy.kill('SIGTERM'); else proxy.stdin.end();
    assert.equal(await exited, 0, how);
    await new Promise(resolve => setTimeout(resolve, 200));
    assert.throws(() => process.kill(runtime, 0), {code: 'ESRCH'}, `${how}: the runtime is still running`);
  }
});

test('a runtime older than the installed app says so when it cannot reach the service, and only then', async () => {
  let replaced = false;
  const h = harness({filters: [noop], upstreamReplaced: () => replaced});
  const failure = 'PRINT:' + JSON.stringify(['{"apps":0,"errors":["Native apps: Error: Sky Computer Use native pipe startup failed"]}']);
  h.call(1, failure);
  assert.equal((await h.reply(1)).result.content.length, 1);             // the app was not updated: the error as it is
  replaced = true;
  h.call(2, failure);
  const told = (await h.reply(2)).result.content;
  assert.deepEqual([told.length, told[1].text], [2, STALE_HINT]);
  assert.match(told[0].text, /native pipe startup failed/);              // the runtime's own words stay
  h.call(3, 'fine');
  assert.equal((await h.reply(3)).result.content.length, 1);             // a call that works gets nothing added
  await h.end();
});

test('a file counts as replaced when another one takes its place', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cua-proxy-'));
  const file = join(dir, 'node_repl');
  writeFileSync(file, 'one');
  const replaced = replacedSince(file);
  assert.equal(replaced(), false);
  writeFileSync(join(dir, 'next'), 'two!');
  renameSync(join(dir, 'next'), file);
  assert.equal(replaced(), true);
  assert.equal(replacedSince(join(dir, 'none'))(), false);               // missing then and now: unchanged
});
