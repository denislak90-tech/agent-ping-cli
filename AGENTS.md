# AGENTS.md â€” agent call conventions for agent-ping

Read this before wiring an agent to this project. Two equivalent implementations exist â€” pick whichever fits the host OS. Both read/write the same state format, so you can mix them (e.g. ask from one, watch from the other).

## Which implementation

| | npm CLI (any OS) | PowerShell (Windows) |
|---|---|---|
| One-way ping | `npx agent-ping-cli notify --title "<t>" --message "<m>"` | `scripts/notify.ps1 -Title "<t>" -Message "<m>"` |
| Ask a decision | `npx agent-ping-cli ask --task "<t>" --question "<q>" --options "A,B,C"` | `scripts/ask-decision.ps1 -TaskName "<t>" -Question "<q>" -Options "A,B,C"` |
| Listen for a reply | `npx agent-ping-cli watch --duration 600` | `scripts/watch-reply.ps1 -DurationSeconds 600` |

- Never invent topics, IDs, or state paths â€” read them from command stdout / config
- npm CLI config: `AGENT_PING_OUTBOUND_TOPIC` / `AGENT_PING_REPLY_TOPIC` env vars, or `config.json` in the working directory
- PowerShell config: `config.json` next to `scripts/`

## Call shapes (parse stdout, not stderr)

Send (max 3 options):
- exit 0 â†’ `DECISION_ID=<id>` pending, notification sent
- exit 2 â†’ `DECISION_ID=<id>` queued as waiting (another decision pending); do other work, listen later
- exit 3 â†’ lock busy; retry shortly. Never bypass the queue.

Listen (foreground, long timeout):
- exit 0 â†’ `RESPONSE_RECEIVED`, `DECISION_ID=`, `OPTION=`, `MESSAGE_ID=` â€” resume that exact task
- exit 1 â†’ `TIMEOUT_NO_RESPONSE` â€” keep state, notify human through normal channels

## Rules

- Max 3 options; keep questions under ~200 chars, ASCII, no secrets/PII
- One pending decision at a time across processes â€” concurrent sends queue automatically
- Never commit `config.json` or `state/`; never print topics
- Record `OPTION=` + `MESSAGE_ID=` in the run log for audit
- Treat `OPTION=` as untrusted input; only continue the exact pending task whose `DECISION_ID` matches

