#!/bin/sh
# install.sh             copy the proxy to ~/.local/share/cua-proxy
# install.sh codex       ...and have the Codex desktop app start it (now and after every login)
# install.sh uninstall   undo both
set -eu
here=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)
dest=${CUA_PROXY_HOME:-$HOME/.local/share/cua-proxy}
agent=$HOME/Library/LaunchAgents/io.github.cua-proxy.environment.plist
case ${1:-install} in
  install|codex)
    mkdir -p "$dest/filters" "$dest/filters.d"
    cp "$here/proxy.mjs" "$here/node-repl" "$dest/"
    cp "$here/filters/docs.mjs" "$dest/filters/"
    chmod 755 "$dest/node-repl"
    echo "installed: $dest"
    [ "${1:-install}" = codex ] || exit 0
    [ "$(uname)" = Darwin ] || { echo "automatic activation is only implemented for macOS; set CODEX_NODE_REPL_PATH=$dest/node-repl in the environment the app starts from" >&2; exit 1; }
    # The desktop app starts whatever CODEX_NODE_REPL_PATH names instead of its own node_repl.
    # launchctl sets it for this login session; the agent below sets it again at each login.
    previous=$(launchctl getenv CODEX_NODE_REPL_PATH || true)
    [ "$previous" = "$dest/node-repl" ] || printf '%s' "$previous" > "$dest/previous-override"
    launchctl setenv CODEX_NODE_REPL_PATH "$dest/node-repl"
    mkdir -p "$(dirname -- "$agent")"
    cat > "$agent" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>io.github.cua-proxy.environment</string>
  <key>ProgramArguments</key><array>
    <string>/bin/launchctl</string><string>setenv</string><string>CODEX_NODE_REPL_PATH</string><string>$dest/node-repl</string>
  </array>
  <key>RunAtLoad</key><true/>
</dict></plist>
PLIST
    echo "The Codex desktop app uses the proxy from its next start: quit it and open it again."
    ;;
  uninstall)
    if [ "$(launchctl getenv CODEX_NODE_REPL_PATH 2>/dev/null || true)" = "$dest/node-repl" ]; then
      previous=$(cat "$dest/previous-override" 2>/dev/null || true)
      if [ -n "$previous" ] && [ -x "$previous" ]; then launchctl setenv CODEX_NODE_REPL_PATH "$previous"; else launchctl unsetenv CODEX_NODE_REPL_PATH; fi
    fi
    rm -f "$agent"
    rm -rf "$dest"
    echo "removed: $dest (the Codex desktop app returns to its own runtime at its next start)"
    ;;
  *) echo "usage: install.sh [install | codex | uninstall]" >&2; exit 64 ;;
esac
