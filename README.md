# CUA context profile

Progressively load Computer Use documentation: a compact entry guide first,
then automatically load the relevant native/browser reference when a binding is selected. This is an independent,
experimental integration for the CUA runtime bundled with the Codex desktop app
(including distributions named ChatGPT.app).

## Scope

The adapter reads the **controlled computer's** `cua.computer.target` and the
initialized surfaces. It selects macOS, Linux or Windows instructions without
assuming the JavaScript host and controlled computer are the same machine.
Browser-only sessions need no native OS. Unknown targets, missing capabilities
or unrecognized documentation layouts retain the complete original text.

Package installers are provided for macOS and Windows. The splitting logic covers
all three target OS families and is tested with synthetic target/provider fixtures.
Native Windows/Linux UI operation remains a separate verification step; installing
this profile does not provision a new CUA engine or enable unavailable app features.

This repository contains our adapter, profile and synthetic tests, under MIT.
It does not include OpenAI executables, copied packages, vendor documentation,
local settings, tool transcripts, or credentials. Users need their own installed
CUA-capable desktop app and the permissions required by that app.

## Install

### macOS

Requirements: Python 3 and a CUA-capable Codex/ChatGPT app bundle.
Preparation copies the user's local CUA package outside the signed app and applies
only the documentation adapter. It does not edit the app bundle or activate itself.

```sh
python3 install.py --app /Applications/Codex.app
# Use /Applications/ChatGPT.app if that is your installed bundle.
python3 activate.py
```

`--app` can be omitted for common system/user Applications locations. Use
`--dest PATH` on both commands for a custom installation directory. Quit and reopen
the desktop app normally after activation. The override lasts for the current login
session; activate again after logging in. No background daemon is installed.

To restore the previous desktop override:

```sh
python3 activate.py --restore
```

### Windows

Requirements: Python 3, a CUA-capable installed desktop app, and the Windows .NET
Framework compiler (`Framework64/v4.0.30319/csc.exe`). The launcher is compiled
locally; no OpenAI executables are distributed by this repository.

From PowerShell in this repository, pass the installed directory containing
`resources/cua_node/bin/node_modules/@oai/cua`:

```powershell
python install_windows.py --app 'C:\path\to\installed\app'
python test_windows_wrapper.py
python activate_windows.py
```

Preparation validates the bundled documentation before copying the package and
does not activate the overlay. Activation sets `CODEX_NODE_REPL_PATH` in the
current user's environment and broadcasts the environment change. Run activation
in the interactive Windows session so Explorer receives that broadcast. Close and
reopen Codex afterward. A launch from an already-open terminal may retain its old
environment; open a new terminal or sign out/in when necessary. Unlike macOS
activation, this user setting persists across sign-ins.

`--dest PATH` is supported by both Windows commands. Existing installation
directories and other configured overrides are preserved. Restore with:

```powershell
python activate_windows.py --restore
```

The installed directory also contains `activate_windows.py` for recovery.

For a compatible external MCP launcher, explicitly set `CUA_REPL_NODE_REPL_PATH`
to the installed `node-repl` wrapper. The [Claude bridge](https://github.com/ksmkzs/claude-cua-mcp)
can use that configuration, but does not require this profile.

## Behavior and limits

The first guide contains only enabled entry points and target-specific binding
instructions. `getApp()` automatically loads that target's native reference;
`getBrowser()`, `getTab()` and `createBrowserTab()` automatically load the browser
reference. Each surface/context is emitted once, including concurrent calls.
The runtime's own browser/provider instructions remain untouched and authoritative
for DOM-only, extension, in-app browser and other provider differences.

No inventory query, app launch or browser connection is performed just to detect
capabilities. Empty inventories are not treated as disabled surfaces. Successful
provider initialization and configured surfaces determine API availability, not
whether a particular browser is currently connected or reachable.

`cua.documentation("native" | "browser" | "full")` remains available for explicit
reference requests. `cua.rewriteDocumentation()` preserves upstream behavior and
re-emits previously used references so existing bindings remain usable after compaction.
These extensions exist only when this overlay loaded; follow the actual returned
documentation. A reference-output failure occurs before binding, avoiding a false
failure after an app launch/tab creation that might otherwise be retried.

Approval instructions and app-specific instructions remain upstream-controlled.
The adapter does not modify input, IPC, permissions, or lifecycle behavior.
It does not fix native cursor persistence or isolate concurrent UI operators.

The wrapper hashes the source files and bundle metadata recorded at installation.
If they change, it falls back to the stock runtime. A matching layout alone is not
a guarantee of semantic compatibility. Reinstallation requires review of changed
upstream instructions; do not blindly refresh hashes to suppress a failure.

## Tests

```sh
npm test
python3 -m unittest discover -s tests
# On Windows, also test the locally compiled launcher:
python test_windows_wrapper.py
# Optional local reference check (uses your installed files, never uploads them):
CUA_PACKAGE=/path/to/cua_node/lib/node_modules/@oai/cua node test_profile.mjs
```

Default tests use authored synthetic documentation and temporary directories;
no installed app, GUI session, or user profile is needed. The local check prints
character counts, not token savings or billing estimates. Tests do not establish
that the desktop host selected the overlay; confirm that in a new CUA session.

## Automatic update PRs

GitHub Actions checks the public production desktop appcast every six hours and
can also be run manually. A changed release creates or refreshes one Draft PR
updating `upstream/observed.json`. Offline tests run in the same workflow before
the PR is published. Unchanged feeds create no commits or PRs.

These PRs report new releases, **not automatic compatibility certification or
arbitrary code repair**. Runtime/UI checks remain manual. Local guard hashes are
never automatically relaxed. The public production feed may differ from staged,
internal, or beta releases offered to a particular account.

Repository setting required: Actions → General → Workflow permissions → allow
GitHub Actions to create pull requests. The workflow uses the repository-scoped
`GITHUB_TOKEN`; no personal token or OpenAI API key is needed. Public forks do not
receive write credentials in tests. Scheduled jobs are subject to GitHub scheduling
and inactivity policies; this is periodic detection, not a real-time guarantee.

Sources: [Codex changelog](https://learn.chatgpt.com/docs/changelog),
[production appcast](https://persistent.oaistatic.com/codex-app-prod/appcast.xml),
[GitHub workflow permissions](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/enabling-features-for-your-repository/managing-github-actions-settings-for-a-repository).
