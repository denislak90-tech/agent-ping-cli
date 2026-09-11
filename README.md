# agent-ping — phone-tap approvals for coding agents

[![CI](https://github.com/YOU/agent-ping/actions/workflows/ci.yml/badge.svg)](https://github.com/YOU/agent-ping/actions/workflows/ci.yml)
[![Secret scan](https://github.com/YOU/agent-ping/actions/workflows/gitleaks.yml/badge.svg)](https://github.com/YOU/agent-ping/actions/workflows/gitleaks.yml)
[![npm version](https://img.shields.io/npm/v/agent-ping-cli.svg)](https://www.npmjs.com/package/agent-ping-cli)
[![npm downloads](https://img.shields.io/npm/dm/agent-ping-cli.svg)](https://www.npmjs.com/package/agent-ping-cli)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)
[![ntfy.sh](https://img.shields.io/badge/powered%20by-ntfy.sh-blue)](https://ntfy.sh)

Get a push on your phone when your agent needs you. Tap **A / B / C** — the agent auto-resumes. Built for makers who step away from the keyboard.

> **Why this exists:** Long-running coding-agent sessions increasingly need a human to approve, reject, or pick between options — merge this? ship this version? which of these three fixes? — without staying glued to a terminal. agent-ping gives *any* agent tool a small, auditable way to ask a human on their phone and get a verified answer back, over open, self-hostable [ntfy.sh](https://ntfy.sh). No vendor lock-in, no server to run, MIT-licensed.

- Two implementations, one shared state format: a zero-dependency **npm CLI** (`npx agent-ping-cli`, works anywhere Node runs) and native **PowerShell scripts** (no Node required). Mix and match — ask from one, watch from the other.
- Agents just call a command and read stdout (`DECISION_ID=…`, `RESPONSE_RECEIVED`, `OPTION=…`)
- One pending decision at a time, waiting queue, expiry, exactly-once replies, file-locked state for concurrent runs
- Queue promotion is retried after a decision resolves; if a promotion send fails, the queued decision stays queued and is retried on the next ask/watch call
- Private by design: real ntfy topics live in your local config (git-ignored), never in the repo — CI secret-scans every push

## Quickstart (5 min)

1. Pick two random secret topics (e.g. `openssl rand -hex 16` twice): one your phone subscribes to, one for reply buttons.

### Option A — npm CLI (Node, any OS)

```bash
export AGENT_PING_OUTBOUND_TOPIC=your-outbound-topic
export AGENT_PING_REPLY_TOPIC=your-reply-topic

npx agent-ping-cli notify --title "hello" --message "it works"

npx agent-ping-cli ask --task "deploy" --question "Ship v1.0 now?" --options "Ship,Hold,Changelog first"
npx agent-ping-cli watch --duration 300
# tap A/B/C on your phone -> OPTION=<choice>, exit 0
```

### Option B — native PowerShell (Windows, no Node)

```powershell
cp config.example.json config.json   # fill in your two topics

.\scripts\notify.ps1 -Title "hello" -Message "it works"

.\scripts\ask-decision.ps1 -TaskName "deploy" -Question "Ship v1.0 now?" -Options "Ship,Hold,Changelog first"
.\scripts\watch-reply.ps1 -DurationSeconds 300
```

One-way ping only, no Node/PowerShell? Use `scripts/notify.sh` (needs `bash`, `curl`, `python3`).

## Documentation

- [CONTRIBUTING.md](CONTRIBUTING.md) — setup, branch/PR flow, conventional commits
- [AGENTS.md](AGENTS.md) — how coding agents should call this (Node CLI or PowerShell)
- [SECURITY.md](SECURITY.md) — supported versions + private reporting (no public vuln issues)
- [SUPPORT.md](SUPPORT.md) — where to ask
- [CHANGELOG.md](CHANGELOG.md) — release history (Keep a Changelog)
- [Code of Conduct](CODE_OF_CONDUCT.md) — Contributor Covenant

## Maintainer story

This exists to remove a specific piece of maintainer grind: gating a risky automated action on an explicit human decision — release sign-off, merge approval, escalation triage — without stopping work to babysit a terminal. It's intentionally tool-agnostic (Codex, OpenCode, Claude Code, Cline, or any script that can shell out to a CLI) and dependency-light: the npm CLI ships with zero runtime dependencies, and the native scripts need only `curl`. Both implementations read and write the exact same state file format, so they interoperate — ask from a CI runner via Node, watch from a desktop via PowerShell, no translation needed.

If this earns real usage, next on the list: structured audit logs for maintainer review, an interactive `--dry-run` mode for testing without spending a real notification, and a Python/Go port of the same state format once there's a concrete user asking for it.

## Privacy

Real ntfy topics and `state/` are git-ignored and secret-scanned. Never commit real topics, message IDs, or decision history. Publish code + docs only.

> **Security Warning:** Never commit real `ntfy` topics or tokens. Treat topic names as credentials because anyone who knows a topic may be able to publish or subscribe to it, depending on its configuration.

## License

MIT — see [LICENSE](LICENSE).

## Publishing

The repository is published separately from npm. To push from a local machine, use `tools/publish.ps1`. It reads `GITHUB_TOKEN` or prompts securely; it never writes the token to disk. The token must be fine-grained, limited to this repository, with **Contents: Read and write**.

Revoke any token that has been pasted into chat, logs, issues, or shell history.
