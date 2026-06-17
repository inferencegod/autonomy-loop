# Changelog
Format: Keep a Changelog · Versioning: SemVer.

## [0.5.1] - 2026-06-17
### Added
- A real upgrade path for existing installs. Updating the plugin brings the new commands and hooks, but a repo's `autonomy.config.json` and `LOOP-STATE.md` are per-checkout and did not gain the new knobs, so an existing user silently ran without the breaker or self-mutation and nothing told them. New `/autonomy-upgrade` command plus `hooks/migrate-config.mjs` top up only the missing keys (`breaker`, `gate.selfMutate`, the self-protecting `protectedPaths` entries) and baton fields (`epoch`, `no-progress-epochs`, `last-tree-sha`) with safe defaults. It is idempotent, never overwrites a value you set, and never resets a running baton. Pure `migrateConfig` plus `migrateLoopState` core with 12 unit tests.
- `/autonomy-init` is now upgrade-aware: re-running it on a repo that already has a config or baton tops them up via the migrator instead of skipping the config and overwriting `LOOP-STATE.md` (which used to reset the baton to `turn: human`). Either `/autonomy-upgrade` or a re-run of `/autonomy-init` migrates safely.
- The reviewer now detects an un-migrated install (no `epoch` field or no `breaker` block) and tells the operator once, plainly, to run `/autonomy-upgrade`, instead of silently misbehaving. A README "Upgrading from an earlier version" section documents the one command. No hand-editing of JSON.

