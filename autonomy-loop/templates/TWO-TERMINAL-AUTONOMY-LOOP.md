# Two-Terminal Autonomy Loop — portable spec

A reusable pattern for running **two Claude Code terminals** on one codebase as a self-driving,
self-correcting loop. Everything project-specific is read from `autonomy.config.json` at the repo
root (see `autonomy.config.example.json`). Drop this in, run the bootstrap, and it tunes itself.

## The idea in one paragraph
Two terminals point at one repo and pass a baton back and forth:
- **Terminal 1 (Builder/Ideator)** picks the next task → codes it → runs the gate → commits & pushes
  the **work branch** → writes down what it did → writes the next prompt → flips the baton → sleeps.
- **Terminal 2 (Reviewer/Fixer)** wakes → reviews T1's new commits with a 5-lens adversarial panel →
  fixes/improves what it safely can (commits those) → audits the rest → writes findings + the next
  directive → flips the baton → sleeps.
- **T1 wakes**, reads T2's notes (fixes already landed + new directives), gets back to work.

It runs without you pasting anything. An **empty bug/feature backlog is NOT a stand-down** — it
flips the loop into the **Research & Ideation lane** (the default idle activity: research a theme →
write idea proposals → build the safe additive ones → park the gated ones as an approval menu). It
sets `turn: human` ONLY when it's truly blocked on all fronts at once (every remaining path needs a
human answer AND research is genuinely dry) or you explicitly pause the loop — that's rare.

## How each terminal "wakes"
Each runs its own self-scheduling loop (`/loop {{loopIntervalSec}}` ≈ every N min), offset so they
don't tick at the same instant. Every tick a terminal reads the baton — not its turn → exit; its
turn → one full cycle, then flip. A crash just resumes from the committed handoff files. Nothing
lives in memory.

## The baton (top of `LOOP-STATE.md`)
```
turn: builder            # builder | reviewer | human (Gate hit)
last-builder-sha: <sha>
last-reviewed-sha: <sha>
pending-for-builder: <one-line next task, written by T2>
pending-for-reviewer: <commit range to review, written by T1>
```
A terminal works only when `turn:` is its name. That's what stops two writers colliding.

## Core principles
1. One source of truth = a living `STATE.md`, not chat (chat compacts and is lost).
2. Write everything down every cycle; never rely on memory.
3. The baton prevents collisions; a git worktree keeps the two working trees separate.
4. Both terminals respect the **Gate List** (`autonomy.config.json` → `gateList`) — neither self-authorizes risky/irreversible actions.
5. No silent busywork — but a drained backlog is NOT a stand-down: when the valuable backlog is empty (or everything left is owner-gated), run the **Research & Ideation lane** (one substantive, sourced theme per cycle — never per-commit busywork): research → propose to `tasks/IDEAS.md` → BUILD the safe additive ideas behind the full gate, PARK the gated ones to `FOR-REVIEW.md` as an approval menu. Set `turn: human` only when truly blocked on every front at once (all remaining paths need a human answer AND research is dry) or the human pauses the loop.
6. **Honesty mandate** (`autonomy.config.json` → `honestyRule`): no fabricated numbers; a capability with no real data abstains visibly, never fakes.

## Shared files (created on bootstrap)
| File | Written by | Role |
|---|---|---|
| `STATE.md` | both | Living dashboard: shipped / in flight / decisions you owe / tasks you owe. |
| `LOOP-STATE.md` | both | The baton + the next concrete task. |
| `REVIEW-FEEDBACK.md` | T2 | Reviewer ledger: fixes (SHAs) + findings, severity-tagged, append-only. |
| `FOR-REVIEW.md` | both | Human-facing: gated items + open decisions. |
| `tasks/IDEAS.md` | T1 | Research-lane proposals (dated, sourced). |
| `tasks/RESEARCH-LANE.md` | bootstrap | The research-lane contract. |
| `CLAUDE.md` | bootstrap | Header so every session auto-loads the directive. |
| `.claude/skills/<project>-operate/SKILL.md` | bootstrap | The rhythm + accumulated learnings. |

