import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync, readdirSync, readFileSync} from 'node:fs';
import create, {split, separate, without} from '../filters/docs.mjs';

// A synthetic reference with the vendor's layout; no vendor text is kept in this repository.
const CORE = `## Computer Use

Control native apps and browsers.

- Use the runtime for all UI actions.
- If you create a tab or get an app, state is included.

## API

\`\`\`typescript
type Vec2 = [x: number, y: number];
type Flag = { on?: boolean }; // Windows only
type AppClickOptions = Flag;
interface Target {
  click(target: number | Vec2): Promise<void>;
}

type AppInfo = { id: string };

interface App extends Target {
  // Type at current focus.
  typeText(text: string): Promise<void>;
}

type BrowserInfo = {
  id: string;
};

/** Tabs take an element index first. */
interface Tab extends Target {
  typeText(index: number | null, text: string): Promise<void>;
}

declare const cua: {
  getState(): Promise<void>;
  computer: {
    target: "mac";
  };

  // Pass an app name.
  getApp(target: string): Promise<App>;
  /** Bind an existing tab. */
  getTab(
    reference: string,
  ): Promise<Tab>;
};
\`\`\`

MCP App tabs support DOM interaction.

## Native apps

Use \`cua.getApp("Example App")\`.

## Workflow

After actions call \`getAXState()\`.

- Batch actions.
- For \`chrome://newtab\` the tab shows metadata only.

\`\`\`typescript
await target.click(42);
await tab.typeText(42, "hello");
\`\`\`

## Notes

- For browser tabs, \`typeText\` takes an index.
- macOS app \`paste\` restores the clipboard.
- \`pressKey()\` takes keys such as \`"Return"\` and \`"Tab"\`.
- For native apps and tabs, prefer element indices.

Persist until done.
`;
const POLICY = '# Confirmations Policy\n\nAlways confirm purchases.\n';

