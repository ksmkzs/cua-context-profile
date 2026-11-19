// A stand-in for the vendor runtime: newline JSON-RPC on stdio, no UI, no vendor text.
import {createInterface} from 'node:readline';
const send = m => process.stdout.write(JSON.stringify(m) + '\n');
const tools = ['js', 'js_add_node_module_dir', 'js_reset', 'turn_ended'].map(name => ({name, inputSchema: {type: 'object'}}));
createInterface({input: process.stdin}).on('line', line => {
  const m = JSON.parse(line);
  if (m.id === undefined) return;
  if (m.method === 'initialize') return send({jsonrpc: '2.0', id: m.id, result: {serverInfo: {name: 'fake'}, capabilities: {tools: {}}}});
  if (m.method === 'tools/list') return send({jsonrpc: '2.0', id: m.id, result: {tools}});
  if (m.method !== 'tools/call') return send({jsonrpc: '2.0', id: m.id, result: {raw: line}});
  const {name, arguments: args, _meta} = m.params;
  const code = args?.code ?? '';
  if (code === 'EXIT') process.exit(3);
  if (code === 'HANG') return;
  if (code === 'ASK') return send({jsonrpc: '2.0', id: 'ask-1', method: 'elicitation/create', params: {message: 'Allow?', replyTo: m.id}});
  const text = code.startsWith('PRINT:') ? JSON.parse(code.slice(6)) : [JSON.stringify({name, args, _meta, banner: process.env.NODE_REPL_JS_BANNER ?? null})];
  setTimeout(() => send({jsonrpc: '2.0', id: m.id, result: {content: text.map(t => ({type: 'text', text: t}))}}), code === 'SLOW' ? 60 : 0);
}).on('close', () => process.exit(0));
// Answer to the elicitation above completes the call that asked.
process.stdin.on('data', chunk => {
  for (const line of String(chunk).split('\n')) {
    if (!line.includes('"ask-1"') || line.includes('"method"')) continue;
    send({jsonrpc: '2.0', id: 77, result: {content: [{type: 'text', text: 'answered ' + JSON.parse(line).result.action}]}});
  }
});
