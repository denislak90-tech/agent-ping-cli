# Contributing to agent-ping

Thanks for helping! Small, focused PRs beat big ones.

## Prerequisites

- **npm CLI** (`bin/`, `lib/`): Node.js 18+, zero runtime dependencies
- **Native scripts** (`scripts/`): Windows PowerShell 5.1+ or PowerShell 7+ for `*.ps1`; `bash` + `curl` + `python3` for `notify.sh`
- `curl` on PATH for the PowerShell scripts. ntfy account not needed (topics are just secret strings)
- Never put real ntfy topics, message IDs, or `state/` contents in issues, PRs, or commits - CI secret-scans and will fail the build

## Setup

```bash
git clone https://github.com/denislak90-tech/agent-ping-cli.git
cd agent-ping-cli
cp config.example.json config.json
# fill in two throwaway test topics (openssl rand -hex 16)
```

## Running tests

```bash
node --test tests/smoke.test.js   # npm CLI (lib/common.js) - cross-platform
```

```powershell
.\tests\smoke.ps1             # PowerShell scripts (scripts/common.ps1)
```

Both must pass before opening a PR that touches `lib/`, `bin/`, or `scripts/`. CI runs both on every push (Node on Linux/Windows/macOS, PowerShell on Windows).

## Branch / commit / PR flow

1. Fork, then `git checkout -b feat/short-name` (or `fix/...`, `docs/...`)
2. Conventional commits: `feat: ...`, `fix: ...`, `docs: ...`, `chore: ...`, `test: ...`
3. Keep scripts ASCII-only (Windows console encoding mangles non-ASCII); build emoji from code points as in `notify.ps1` / `lib/common.js`
4. Run the relevant automated tests (see above), then test manually end-to-end with your test topics: `notify` -> `ask` -> `watch` (npm CLI) or `notify.ps1` -> `ask-decision.ps1` -> `watch-reply.ps1` (PowerShell); paste the `RESPONSE_RECEIVED` / `OPTION=` output in the PR
5. If you change `lib/common.js` or `scripts/common.ps1`, check whether the equivalent change is also needed in the other implementation - they share the same state/config format and are expected to interoperate
6. Open a PR with the template: summary, linked issue, test plan. One human review required (see CODEOWNERS)

## What to update with code changes

- `README.md` quickstart if flags/behaviour change
- `AGENTS.md` if agent call conventions change
- `CHANGELOG.md` under Unreleased (maintainer moves to release on tag)

## Code of conduct / security

- Be kind: [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md)
- Found a vulnerability? **Do not open a public issue** - see [SECURITY.md](SECURITY.md)
