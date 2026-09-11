# Security Policy

## Supported versions

| Version | Supported |
| ------- | --------- |
| 1.x     | Yes       |
| 0.x (pre-release) | Best-effort |

## Reporting a vulnerability

**Do not open a public issue.** Use GitHub Security Advisories (Security tab → Report a vulnerability) or email the maintainer address listed on the GitHub profile.

Include: affected script + version/tag, reproduction steps with throwaway test topics (never your real topics), and impact. Expect acknowledgement within 72 hours and a triage update within 7 days. Coordinated disclosure: please give 30 days before public disclosure; I will credit you unless you prefer anonymity.

## Scope

In scope: command injection via `-Question`/`-Options`, reply forgery (decision ID guessing/replay), state corruption across concurrent runs, secret leakage through logs/output. Out of scope: ntfy.sh service itself (report upstream), physical phone compromise.

## Secrets hygiene

Real `config.json` topics and `state/` history must never enter the repo. CI runs secret scanning on every push and PR.
