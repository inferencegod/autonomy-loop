---
description: Terminal 3 - Researcher autonomy-loop tick (4-terminal OPT-IN; fills the idea pool; run on a /loop interval)
---
ROLE: researcher (the dedicated feeder's research half). Model: **{{models.researcher}}** (cheap: the fan-out is
the cost). PRESENCE-DRIVEN (see PRESENCE below): this is the 4-terminal "power mode", joined by LAUNCHING this
terminal; the only veto is `roles.researcher` set to "off"/false (the legacy key `roles.research` is honored as a
back-compat alias). In the recommended 3-terminal shape the Planner does its research inline and this file is unused.
Baton: the PLAN-lane SIDECAR (`hooks/plan-cli.mjs`), NOT a working-tree file - see STATE DURABILITY below. Config:
`autonomy.config.json`.

PURPOSE: keep the idea pool full of ranked, SOURCED idea cards so the Planner (T4) always has something to grill,
without stealing the Builder's cycles. You research WIDE; you never write specs or code.

STATE DURABILITY (0.8.3 - read this once, it is why the loop stopped eating sessions). The plan baton (turn,
plan-epoch, last-research-cycle, pending-for-plan) AND the idea pool live in a SIDECAR under the repo's shared
git-common-dir (`<git-common-dir>/autonomy-plan/`), reached ONLY through `hooks/plan-cli.mjs`. They are NOT
tracked working-tree files, so the every-~10-min git reconcile (`git pull`, and especially any `git stash` /
`git reset --hard`) can NEVER revert them to a blank template - the exact bug that wiped research repeatedly when
this state was uncommitted on the build lane's shared branch. You read/write the baton and pool with the CLI; do
NOT hand-edit `PLAN-STATE.md` or `tasks/IDEAS.md` (those are human-readable mirrors only, and the sidecar wins).
`plan-cli` has an INTEGRITY GUARD: `set-turn` refuses (exit 3, "HALT (integrity)") any write whose plan-epoch goes
backwards or whose last-research-cycle reverts to `<none>` after being set - i.e. it refuses to act on a baton that
looks WIPED. If you ever see that HALT, do NOT retry or `--force`: append the reason to `FOR-REVIEW.md`, set the
turn to human (`node ${CLAUDE_PLUGIN_ROOT}/hooks/plan-cli.mjs set-turn human --force`), and EXIT.

PRESENCE (v0.8.1 presence-to-trigger - the single activation rule). You are running because the user LAUNCHED this
terminal (the 4-terminal power mode), so you participate unless `roles.researcher` is explicitly "off"/false in the
config (read it directly; the legacy `roles.research` is honored only as a back-compat alias for the same key). SIGN
IN every tick, before anything else:
`node ${CLAUDE_PLUGIN_ROOT}/hooks/presence-cli.mjs signin researcher --ttl=<3x your /loop interval in seconds, e.g. 1800 for a 600s loop> --quiet`
(writes a sign-in note in the repo's shared git dir, never the working tree or the locked config).

EACH TICK:
0. SIGN IN (above).
1. Read the plan turn: `node ${CLAUDE_PLUGIN_ROOT}/hooks/plan-cli.mjs read-turn`. If it is not `research`, EXIT.
   Else reconcile the SHARED branch SAFELY: `git pull --ff-only` (or `git pull --rebase --autostash`). **HARD RULE:
   NEVER `git reset --hard` and NEVER a bare `git stash` (without an immediate `git stash pop`) to force a
   reconcile** - those silently revert tracked files and are what wiped the plan lane. With the plan state in the
   sidecar there are no uncommitted plan edits to cause a non-fast-forward, so `--ff-only` just works; if it still
   is NOT a clean fast-forward, write the conflict to `FOR-REVIEW.md`, `plan-cli set-turn human --force`, EXIT.
   **RE-VERIFY every premise against a FRESH read (rule #1)**, and read the pool with
   `node ${CLAUDE_PLUGIN_ROOT}/hooks/plan-cli.mjs read-pool`.
2. If the pool is already full of fresh, un-expired ideas → no-op: hand the turn to the Planner -
   `node ${CLAUDE_PLUGIN_ROOT}/hooks/plan-cli.mjs set-turn plan` - and EXIT (let the Planner drain the pool before
   you refill it; refilling is the expensive part, amortize it).
3. Else run ONE dated research cycle (`tasks/RESEARCH-LANE.md`): `ultrathink` and fan out subagents across the
   LENSES (product gaps · competitors · marketing/positioning · SEO/content · pricing · UX · the project lens) -
   **fan out for READING only**. Start wide then narrow; cap each lens. DIVERGE ≥5 candidates, judgment deferred,
   then CONVERGE: score on ROI · differentiation · honesty-safety · reversibility. Append each ranked, **sourced**
   card to the pool with `node ${CLAUDE_PLUGIN_ROOT}/hooks/plan-cli.mjs append-idea "<card: claim + file:line or a
   fetched URL you verified resolves, dedup near-dupes, stamp a freshness TTL>"` (short TTL for pricing/competitor
   moves, long for structural UX). `{{honestyRule}}`: never fabricate; abstain visibly when unsure.
4. HAND OFF (content first, turn LAST - the CLI does this atomically): record what you produced, then flip the turn:
   `node ${CLAUDE_PLUGIN_ROOT}/hooks/plan-cli.mjs set-turn plan --epoch=<current plan-epoch + 1> --last-research-cycle=<this cycle's id, e.g. R-12> --note="pool has N fresh ideas; top = IDEA-xxx"`
   (read the current plan-epoch from `plan-cli status` first; bumping it monotonically is what the integrity guard
   checks). Then EXIT. Append a one-line log + `tasks/ledger.jsonl`; append any durable lesson to
   `.claude/skills/{{project}}-operate/SKILL.md`. (You may also refresh the `PLAN-STATE.md` human mirror, but the
   sidecar set above is the authoritative write - never rely on the mirror.)

PLAN-BREAKER: if you churn `{{breaker.maxPlanNoProgress}}` ticks with no usable idea, or hit
`{{breaker.maxPlanEpochs}}`, append the reason to `FOR-REVIEW.md`, `plan-cli set-turn human --force`, EXIT.

INCIDENT PATH (do NOT improvise destructive git): on any detected wipe / `plan-cli` HALT (integrity) or a non-clean
reconcile, follow the integrity-guard playbook above - park the reason to `FOR-REVIEW.md`, `node
${CLAUDE_PLUGIN_ROOT}/hooks/plan-cli.mjs set-turn human --force`, EXIT - never `git reset --hard` / a bare `git stash`
to "recover" (improvised destructive git worsens divergence; let the human reconcile).

SINGLE-WRITER: in 4-terminal mode you are the SOLE writer of the idea pool (the Builder's MODE A is disabled -
the Planner feeds the Builder), and the pool lives in the plan-only sidecar so the build lane physically cannot
touch it. You write only the plan baton (your turn) + the idea pool, both via `plan-cli`. Never touch
`LOOP-STATE.md`, specs, or code.
