---
description: Scaffold + tune the two-terminal autonomy loop into THIS repo (run once, then approve)
---
Bootstrap the autonomy loop for this repository.

1. **Config.** If `autonomy.config.json` does not exist at the repo root, copy it from the plugin's `autonomy.config.example.json` and fill the knobs by inspecting the repo: detect the package manager + exact `test`/`build`/`lint` commands; ask me (or infer + confirm) the `workBranch`, `prodBranch`, the **frozen invariant** (what must stay byte-identical — golden fixtures? snapshot tests? an API contract?), and the `protectedPaths`. **Coverage drift gate (offer it, do not assume):** check whether a coverage tool is available (c8, nyc, jest, vitest, or `node --test --experimental-test-coverage`); if one is, ask me whether to turn on drift protection, and on a yes set `gate.coverage` to a command that emits an Istanbul `coverage-summary.json` (for example `c8 --reporter=json-summary <the test command>`), then run `node ${CLAUDE_PLUGIN_ROOT}/hooks/coverage-ratchet.mjs` once to seed `.autonomy-coverage.json` at the current coverage. If no coverage tool is present, leave `gate.coverage` empty and tell me why. Leave `models` and `loopIntervalSec` at their defaults unless I say otherwise.
2. **Spec + contract.** Copy `templates/TWO-TERMINAL-AUTONOMY-LOOP.md` and `templates/RESEARCH-LANE.md` (as `tasks/RESEARCH-LANE.md`) into the repo.
3. **Rules.** Generate `.claude/skills/<project>-operate/SKILL.md` from the plugin's `autonomy-operate` skill, tuned to this repo's gate + frozen invariant. Confirm the `gate-guard.mjs` hook resolves `autonomy.config.json` from the repo root.
4. **State.** Create `STATE.md` (four sections: ✅ Shipped · 🔄 In flight · ⛔ Decisions you owe · 🗒 Tasks you owe + a pointer to LOOP-STATE.md), seeded from `git log` and any existing backlog doc. Create `FOR-REVIEW.md` + an empty `REVIEW-FEEDBACK.md`.
5. **Baton.** Copy `templates/LOOP-STATE.md` with `turn: human`. Add to `CLAUDE.md` (create if absent): "Every session: read STATE.md first, follow <project>-operate; work the work branch, never prod."
6. **First task.** Write the first concrete task into `pending-for-builder`, then STOP — do NOT start the loop. No Gate action during setup.

Then hand me back, ready to paste: the **Builder** prompt (`/builder`), the **Reviewer** prompt (`/reviewer`), the **worktree command** (`git worktree add --detach <worktreePath> origin/<workBranch>`), and the two **`/loop <interval>`** lines (offset ~2 min). The loop starts only after I approve the first task.
