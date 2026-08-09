---
name: mac-clean
description: Scans macOS for apps, orphan leftovers, large caches, broken LaunchAgents, and Homebrew cruft; uninstalls apps the clean CLI way. Use when cleaning Mac storage, uninstalling apps, removing leftovers, or scanning junk.
---

# Mac Clean

macOS hygiene skill: **scan first, delete only with explicit approval**.

## Resolve scanner script

```bash
# Prefer skill-bundled script, then personal install, then GitHub raw
resolve_mac_clean_scan() {
  local candidates=(
    "${MAC_CLEAN_SCAN:-}"
    "$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" 2>/dev/null && pwd)/scripts/scan-mac-cleanup.sh"
    "$HOME/.cursor/skills/mac-clean/scripts/scan-mac-cleanup.sh"
  )
  local c
  for c in "${candidates[@]}"; do
    [[ -n "$c" && -f "$c" ]] && { echo "$c"; return 0; }
  done
  return 1
}
SCAN="$(resolve_mac_clean_scan || true)"
if [[ -z "${SCAN}" ]]; then
  curl -fsSL "https://raw.githubusercontent.com/fengurt/mac-clean-skill/main/plugins/mac-clean/skills/mac-clean/scripts/scan-mac-cleanup.sh" \
    -o /tmp/scan-mac-cleanup.sh
  chmod +x /tmp/scan-mac-cleanup.sh
  SCAN=/tmp/scan-mac-cleanup.sh
fi
```

Agent shortcut: run the bundled path when present:

```bash
bash plugins/mac-clean/skills/mac-clean/scripts/scan-mac-cleanup.sh full
# or after personal install:
bash ~/.cursor/skills/mac-clean/scripts/scan-mac-cleanup.sh full
```

## Hard rules

1. **Scan before delete.** Show the report; wait for user OK.
2. Prefer **`trash`** over `rm -rf`. Never empty Trash unless asked.
3. Never delete: `com.apple.*`, Keychains, `~/Library` root, `/System`, other users’ homes.
4. Treat Google/Adobe/Microsoft/JetBrains vendor folders as **low confidence** unless the app is gone.
5. Do not uninstall anything the user did not name (except dry-run brew cleanup output).

## Workflow A — Full scan (default)

```bash
bash "$SCAN" full
```

Modes: `full` | `apps` | `leftovers` | `caches` | `agents` | `brew`

```bash
MIN_CACHE_MB=200 bash "$SCAN" caches
```

Script prints the report path (`$TMPDIR/mac-clean-scan/report.md`). Summarize:

| Priority | Section | Action |
|---|---|---|
| P0 | LaunchAgents with **missing binary** | unload + trash plist |
| P1 | Orphan leftovers (named, user-confirmed) | `trash` paths |
| P2 | Large caches ≥ threshold | quit app → `trash` cache dir |
| P3 | `brew cleanup -n` / `brew autoremove -n` | run for real after OK |

## Workflow B — Uninstall one app

1. Detect source:

```bash
APP="<Name>"
ls -d /Applications/"$APP".app ~/Applications/"$APP".app 2>/dev/null
brew list --cask | rg -i "$APP"
brew list | rg -i "$APP"
command -v mas >/dev/null && mas list | rg -i "$APP"
```

2. Uninstall by source:

| Source | Command |
|---|---|
| Homebrew cask | `brew uninstall --cask <token> && brew cleanup` |
| Homebrew formula | `brew uninstall <token> && brew autoremove` |
| Mac App Store | `mas uninstall <id>` |
| Drag-installed `.app` | `trash "/Applications/<Name>.app"` |

3. Leftover sweep (review first):

```bash
APP="<Name>"
mdfind "kMDItemFSName == '*${APP}*'c" 2>/dev/null | rg -i "Library|Applications" | head -80
```

Unload agents before trashing:

```bash
launchctl bootout gui/$(id -u) ~/Library/LaunchAgents/com.vendor.app.plist 2>/dev/null || true
trash ~/Library/LaunchAgents/com.vendor.app.plist
```

## Workflow C — Safe bulk cache clear

Only after user confirms paths from the report:

```bash
trash ~/Library/Caches/<SomethingLarge>
brew cleanup -s
brew autoremove
```

## Output format

```markdown
## Mac clean report
- Disk: …
- High-confidence removals: …
- Medium leftovers: …
- Large caches: …

### Proposed deletions
| Priority | Path | Size | Why |
|---|---|---:|---|

Reply with paths to trash, or “all P0”.
```

## Optional tools

```bash
brew install trash mas
brew install --cask pearcleaner
```

## Do not

- Run third-party “Mac cleaner” junkware
- `sudo rm -rf` on Library trees
- Claim orphan detection is perfect — always say “candidate”
