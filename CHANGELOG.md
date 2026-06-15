# Changelog
Format: Keep a Changelog · Versioning: SemVer.

## [0.1.0] — unreleased
### Added
- Two-terminal builder/reviewer loop (FSM baton in committed `LOOP-STATE.md`).
- 5-lens adversarial reviewer (effort-scaled; cheaper critics by default, Opus judge on escalation; bounded-retry → escalate).
- PreToolUse `gate-guard` hook (JSON deny protocol) — blocks prod-branch push, force-push, history rewrite, and edits/Bash-writes to `protectedPaths`.
- Research/ideation lane; no-fabrication discipline; per-project `autonomy.config.json`.
- `gate-guard` unit tests covering known bypass cases.

### Fixed
- Idle behavior: an empty bug/feature backlog now triggers the **Research & Ideation lane** instead of standing down. Owner/human-gated items are PARKED to `FOR-REVIEW.md` as an approval menu and never stop the loop. The baton goes `turn: human` only when truly blocked on every front at once (all remaining paths need a human answer AND research is dry) or the human pauses the loop. One substantive, sourced theme per research cycle — never per-commit busywork. Aligned across `templates/TWO-TERMINAL-AUTONOMY-LOOP.md`, `templates/RESEARCH-LANE.md`, `templates/LOOP-STATE.md`, `commands/builder.md`, `commands/reviewer.md`, and `skills/autonomy-operate/SKILL.md`.