## [0.5.0] - 2026-06-17
### Added
- The bite is now a real gate, not just a reviewer instruction. `hooks/bite.mjs` mechanizes it: given a wave's fix and the new test, it reverts only the source change in a throwaway detached git worktree (keeping the test in place), reruns the test, and requires an assertion failure to pass. A test that still passes when the fix is reverted catches nothing and fails the gate. Validated against mutation-testing and regression-test-selection prior art: an exit code is not treated as a valid RED (an assertion failure is distinguished from a build/collect error or a timeout, so a fix that no longer compiles cannot masquerade as a caught bug), a flake guard requires the same failure N times in a row (default 3), the test must be green on the fixed code first, and a test that does not execute the reverted code is an honest cannot-verify rather than a pass. Fail-closed exit codes: 0 pass, 1 stayed-green, 2 cannot-verify. Pure `decideBite` plus `classifyOutcome` core with 17 unit tests; wired into the reviewer gate. No external deps.
- Control-plane hardening: the loop's own `autonomy.config.json`, `.autonomy-coverage.json`, and `autonomy-loop/hooks/` are now in the default `protectedPaths`, so a wave cannot edit away or delete its own gates. (`.autonomy-coverage.json` is safe to protect: the ratchet writes it through Node fs, which the gate-guard does not intercept, only Edit/Write tools and shell redirects.)
- Cross-wave circuit breaker: the reviewer now tracks `epoch`, `no-progress-epochs` (consecutive waves whose HEAD tree-SHA does not change), and an optional `maxBudgetUsd`. On a hard epoch cap, a no-progress run, or a budget overrun it parks the loop to `FOR-REVIEW.md` with `turn: human` instead of looping forever. Tunable via a `breaker` block in the config, and carved out in both prompts as the one sanctioned exception to the no-stand-down rule.
- `autonomy-init` now verifies server-side branch protection on `prodBranch` (a ruleset-aware `gh api rules/branches` check) and offers to set a minimal ruleset (require a pull request, block force-push, block deletion). It warns and continues if `gh` is missing, unauthenticated, the remote is not GitHub, or the user lacks admin, so setup never hard-blocks.
- Docs: a README "Operate (first run)" section (two terminals, the reviewer worktree, start-green, approve-first, how to stop, cost) and an accurate coverage-prerequisite note (jest/vitest provider or Node 22+, otherwise the coverage gates stay off and the loop still runs).
- Self-mutation self-check (builder b1, opt-in via `gate.selfMutate`): before handoff the builder mutates only the lines its diff changed and requires the tests to kill each mutant; a surviving mutant means a test ran the changed line but asserted nothing about it. Text-level, language-agnostic operators (relational boundary, equality, logical, boolean, arithmetic, integer off-by-one) with string and comment contents masked first so a mutation can never land inside a literal; one mutant per line (a line's mutants almost always share a fate); a timeout counts as killed; unviable mutants are excluded from the denominator; survivors are advisory by default because the equivalent-mutant problem is undecidable, with an allowlist for confirmed equivalents and `--block` for a hard gate. Pure `maskCode` plus `mutantsForLine` plus `decideMutation` core with 15 unit tests; reuses the bite's mutate-then-restore model and the patch-coverage diff parser. The builder's upstream complement to the reviewer's bite. Also adds a builder convergence bound: a wave whose gate stays red after 3 fix attempts parks to `FOR-REVIEW.md` instead of looping.

### Fixed
- `coverage-ratchet` now creates the baseline file's parent directory before writing it, so seeding a baseline into a nested path (for example a `.alvg/` subfolder) no longer throws `ENOENT`. A no-op when the baseline sits at the repo root, as in the default config.
- Bite hardening after an adversarial self-review: `classifyOutcome` now fails CLOSED on a genuinely ambiguous non-zero exit (no timeout, build-error, or assertion signature, and no `--assert-regex`) and returns `error` (cannot-verify) instead of assuming a caught assertion, so a silent crash can never masquerade as a real RED. The runner also refuses a merge commit as the fix (diffing one parent would revert the wrong slice), validates the `--fix` ref against shell-metacharacter injection, and only `git rm`s a reverted file that genuinely did not exist at the parent (a failed restore of a pre-existing file now surfaces as cannot-verify instead of silently deleting it).
- Self-mutation (`mutate`) restore is now signal-safe: a `SIGINT`/`SIGTERM` while a mutant is live on disk restores the file before exiting, and a failed restore logs a loud `MANUAL RESTORE NEEDED`, so an interrupted run can never leave the builder's working tree mutated.

## [0.3.2] - 2026-06-16
### Fixed
- Coverage ratchet now gates branch coverage, not just line coverage. Branch percentage was tracked and ratcheted but never checked against a floor, so branch coverage could rot under a flat line number (a new conditional whose else-arm is never tested would slip through while lines held). `decideRatchet` now applies a branch floor symmetric with lines: a drop past epsilon is a regression, an in-band dip holds without rewriting the baseline, lines and branches ratchet up independently, and the branch floor only moves up. A real branch floor with no branch measurement this run is an honest cannot-verify error rather than a silent pass, and a corrupt baseline `branches` value errors instead of disabling the gate. Seven branch-floor tests added (`test/branch-floor.test.mjs`); the existing case that encoded the old un-gated behavior was updated to a within-band dip. 24 ratchet tests total, all green.


## [0.3.1] - 2026-06-16
### Changed
- `autonomy-init` now offers the patch-coverage bar during setup (off / 80 / 100) and wires `gate.patchTarget` for you, so a fresh install discovers patch coverage the same way it discovers the ratchet. It notes that patch coverage scores only the lines a wave changes, so it applies at any repo coverage level (even a low-coverage repo can require every new line to be tested).

## [0.3.0] - 2026-06-16
### Added
- Patch coverage: a FOURTH gate, opt-in via `gate.patchTarget` greater than 0. It scores only the lines a wave changed, using the Istanbul `coverage-final.json`, so new untested code can no longer hide behind a flat or rising global percent (the ratchet's blind spot). Set the bar to 80 for standard or 100 to require every changed line tested so a single bare line cannot ride through. Self-contained Node (`hooks/patch-coverage.mjs`: pure `decidePatch` plus a diff parser plus an Istanbul reader), no external deps, 14 unit tests. Wired into the builder and reviewer gate. The coverage command must also emit `coverage-final.json` (add `--reporter=json`).

## [0.2.1] - 2026-06-16
### Fixed
- Coverage ratchet hardening after an adversarial review of the gate itself. A baseline file with an invalid `lines` value now returns a hard error instead of silently re-seeding at a lower floor (the gate can no longer disarm itself on a corrupt baseline). Epsilon is clamped to a sane 0 to 5 point band, so an absurd or negative value cannot swallow a real drop or false-block a flat run. An empty or non-numeric measurement is an honest error, not a fake 0 percent regression. Six regression tests added for these cases (17 total, all green).

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
