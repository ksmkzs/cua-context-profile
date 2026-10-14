# CUA context profile

Progressively load Computer Use documentation: a compact entry guide first,
then native/browser reference only when needed. This is an independent,
experimental integration for the CUA runtime bundled with the Codex desktop app
(including distributions named ChatGPT.app).

## Scope

The approach—small entry instructions, task-specific reference, bounded observations,
and fresh state after compaction—is reusable across installations. The included
runtime adapter currently supports **macOS**. On other platforms the profile
returns the original documentation. It does not implement a new CUA engine.

This repository contains our adapter, profile and synthetic tests, under MIT.
It does not include OpenAI executables, copied packages, vendor documentation,
local settings, tool transcripts, or credentials. Users need their own installed
CUA-capable desktop app and the permissions required by that app.

## Install

Requirements: macOS, Python 3, and a CUA-capable Codex/ChatGPT app bundle.
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

For a compatible external MCP launcher, explicitly set `CUA_REPL_NODE_REPL_PATH`
to the installed `node-repl` wrapper. The [Claude bridge](https://github.com/ksmkzs/claude-cua-mcp)
can use that configuration, but does not require this profile.

## Behavior and limits

The compact guide points to `cua.documentation("native")`, `"browser"`, and
`"full"`. These are adapter-provided APIs, available only when the overlay is
actually active. Read the documentation returned by the runtime; never assume the
overlay loaded. `cua.rewriteDocumentation()` remains the post-compaction entry.

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
