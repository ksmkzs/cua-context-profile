#!/usr/bin/env node
// cua-proxy: a transparent MCP stdio proxy in front of the stock Codex CUA runtime (node_repl).
//
// Every message is passed through byte for byte, with two exceptions:
//   - `tools/call` for js / js_reset runs through the filters (before and after the real call);
//   - a client that sends no Codex turn metadata gets a session identity supplied for it.
// Filters are plain modules: the built-in documentation filter and anything in filters.d/*.mjs.
// A filter may contribute
//   banner      JavaScript appended to NODE_REPL_JS_BANNER (runs inside the runtime at start-up)
//   beforeCall  (call) -> void | {result}    may set call.meta; {result} answers without the runtime
//   afterCall   (call, result) -> result     result is undefined when the call was not answered
//   tools       (tools) -> tools             may adjust the tool list the client is shown
//   close       () -> void                   called once when the client disconnects
import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline';
import {readdirSync, statSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {randomUUID} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';

const TURN = 'x-codex-turn-metadata';
// A runtime started before the desktop app was updated cannot reach the Computer Use service of
// the new version: every app call ends in this error until the client starts the runtime again
// (seen on 2026-11-19, app 26.1105 -> 26.1111, while a new runtime worked at once).
const PIPE_FAILED = /native pipe startup failed/;
export const STALE_HINT = 'cua-proxy: the Codex desktop app was updated after this Computer Use runtime started, and ' +
  'this runtime can no longer reach the app\'s Computer Use service. Nothing was done on screen. Start the runtime ' +
  'again: reconnect this MCP server (in Claude Code: /mcp, then reconnect) or begin a new session. Afterwards ' +
  'observe before acting.';

/** A function telling whether the file has been replaced since now (an app update replaces the runtime). */
export function replacedSince(file) {
  const stamp = () => { try { const s = statSync(file); return `${s.ino}:${s.mtimeMs}:${s.size}`; } catch { return 'missing'; } };
  const born = stamp();
  return () => stamp() !== born;
}
const here = dirname(fileURLToPath(import.meta.url));

export async function loadFilters({env = process.env, log = () => {}, root = here} = {}) {
  const files = [join(root, 'filters', 'docs.mjs')];
  try { files.push(...readdirSync(join(root, 'filters.d')).filter(f => f.endsWith('.mjs')).sort().map(f => join(root, 'filters.d', f))); }
  catch { /* no drop-in directory */ }
  const filters = [];
  for (const file of files) {
    try {
      const filter = await (await import(pathToFileURL(file).href)).default({env, log});
      if (filter) filters.push(filter);
    } catch (error) { log(`filter ${file} was not loaded: ${error.message}`); }
  }
  return filters;
}

export function start({command, args = [], env = process.env, input = process.stdin, output = process.stdout,
  filters = [], log = () => {}, cancelGraceMs = 10000, upstreamReplaced = replacedSince(command)}) {
  // Without the CUA banner this is not a CUA launch; filters have nothing to attach to.
  const active = typeof env.NODE_REPL_JS_BANNER === 'string' ? filters : [];
  const banner = active.map(f => f.banner ? `try ${f.banner.trim()} catch {}\n` : '').join('');
  const child = spawn(command, args, {stdio: ['pipe', 'pipe', 'inherit'],
    env: banner ? {...env, NODE_REPL_JS_BANNER: env.NODE_REPL_JS_BANNER + banner} : env});
  const allow = env.CUA_PROXY_TOOLS ? new Set(env.CUA_PROXY_TOOLS.split(',').map(s => s.trim()).filter(Boolean)) : null;
  const instance = randomUUID();
  const listIds = new Set(), inflight = new Map(), waiting = new Map();
  let chain = Promise.resolve(), clientName = 'mcp-client', ownsIdentity = false, turn = 1, closing = false;
  const toClient = message => { if (!output.destroyed) output.write((typeof message === 'string' ? message : JSON.stringify(message)) + '\n'); };
  const toRuntime = message => { if (child.stdin.writable) child.stdin.write((typeof message === 'string' ? message : JSON.stringify(message)) + '\n'); };

  async function call(message) {
    const entry = waiting.get(message.id);
    waiting.delete(message.id);
    if (entry?.cancelled) return;
    const params = message.params, meta = (params._meta ??= {});
    let identity = meta[TURN];
    if (!identity || typeof identity !== 'object') {
      ownsIdentity = true;
      identity = meta[TURN] = {session_id: instance, thread_id: instance, turn_id: `turn-${turn}`,
        call_id: String(meta['claudecode/toolUseId'] ?? message.id), client_name: clientName};
    }
    const context = {id: message.id, tool: params.name, args: params.arguments ?? {}, meta: {},
      session: String(identity.thread_id ?? identity.session_id ?? instance)};
    const ran = [];
    let result, response;
    try {
      for (const filter of active) {
        ran.push(filter);
        const verdict = await filter.beforeCall?.(context);
        if (verdict?.result) { result = verdict.result; break; }
      }
    } catch (error) {
      result = {isError: true, content: [{type: 'text', text: `cua-proxy: ${error.message}`}]};
    }
    if (!result) {
      if (Object.keys(context.meta).length) meta['cua-proxy'] = context.meta;
      response = await new Promise(resolve => { inflight.set(message.id, resolve); toRuntime(message); });
      result = response?.result;
    }
    for (const filter of ran.reverse()) {
      try { result = await filter.afterCall?.(context, result) ?? result; }
      catch (error) { log(`${filter.name}: ${error.message}`); }
    }
    if (response === null) return;                       // cancelled: no reply is owed
    if (Array.isArray(result?.content) && result.content.some(part => PIPE_FAILED.test(part?.text ?? '')) && upstreamReplaced()) {
      result = {...result, content: [...result.content, {type: 'text', text: STALE_HINT}]};
    }
    toClient(response?.error ? response : {jsonrpc: '2.0', id: message.id, result});
  }

  createInterface({input, crlfDelay: Infinity}).on('line', line => {
    let message;
    try { message = JSON.parse(line); } catch { return toRuntime(line); }
    const {method, id, params} = message ?? {};
    if (method === 'initialize') clientName = params?.clientInfo?.name ?? clientName;
    if (method === 'tools/list' && id !== undefined && (allow || active.some(f => f.tools))) listIds.add(id);
    if (method === 'tools/call' && id !== undefined && params && active.length) {
      if (params.name === 'js' || params.name === 'js_reset') {
        waiting.set(id, {cancelled: false});
        chain = chain.then(() => call(message)).catch(error => log(`call failed: ${error.stack ?? error}`));
        return;
      }
      if (params.name === 'turn_ended' && ownsIdentity) {
        // The identity on the calls was supplied here, so the notification must name the same one.
        params.arguments = {...params.arguments, session_id: instance, turn_id: `turn-${turn}`};
        turn += 1;
        return toRuntime(message);
      }
    }
    if (method === 'notifications/cancelled') {
      const target = params?.requestId;
      if (waiting.has(target)) { waiting.get(target).cancelled = true; return; }
      if (inflight.has(target)) setTimeout(() => { const done = inflight.get(target); if (done) { inflight.delete(target); done(null); } }, cancelGraceMs).unref();
    }
    toRuntime(line);
  }).once('close', () => void shutdown(0));
  input.once('close', () => void shutdown(0));        // closed without an orderly end

  createInterface({input: child.stdout, crlfDelay: Infinity}).on('line', line => {
    let message;
    try { message = JSON.parse(line); } catch { return toClient(line); }
    if (message && message.id !== undefined && message.method === undefined) {
      const done = inflight.get(message.id);
      if (done) { inflight.delete(message.id); return done(message); }
      if (listIds.delete(message.id) && Array.isArray(message.result?.tools)) {
        let list = allow ? message.result.tools.filter(tool => allow.has(tool.name)) : message.result.tools;
        for (const filter of active) {
          try { list = filter.tools?.(list) ?? list; } catch (error) { log(`${filter.name}: ${error.message}`); }
        }
        message.result.tools = list;
        return toClient(message);
      }
    }
    toClient(line);
  });

  const exited = new Promise(resolve => child.once('exit', (code, signal) => resolve(code ?? (signal ? 1 : 0))));
  child.once('error', error => { log(`cannot start the CUA runtime: ${error.message}`); void shutdown(127); });
  void exited.then(code => {
    for (const [id, done] of inflight) done({jsonrpc: '2.0', id, error: {code: -32000, message: 'The CUA runtime exited. Do not repeat an action whose outcome is unknown; observe first.'}});
    inflight.clear();
    void shutdown(code);
  });

  let finished;
  const done = new Promise(resolve => { finished = resolve; });
  async function shutdown(code) {
    if (closing) return;
    closing = true;
    const within = ms => delay(ms, null, {ref: false});
    await Promise.race([chain, within(2000)]);
    await Promise.race([Promise.allSettled(active.map(f => f.close?.())), within(15000)]);
    child.stdin.end();
    if (await Promise.race([exited, within(3000)]) === null) child.kill();
    finished(code);
  }
  return {done, child, instance, stop: shutdown};
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const log = text => process.stderr.write(`[cua-proxy] ${text}\n`);
  const command = process.env.CUA_PROXY_UPSTREAM;
  if (!command) { log('CUA_PROXY_UPSTREAM is not set; start this through the node-repl launcher next to it'); process.exit(64); }
  const proxy = start({command, args: process.argv.slice(2), filters: await loadFilters({log}), log});
  for (const signal of ['SIGTERM', 'SIGINT', 'SIGHUP']) process.once(signal, () => void proxy.stop(0));
  process.exit(await proxy.done);
}