## The gate (every wave, both terminals)
`{{gate.test}}` + the **frozen invariant stays intact** (`{{gate.frozenInvariant}}`) + `{{gate.build}}`
+ `{{gate.lint}}` on touched files. If `{{gate.coverage}}` is set, the reviewer also runs `node ${CLAUDE_PLUGIN_ROOT}/hooks/coverage-ratchet.mjs` as a third gate, so total coverage can never fall below the `.autonomy-coverage.json` floor. If `{{gate.patchTarget}}` is greater than 0, a fourth gate (`hooks/patch-coverage.mjs`) requires the wave's own changed lines to be tested, so new code cannot hide behind a flat global percent. If `{{gate.envFidelity}}` is set, the test command runs through it
so the LOCAL gate matches CI/prod env. All green or REVERT — never commit red. Every new computation
gets a PURE module + a RED-before/GREEN-after test, and the reviewer bite-checks that the test fails
when the bug is reintroduced.

## Terminal 1 — Builder / Ideator
See `commands/builder.md` (installed as `/builder`). Model: `{{models.builder}}`; ultrathink the plan.
Two modes: **IDEATE** (the research lane) and **BUILD**. Pre-empts the reviewer's panel by answering
the 5-lens rubric in its own build note. Pushes the **work branch** only; never the prod branch.

## Terminal 2 — Reviewer / Fixer
See `commands/reviewer.md` (installed as `/reviewer`). Model: `{{models.reviewer}}`, ultrathink every
review. Runs a **5-lens critic panel** (math · honesty · regression+frozen-drift · security · UX) as
spawned subagents — unanimous PASS required — plus a red-team-the-opposite pass and a
Correctness·Honesty·Regression·Scope·Reversibility rubric. Frozen-invariant-drift / protected-path
waves escalate to a Builder→Critic→Judge debate and PARK to `FOR-REVIEW.md` for owner GO — never
self-authorized. Fixes what it safely can; flags the rest.

## Gate List — both terminals STOP and ask the human
From `autonomy.config.json` → `gateList`. Enforced two ways: the PreToolUse `gate-guard.mjs` hook
hard-blocks the mechanical ones (prod-branch push, force-push, history rewrite, edits to
`protectedPaths`), AND the operate skill tells both terminals to park-and-ask for the judgment ones.

## Collision-proofing — two terminals, one repo
```bash
# from the Builder checkout (on the work branch):
git worktree add --detach {{worktreePath}} origin/{{workBranch}}
# Terminal 2 (Reviewer) runs in {{worktreePath}}
```
Both push the work branch; each `git pull`s at the start of its turn. Offset the two `/loop` intervals
(start the Reviewer ~2 min after the Builder) so ticks don't overlap.

## Bootstrap — paste as the FIRST Terminal 1 prompt (after the tree is clean)
> Read TWO-TERMINAL-AUTONOMY-LOOP.md and autonomy.config.json, then set the loop up for this repo:
> 1. Learn the repo: package manager + exact lint/test/build commands; the frozen invariant / protected
>    paths; the high-risk areas. Fill any blank knobs in autonomy.config.json.
> 2. Generate this repo's rules: `.claude/agents/<project>-reviewer.md` (the 5-lens checklist),
>    `.claude/skills/<project>-operate/SKILL.md` (the rhythm), and confirm the gate-guard hook resolves
>    the config.
> 3. Create STATE.md (four sections + pointer to LOOP-STATE.md), seeded from git log + any backlog doc.
> 4. Initialize LOOP-STATE.md with the baton (`turn: human`); add the CLAUDE.md header
>    ("Every session: read STATE.md first, follow <project>-operate; work the work branch, never prod").
> 5. Write the first task into pending-for-builder and STOP for my review. No Gate during setup.
> Then hand me: the Builder prompt, the Reviewer prompt, the worktree command, and the two `/loop`
> intervals. The loop starts only after I approve the first task.

## Why it works
- You stop being the memory — the markdown files hold the thread across compactions/crashes.
- Self-correcting, not just self-driving — T2's panel catches and FIXES what T1 missed, then aims T1.
- Speed with a brake — the Gate List + human escalation keep it from shipping something irreversible.
- The baton keeps it sane — one writer at a time, clean handoffs.
