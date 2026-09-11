## Summary

## Linked issue

Fixes #

## Test plan

- [ ] `notify` → received on test phone/topic
- [ ] `ask-decision` → `DECISION_ID=` (exit 0) or queued (exit 2)
- [ ] `watch-reply` → `RESPONSE_RECEIVED` + `OPTION=` (paste redacted lines)
- [ ] No real topics, message IDs, or `state/` contents in this PR

## Checklist

- [ ] Conventional commit title (`feat:` / `fix:` / `docs:` / `chore:`)
- [ ] README / AGENTS.md / CHANGELOG updated if behaviour changed
- [ ] Scripts stay ASCII-only (emoji via code points)