test('every line lands in exactly one part, in its original wording', () => {
  const parts = split(CORE);
  const lines = text => text.split('\n').map(l => l.trim()).filter(Boolean);
  const all = [...lines(parts.shared), ...lines(parts.native), ...lines(parts.browser)];
  for (const line of lines(CORE)) if (!line.startsWith('## ')) assert.ok(all.includes(line), `lost: ${line}`);
  const has = (part, text) => assert.ok(parts[part].includes(text), `${part} lacks: ${text}`);
  const lacks = (part, text) => assert.ok(!parts[part].includes(text), `${part} has: ${text}`);
  for (const text of ['type Vec2', 'type Flag', 'interface Target', 'getState(): Promise<void>;', 'Batch actions', 'await target.click(42);',
    '`pressKey()` takes keys', 'For native apps and tabs', 'Persist until done.', 'Control native apps and browsers.']) has('shared', text);
  for (const text of ['type AppClickOptions', 'type AppInfo', 'interface App extends', '// Type at current focus.', 'computer: {', '// Pass an app name.',
    'getApp(target: string)', 'Use `cua.getApp("Example App")`.', 'macOS app `paste`']) { has('native', text); lacks('shared', text); }
  for (const text of ['type BrowserInfo', '/** Tabs take an element index first. */', 'interface Tab extends', '/** Bind an existing tab. */',
    'reference: string,', 'MCP App tabs', 'chrome://newtab', 'await tab.typeText(42, "hello");', 'For browser tabs']) { has('browser', text); lacks('shared', text); lacks('native', text); }
  assert.match(parts.native, /declare const cua: \{\n  computer: \{/);
});

test('unfamiliar text is left alone', () => {
  assert.equal(split('Just some text.'), null);
  assert.equal(split('## Computer Use\n\nNo API section here.\n'), null);
  assert.equal(separate('Window: "Desktop", App: Finder.'), null);
});

const item = text => ({type: 'text', text});
const texts = result => result.content.map(c => c.text);
const mark = topic => `<<cua-proxy:docs:${topic}>>`;

test('the first result shows the shared part; a surface part appears once, on first use', () => {
  const filter = create({env: {}}), call = {session: 'S'};
  const first = filter.afterCall(call, {content: [item(CORE + '\n' + POLICY), {type: 'image', data: 'x'}, item(mark('ready') + mark('native'))]});
  assert.ok(first.content[0].text.startsWith('## Computer Use'));
  assert.ok(first.content[0].text.endsWith(POLICY));
  assert.ok(!first.content[0].text.includes('interface App'));
  assert.equal(first.content[1].type, 'image');
  assert.ok(first.content[2].text.startsWith('## Reference: native apps'));
  assert.deepEqual(texts(filter.afterCall(call, {content: [item('state'), item('note ' + mark('native') + ' end')]})), ['state', 'note  end']);
  assert.deepEqual(filter.afterCall(call, {content: [item(mark('native'))]}).content, []);
  assert.ok(texts(filter.afterCall(call, {content: [item(mark('browser'))]}))[0].startsWith('## Reference: browsers and tabs'));
});

test('cua.documentation and cua.rewriteDocumentation', () => {
  const filter = create({env: {}}), call = {session: 'S'};
  filter.afterCall(call, {content: [item(CORE), item(mark('ready') + mark('native'))]});
  assert.equal(texts(filter.afterCall(call, {content: [item(mark('full!'))]}))[0].trimEnd(), CORE.trimEnd());
  assert.ok(texts(filter.afterCall(call, {content: [item(mark('native!'))]}))[0].startsWith('## Reference: native apps'));
  assert.match(texts(filter.afterCall(call, {content: [item(mark('bogus!'))]}))[0], /Unknown documentation topic/);
  const again = texts(filter.afterCall(call, {content: [item(CORE), item(mark('again'))]}));
  assert.ok(again[0].startsWith('## Computer Use') && again[1].startsWith('## Reference: native apps') && again.length === 2);
});

test('without the in-runtime half the reference stays exactly as printed', () => {
  const filter = create({env: {}});
  const result = {content: [item(CORE + '\n' + POLICY)]};
  assert.deepEqual(filter.afterCall({session: 'S'}, result), result);
  assert.equal(create({env: {CUA_PROXY_DOCS: 'off'}}), null);
  assert.equal(filter.afterCall({session: 'S'}, undefined), undefined);
});

const DOCS = ['/Applications/ChatGPT.app', '/Applications/Codex.app'].map(app => app + '/Contents/Resources/cua_node/lib/node_modules/@oai/cua/docs').find(existsSync);
test('the installed desktop app\'s own reference is recognised', {skip: !DOCS && 'desktop app not installed'}, () => {
  const files = readdirSync(DOCS).filter(f => /core-cua-repl/.test(f));
  assert.ok(files.length > 0);
  for (const file of files) {
    const core = readFileSync(`${DOCS}/${file}`, 'utf8'), parts = split(core);
    assert.ok(parts, `${file}: layout not recognised`);
    assert.ok(parts.shared.length < core.length * 0.75, `${file}: nothing was deferred`);
    assert.ok(parts.browser.includes('interface Tab') && !parts.shared.includes('interface Tab'));
  }
});

test('with a surface switched off, the tool description loses the parts that are only about it', () => {
  const description = ['Control native apps or browsers.', '', 'Use the entry point below:', '', '```javascript', 'await cua.getState();', '```', '',
    'For a tab mention:', 'Pass the URL to get the referenced tab.', '', '```javascript', 'let tab = await cua.getTab({ mention });', '```', '',
    'Browser IDs and options:', '', '- `"iab"` (in-app browser): use `visible: true`.', '- `"chrome"`: pass a `sessionName` to `createBrowserTab`.', '',
    'If the user specifies an app to use, get the app by name:', '', '```javascript', 'let app = await cua.getApp("Example App");', '```', '',
    'To add other content use `nodeRepl.write(value)`.'].join('\n');
  const trimmed = without(description, ['browser']);
  for (const kept of ['Control native apps or browsers.', 'await cua.getState();', 'let app = await cua.getApp("Example App");', 'nodeRepl.write']) assert.ok(trimmed.includes(kept), kept);
  for (const gone of ['getTab', 'iab', 'createBrowserTab', 'Browser IDs', 'tab mention']) assert.ok(!trimmed.includes(gone), gone);
  assert.equal(without(trimmed, ['browser']), trimmed);
  const js = {name: 'js', description}, other = {name: 'js_reset', description: 'This does not close browser tabs.'};
  assert.deepEqual(create({env: {CUA_REPL_ENABLED_SURFACES: 'browser,computer'}}).tools([js, other]), [js, other]);
  const [a, b] = create({env: {CUA_REPL_ENABLED_SURFACES: 'computer'}}).tools([js, other]);
  assert.equal(a.description, trimmed);
  assert.equal(b, other);
});
