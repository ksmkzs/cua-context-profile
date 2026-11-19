// Documentation filter: show the runtime's own reference, but only the part that applies.
//
// The stock runtime prints its whole reference on the first call: shared rules, native-app API and
// browser API together. This filter splits that text into three parts without rewording it:
//   shared   shown at once
//   native   shown the first time a native-app entry point (cua.getApp, cua.listApps, ...) is used
//   browser  shown the first time a browser entry point (cua.getTab, cua.getBrowser, ...) is used
// Anything this filter does not recognise is passed through untouched.

export const SENTINEL = /<<cua-proxy:docs:([a-z]*)(!?)>>/g;

// Runs inside the runtime (appended to NODE_REPL_JS_BANNER). It only writes markers; the text
// stays in the proxy, which swaps each marker for the matching part.
export const BANNER = `{
  const c = globalThis.cua, say = t => globalThis.nodeRepl.write('<<cua-proxy:docs:' + t + '>>');
  if (c && !c.documentation) {
    for (const name of Object.keys(c)) {
      const f = c[name];
      if (typeof f !== 'function') continue;
      const words = name.split(/(?=[A-Z])/).map(w => w.toLowerCase());
      const topic = words.some(w => /^(browsers?|tabs?)$/.test(w)) ? 'browser'
        : words.some(w => /^(apps?|windows?)$/.test(w)) ? 'native' : null;
      if (topic) c[name] = (...args) => { say(topic); return f.apply(c, args); };
    }
    const again = c.rewriteDocumentation;
    if (typeof again === 'function') c.rewriteDocumentation = async (...args) => { const r = await again.apply(c, args); say('again'); return r; };
    c.documentation = async (topic = 'full') => { say(String(topic).toLowerCase().replace(/[^a-z]/g, '') + '!'); };
    say('ready');
  }
}
`;

const TOPICS = ['shared', 'native', 'browser'];
const pick = (browser, native) => browser && !native ? 'browser' : native && !browser ? 'native' : 'shared';
function identifierClass(name) {
  const w = name.split(/(?=[A-Z])/).map(x => x.toLowerCase());
  return pick(w.some(x => /^(browsers?|tabs?)$/.test(x)), w.some(x => /^(apps?|windows?|computer)$/.test(x)));
}
const NATIVE = /\b(native|macOS|Linux|Windows|apps?|getApp|listApps|listWindows)\b/i;
const BROWSER = /\b(browsers?|tabs?|Playwright|DOM-only|iab|dot|chrome:\/\/|getTab|getBrowser|createBrowserTab|listTabs|listBrowsers)\b|MCP Apps?\b/i;
// Quoted examples such as the key name "Tab" say nothing about the surface a sentence is about.
const proseClass = text => {
  const plain = text.replace(/"[^"\n]*"/g, '""');
  return pick(BROWSER.test(plain), NATIVE.test(plain.replace(/MCP Apps?\b|\bin-app\b/gi, '')));
};
const code = line => line.replace(/\/\/.*$/, '').trim();
const depthChange = line => (line.match(/[{(\[]/g) ?? []).length - (line.match(/[})\]]/g) ?? []).length;

