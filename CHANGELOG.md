# Changelog

All notable changes to this project will be documented in this file.
Format: [Keep a Changelog](https://keepachangelog.com/en/1.0.0/). Versioning: [SemVer](https://semver.org/).

## [Unreleased]

### Added
- `agent-ping-cli` npm package (`lib/common.js`, `bin/agent-ping.js`): zero-runtime-dependency Node implementation of `notify` / `ask` / `watch`, usable via `npx agent-ping-cli`. Reads and writes the exact same `config.json` / `state/decisions.json` format as the PowerShell scripts, so both implementations interoperate.
- Node smoke tests (`tests/smoke.test.js`, `node --test`) covering promotion, priority preservation, config validation, and option-count validation.
- CI: Node test matrix across ubuntu-latest, windows-latest, macos-latest.

### Fixed
- Preserve a queued decision's original `-Priority` when it is promoted (was silently downgraded to "high"). Fixed in both the PowerShell and npm implementations.
- Bound expiry minutes to a sane range (1-43200) to avoid a DateTime overflow on bad input, in both implementations.
- npm CLI now rejects unknown `--priority` values loudly (was silently falling back to a default) and rejects non-numeric `--duration` / `--expiry-minutes` (was silently misbehaving on `NaN`); CLI also rejects valueless flags that parse as booleans.
- Renamed the npm package to `agent-ping-cli` — `agent-ping` is already taken on the registry (by an unrelated VS Code sound-notification extension).
- Added `.markdownlint.json` (disables MD013 line-length) so long-form README lines can't fail CI spuriously.
- Raised the npm `engines` floor to Node >= 18 to match the stable `node:test` runner.
- Restore waiting-decision promotion and retry-safe send failure handling.
- Reject expired, unknown, replayed, and invalid-option replies.
- URL-encode decision action values and validate ntfy HTTP status codes.
- Add atomic state writes and a PowerShell smoke test for queue/expiry invariants.

## [0.1.0] - 2026-09-11
### Added
- Sanitized public release: `notify.ps1` / `notify.sh`, `ask-decision.ps1`, `watch-reply.ps1`, `common.ps1`
- `config.example.json` + git-ignored `config.json` / `state/`; secret-scanned CI
- Docs: README, CONTRIBUTING, SECURITY, SUPPORT, CODE_OF_CONDUCT, AGENTS.md
- CI: PSScriptAnalyzer + ShellCheck + markdownlint + gitleaks; Dependabot for Actions
