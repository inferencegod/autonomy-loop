# Changelog
Format: Keep a Changelog · Versioning: SemVer.

## [0.2.0] - 2026-06-16
### Added
- Coverage ratchet: an opt-in THIRD gate (the drift guard), enabled by setting `gate.coverage` to a command that emits an Istanbul `coverage-summary.json` (for example `c8 --reporter=json-summary --reporter=text npm test`). Total line coverage can never fall below a stored baseline in `.autonomy-coverage.json`, and the baseline only ever ratchets up, so coverage holes cannot quietly accumulate wave after wave. It pairs with the per-fix bite: coverage measures execution, not assertions, so the ratchet is the drift layer, never a quality claim on its own.
- Wired end to end: `hooks/coverage-ratchet.mjs` (a pure, unit-tested `decideRatchet` core plus a thin I/O runner), run by both `commands/builder.md` and `commands/reviewer.md` as part of the gate; `commands/autonomy-init.md` detects a coverage tool and offers to seed the baseline; documented in `README.md` and `autonomy.config.example.json`; covered by `test/coverage-ratchet.test.mjs`.

### Fixed
- `autonomy.config.example.json` was invalid JSON: Windows-1252 em-dash bytes had crept into the comment strings. Replaced with plain ASCII so the file parses everywhere.

## [0.1.0] — unreleased
### Added
- Two-terminal builder/reviewer loop (FSM baton in committed `LOOP-STATE.md`).
- 5-lens adversarial reviewer (effort-scaled; cheaper critics by default, Opus judge on escalation; bounded-retry → escalate).
- PreToolUse `gate-guard` hook (JSON deny protocol) — blocks prod-branch push, force-push, history rewrite, and edits/Bash-writes to `protectedPaths`.
- Research/ideation lane; no-fabrication discipline; per-project `autonomy.config.json`.
- `gate-guard` unit tests covering known bypass cases.

### Fixed
- Idle behavior: an empty bug/feature backlog now triggers the **Research & Ideation lane** instead of standing down. Owner/human-gated items are PARKED to `FOR-REVIEW.md` as an approval menu and never stop the loop. The baton goes `turn: human` only when truly blocked on every front at once (all remaining paths need a human answer AND research is dry) or the human pauses the loop. One substantive, sourced theme per research cycle — never per-commit busywork. Aligned across `templates/TWO-TERMINAL-AUTONOMY-LOOP.md`, `templates/RESEARCH-LANE.md`, `templates/LOOP-STATE.md`, `commands/builder.md`, `commands/reviewer.md`, and `skills/autonomy-operate/SKILL.md`.