// Split a run of declarations; comments and blank lines travel with the declaration that follows.
function declarations(lines, nameOf) {
  const out = []; let current = [], depth = 0, open = false, comment = false;
  const flush = () => { if (current.length) out.push({lines: current, name: nameOf(current)}); current = []; open = false; };
  for (const line of lines) {
    current.push(line);
    const text = code(line);
    if (depth === 0 && !open) {
      if (comment) { comment = !line.includes('*/'); continue; }
      if (!text) continue;
      if (text.startsWith('/*')) { comment = !text.includes('*/'); continue; }
      open = true;
    }
    depth += depthChange(text);
    if (depth <= 0 && /[;,}]$/.test(text)) { depth = 0; flush(); }
  }
  if (current.length) { if (out.length && !open) out.at(-1).lines.push(...current); else flush(); }
  return out;
}
const declName = lines => lines.map(l => l.match(/^(?:export\s+)?(?:declare\s+const|type|interface)\s+(\w+)/)?.[1]).find(Boolean) ?? '';
const memberName = lines => lines.map(l => l.match(/^\s*(?:readonly\s+)?(\w+)\??\s*[(:<]/)?.[1]).find(Boolean) ?? '';
const OPENER = /^declare\s+const\s+\w+\s*:\s*\{\s*$/, CLOSER = /^\};?\s*$/;

function splitApi(source) {
  const parts = {shared: [], native: [], browser: []};
  for (const decl of declarations(source.split('\n'), declName)) {
    const first = decl.lines.findIndex(l => OPENER.test(l)), last = decl.lines.findLastIndex(l => CLOSER.test(l));
    if (first < 0 || last <= first) { parts[identifierClass(decl.name)].push(...decl.lines); continue; }
    // The entry-point object mixes surfaces: split it member by member.
    const members = declarations(decl.lines.slice(first + 1, last), memberName);
    for (const topic of TOPICS) {
      const mine = members.filter(m => identifierClass(m.name) === topic).flatMap(m => m.lines);
      if (mine.length) parts[topic].push(...decl.lines.slice(0, first + 1), ...mine, ...decl.lines.slice(last));
    }
  }
  return parts;
}

function units(body) {
  const out = []; let current = null;
  for (const line of body) {
    if (current?.fence) { current.lines.push(line); if (/^\s*```/.test(line)) current = null; continue; }
    if (/^\s*```/.test(line)) { out.push(current = {fence: true, lines: [line]}); continue; }
    if (!line.trim()) { current = null; continue; }
    if (!current || /^- /.test(line)) out.push(current = {fence: false, lines: []});
    current.lines.push(line);
  }
  return out;
}

const tidy = lines => lines.filter((l, i) => l.trim() || (i > 0 && lines[i - 1].trim() && !/[{]\s*$|^\s*```/.test(lines[i - 1])));

function render(sections, top) {
  const out = [];
  for (const {heading, units: list} of sections) {
    const blocks = [];
    for (const unit of list) {
      const text = (unit.fence ? [unit.lines[0], ...tidy(unit.lines.slice(1, -1)), unit.lines.at(-1)] : unit.lines).join('\n');
      const bullet = !unit.fence && /^- /.test(unit.lines[0]);
      if (bullet && blocks.at(-1)?.bullet) blocks.at(-1).text += '\n' + text;
      else blocks.push({text, bullet});
    }
    if (blocks.length) out.push([top ? heading : '#' + heading, ...blocks.map(b => b.text)].join('\n\n'));
  }
  return out.join('\n\n');
}

/** Split the core reference into {shared, native, browser}; null when the layout is unfamiliar. */
export function split(core) {
  const lines = core.replace(/\n+$/, '').split('\n');
  if (!/^## /.test(lines[0] ?? '')) return null;
  const sections = [];
  for (const line of lines) {
    if (/^## /.test(line)) sections.push({heading: line, body: []});
    else sections.at(-1).body.push(line);
  }
  const parts = {shared: [], native: [], browser: []};
  const add = (topic, heading, unit) => {
    const list = parts[topic];
    if (list.at(-1)?.heading !== heading) list.push({heading, units: []});
    list.at(-1).units.push(unit);
  };
  let sawApi = false;
  for (const {heading, body} of sections) {
    const whole = proseClass(heading.slice(3));
    for (const unit of units(body)) {
      if (!unit.fence) { add(whole !== 'shared' ? whole : proseClass(unit.lines.join('\n')), heading, unit); continue; }
      const inner = unit.lines.slice(1, -1);
      const api = !sawApi && /^## API\s*$/.test(heading) && /^\s*```typescript/.test(unit.lines[0]);
      const byTopic = api ? splitApi(inner.join('\n')) : {shared: [], native: [], browser: []};
      if (api) sawApi = true;
      else for (const line of inner) byTopic[whole !== 'shared' ? whole : proseClass(line)].push(line);
      for (const topic of TOPICS) {
        if (byTopic[topic].some(l => l.trim())) add(topic, heading, {fence: true, lines: [unit.lines[0], ...byTopic[topic], unit.lines.at(-1)]});
      }
    }
  }
  if (!sawApi) return null;
  // Nothing may be lost or invented: every original line appears in exactly one part.
  const tally = all => { const m = new Map(); for (const l of all) { const k = l.trim(); if (k && !/^```/.test(k)) m.set(k, (m.get(k) ?? 0) + 1); } return m; };
  const have = tally(TOPICS.flatMap(t => parts[t]).flatMap(s => s.units).flatMap(u => u.lines));
  for (const [line, count] of tally(lines.filter(l => !/^## /.test(l)))) {
    const got = have.get(line) ?? 0;
    // The opening and closing lines of the split entry-point declaration repeat in each part.
    if (got < count || (got > count && !OPENER.test(line) && !CLOSER.test(line))) return null;
  }
  const note = '> Context profile: this is the part of the reference that applies to every surface. The part for native apps or for browsers is added automatically the first time you use that surface. `await cua.documentation("full")` prints the complete original reference.';
  return {
    shared: render(parts.shared, true) + '\n\n' + note + '\n',
    native: parts.native.length ? '## Reference: native apps\n\n' + render(parts.native, false) + '\n' : '',
    browser: parts.browser.length ? '## Reference: browsers and tabs\n\n' + render(parts.browser, false) + '\n' : '',
  };
}

/** Drop the paragraphs, list items and code lines of a text that are only about the given surfaces. */
export function without(text, topics) {
  const blocks = [];
  for (const unit of units(text.split('\n'))) {
    const lines = unit.fence ? unit.lines.slice(1, -1).filter(line => !topics.includes(proseClass(line)))
      : topics.includes(proseClass(unit.lines.join('\n'))) ? [] : unit.lines;
    if (!lines.length) continue;
    const body = (unit.fence ? [unit.lines[0], ...lines, unit.lines.at(-1)] : lines).join('\n');
    const bullet = !unit.fence && /^- /.test(unit.lines[0]);
    if (bullet && blocks.at(-1)?.bullet) blocks.at(-1).text += '\n' + body;
    else blocks.push({text: body, bullet});
  }
  return blocks.map(b => b.text).join('\n\n');
}

/** The first text the runtime prints is the core reference followed by other documents (level-1 headings). */
export function separate(text) {
  if (!/^## Computer Use\b/.test(text)) return null;
  const cut = text.search(/\n# \S/);
  return cut < 0 ? {core: text, rest: ''} : {core: text.slice(0, cut + 1), rest: text.slice(cut + 1)};
}

export default function create({env = process.env} = {}) {
  if (env.CUA_PROXY_DOCS === 'off') return null;
  const sessions = new Map();   // session id -> {parts, core, shown, ever, ready}
  let cached = null;
  const partsOf = core => (cached?.core === core ? cached : (cached = {core, parts: split(core)})).parts;
  // Surfaces that are switched off for this launch never need describing at all.
  const enabled = (env.CUA_REPL_ENABLED_SURFACES ?? 'browser,computer').split(',').map(s => s.trim());
  const disabled = [...(enabled.includes('browser') ? [] : ['browser']), ...(enabled.includes('computer') ? [] : ['native'])];
  return {
    name: 'docs',
    banner: BANNER,
    tools(list) {
      if (!disabled.length) return list;
      return list.map(tool => tool.name === 'js' && typeof tool.description === 'string'
        ? {...tool, description: without(tool.description, disabled)} : tool);
    },
    afterCall(call, result) {
      if (!Array.isArray(result?.content)) return result;
      const texts = result.content.filter(item => item?.type === 'text' && typeof item.text === 'string');
      let state = sessions.get(call.session);
      // The in-runtime half announces itself. Without it nothing here could deliver the deferred
      // parts, so the reference is then left exactly as the runtime printed it.
      const ready = state?.ready || texts.some(item => item.text.includes('<<cua-proxy:docs:ready>>'));
      const replaced = new Map();
      for (const item of texts) {
        const pieces = ready && separate(item.text);
        const parts = pieces && partsOf(pieces.core);
        if (!parts) continue;
        state = {parts, core: pieces.core, shown: new Set(), ever: state?.ever ?? new Set(), ready: true};
        sessions.set(call.session, state);
        replaced.set(item, parts.shared + (pieces.rest ? '\n' + pieces.rest : ''));
      }
      const expand = (marker, topic, forced) => {
        if (topic === 'ready') return '';
        if (!state) return forced ? '\nThe reference has not been captured in this session. Call await cua.rewriteDocumentation() first.\n' : '';
        const show = [];
        if (topic === 'again') show.push(...[...state.ever].filter(t => !state.shown.has(t)));
        else if (topic === 'full' && forced) return '\n' + state.core + '\n';
        else if (topic === 'native' || topic === 'browser') { if (forced || !state.shown.has(topic)) show.push(topic); state.ever.add(topic); }
        else return forced ? '\nUnknown documentation topic. Use "native", "browser" or "full".\n' : '';
        for (const t of show) state.shown.add(t);
        return show.map(t => state.parts[t]).filter(Boolean).map(text => '\n' + text).join('');
      };
      const content = [];
      for (const item of result.content) {
        if (!texts.includes(item)) { content.push(item); continue; }
        const text = (replaced.get(item) ?? item.text).replace(SENTINEL, expand);
        if (text === item.text) content.push(item);
        else if (text.trim()) content.push({...item, text: text.replace(/^\n+/, '')});
      }
      return {...result, content};
    },
  };
}
