# CUA context profile

[日本語](README.ja.md)

A small proxy that sits in front of the Computer Use (CUA) runtime shipped inside the Codex desktop app
and trims what that runtime puts into a model's context. It is not an OpenAI product.

```
Codex desktop app ─┐                      ┌─ documentation filter (this repository)
                   ├─ MCP ─ cua-proxy ────┤                                   ── MCP ─ node_repl (stock, unmodified)
Claude Code ───────┘   (stdio)            └─ filters.d/*.mjs (optional add-ons)
```

## What changes for the model

- **Reference on first use.** The runtime prints its whole reference on the first call: shared rules, the
  native-app API and the browser API together. The proxy shows the shared part at once and adds the
  native or browser part the first time that surface is actually used. The text is the vendor's own,
  verbatim; nothing is reworded. The confirmation policy that follows the reference is never touched.
- **`await cua.documentation("full" | "native" | "browser")`** prints the complete original, or one part.
  `cua.rewriteDocumentation()` keeps working and brings back the parts already in use.
- **Tool description.** When a surface is switched off for a launch (`CUA_REPL_ENABLED_SURFACES`), the
  paragraphs of the `js` tool description that are only about that surface are left out.

Measured on macOS with desktop app 26.1103 (characters):

| | stock | with the proxy |
|---|---|---|
| first call (reference + policy) | 19,915 | 14,243 |
| added on first use of a native app | – | 2,189 |
| added on first use of a browser tab | – | 3,962 |
| `js` tool description, desktop apps only | 3,237 | 1,483 |

## How it works

The stock runtime is an ordinary MCP stdio server. The proxy passes every message through byte for byte
and only looks at `tools/call` for `js` / `js_reset` and at `tools/list`. It uses three things the runtime
already offers and changes no vendor file:

1. the `NODE_REPL_JS_BANNER` environment variable (a few lines that wrap the public `cua` entry points so
   they leave a marker when a surface is first used),
2. the MCP messages themselves (the reference arrives as ordinary result text),
3. the public `cua` JavaScript API.

Because nothing is copied from the app and nothing is pinned to a build, an app update needs no reinstall.
Whatever the proxy does not recognise is passed through unchanged: a new reference layout simply shows up
in full, and if the in-runtime half is not running the reference is left exactly as printed.

A client that sends no Codex turn metadata (anything other than the Codex app) gets one session identity
per connection, and its `turn_ended` call is mapped to that identity.

## What this depends on

The runtime in current desktop app builds (checked on 26.1103) controls apps only when the program that
starts it is signed by OpenAI; started from anything else it can list apps but fails to bind one ("Sky
Computer Use native pipe startup failed"). The proxy therefore runs on the Node that ships inside the app, which is also what lets it stay in front of the runtime. That is how it works today, not a
promise: if the vendor narrows this, the proxy has to be bypassed (`CUA_PROXY=off`) until it is adapted.

## Install

Requires macOS and the Codex desktop app (`ChatGPT.app` or `Codex.app`). The proxy runs on the Node
bundled with the app.

```sh
sh install.sh codex      # install to ~/.local/share/cua-proxy and use it from the Codex desktop app
sh install.sh            # install only (for Claude Code, see claude-cua-mcp: it picks the proxy up by itself)
sh install.sh uninstall
```

`codex` sets `CODEX_NODE_REPL_PATH` for the login session and adds a LaunchAgent that sets it again at
each login. Quit and reopen the desktop app afterwards.

## Settings (environment variables)

| variable | effect |
|---|---|
| `CUA_PROXY=off` | the launcher starts the stock runtime directly |
| `CUA_PROXY_DOCS=off` | no documentation filter |
| `CUA_PROXY_TOOLS=js,js_reset,turn_ended` | tools shown to the client |

## Filters

A filter is a module in `filters.d/` whose default export returns an object with any of:
`banner` (JavaScript appended to the runtime banner), `beforeCall(call)` (may set `call.meta`, readable in
the runtime as `nodeRepl.requestMeta['cua-proxy']`, or return `{result}` to answer without the runtime),
`afterCall(call, result)`, `tools(list)` and `close()`. A filter that fails to load is skipped.
[safari-window-mcp](https://github.com/ksmkzs/safari-window-mcp) uses this to give each session its own
Safari window.

## When the desktop app is updated

The proxy runs on the environment the app passes, so nothing has to be reinstalled. A runtime started before the update, however, can no longer reach the new version's Computer Use service, and app calls fail with "Sky Computer Use native pipe startup failed". Only when the runtime's file was replaced after it started, the proxy adds a note to that error: the app was updated; reconnect the MCP server or start a new session. Whether the new version's documentation is still recognised can be checked with `sh check.sh` in [claude-cua-mcp](https://github.com/ksmkzs/claude-cua-mcp) (checked with 26.1111).

## Tests

```sh
npm test                                   # Node 22+; includes a check against the installed app when present
python3 -m unittest discover -s tests      # update watcher
```

A scheduled workflow watches the public release feed of the desktop app and opens a draft pull request
when a new build appears. It is a reminder to run `npm test` on a Mac with that build; it certifies nothing.

## Limits

Verified on macOS only. The earlier Windows launcher is not part of this version. The repository contains
no vendor code or vendor text. MIT licence.
