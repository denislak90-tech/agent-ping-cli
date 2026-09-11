# Contributing to agent-ping

Thanks for helping! Small, focused PRs beat big ones.

## Prerequisites

- **npm CLI** (`bin/`, `lib/`): Node.js 16+, zero runtime dependencies
- **Native scripts** (`scripts/`): Windows PowerShell 5.1+ or PowerShell 7+ for `*.ps1`; `bash` + `curl` + `python3` for `notify.sh`
- `curl` on PATH for the PowerShell scripts. ntfy account not needed (topics are just secret strings)
- Never put real ntfy topics, message IDs, or `state/` contents in issues, PRs, or commits â€” CI secret-scans and will fail the build

## Setup

```bash
git clone https://github.com/YOU/agent-ping.git
cd agent-ping
cp config.example.json config.json
# fill in two throwaway test topics (openssl rand -hex 16)
```

## Running tests

```bash
node --test tests/*.test.js   # npm CLI (lib/common.js) - cross-platform
```

```powershell
.\tests\smoke.ps1             # PowerShell scripts (scripts/common.ps1)
```

Both must pass before opening a PR that touches `lib/`, `bin/`, or `scripts/`. CI runs both on every push (Node on Linux/Windows/macOS, PowerShell on Windows).

## Branch / commit / PR flow

1. Fork, then `git checkout -b feat/short-name` (or `fix/â€¦`, `docs/â€¦`)
2. Conventional commits: `feat: â€¦`, `fix: â€¦`, `docs: â€¦`, `chore: â€¦`, `test: â€¦`
3. Keep scripts ASCII-only (Windows console encoding mangles non-ASCII); build emoji from code points as in `notify.ps1` / `lib/common.js`
4. Run the relevant automated tests (see above), then test manually end-to-end with your test topics: `notify` â†’ `ask` â†’ `watch` (npm CLI) or `notify.ps1` â†’ `ask-decision.ps1` â†’ `watch-reply.ps1` (PowerShell); paste the `RESPONSE_RECEIVED` / `OPTION=` output in the PR
5. If you change `lib/common.js` or `scripts/common.ps1`, check whether the equivalent change is also needed in the other implementation â€” they share the same state/config format and are expected to interoperate
6. Open a PR with the template: summary, linked issue, test plan. One human review required (see CODEOWNERS)

## What to update with code changes

- `README.md` quickstart if flags/behaviour change
- `AGENTS.md` if agent call conventions change
- `CHANGELOG.md` under Unreleased (maintainer moves to release on tag)

## Code of conduct / security

- Be kind: [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md)
- Found a vulnerability? **Do not open a public issue** â€” see [SECURITY.md](SECURITY.md)
