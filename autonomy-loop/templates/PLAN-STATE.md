# PLAN-STATE - the upstream (feeder) baton  ·  ⚠ NOT the source of truth (read below)

> 0.8.3: the authoritative 4-terminal plan baton + idea pool now live in a SIDECAR outside the
> working tree (`<git-common-dir>/autonomy-plan/`, via `hooks/plan-cli.mjs`), NOT in this file.
> This file is a human-readable MIRROR only. The plan lane reads/writes the baton with `plan-cli`
> so the every-~10-min git reconcile (stash / reset before pull) can NEVER wipe it - the bug that
> ate whole sessions when this state was uncommitted on the build lane's shared branch.

turn: research          # plan-lane turn vocab = research | plan | human  (mirror of `plan-cli read-turn`)
last-research-cycle: <none>
last-planned-spec: <none>
pending-for-plan: <Researcher notes "pool has N fresh ideas; top = IDEA-xxx"; authoritative copy is plan-cli status>
# plan-SCREEN is NOT on this baton: the Planner hands its spec to the Reviewer on LOOP-STATE.pending-for-screen, every shape
plan-epoch: 0
plan-no-progress-epochs: 0

--- APPROVED SPEC QUEUE (single writer = the plan lane) ---
<!-- <spec-id>   status: approved | parked | claimed | done   risk: <tier>   -> note -->

<!--
  4-TERMINAL OPT-IN ONLY. Used when a Researcher is launched (the 4-terminal power mode). The default 3-terminal shape does
  NOT use this file: the Planner runs on LOOP-STATE.md with `turn: planner`.

  AUTHORITATIVE STATE IS THE SIDECAR (0.8.3). The baton (turn, plan-epoch, last-research-cycle,
  pending-for-plan, drain-count) and the idea pool live under <git-common-dir>/autonomy-plan/, reached
  ONLY through `hooks/plan-cli.mjs` (read-turn | set-turn | read-pool | append-idea | drain-idea | status).
  Because that dir is the repo's shared git-common-dir (the same place presence leases live), every worktree
  of the loop sees the same baton+pool with NO commit and NO pull, and the reconcile/stash/reset never
  touches it. This file (and tasks/IDEAS.md, if present) are human-readable mirrors; if they ever disagree
  with `plan-cli status`, the SIDECAR wins and the mirror is stale. NEVER treat a blank/reverted copy of
  this file as a fresh research turn - `plan-cli` is the truth and its integrity guard refuses a wiped baton.

  TURN VOCAB: a terminal works ONLY when the plan-cli turn is its name: research (T3) | plan (T4) | human.
  The turn cycles research -> plan -> research, one writer at a time (whoever holds the turn writes the
  sidecar via `plan-cli set-turn`). This baton is the idea-pool REFILL channel ONLY; the plan-SCREEN happens
  on LOOP-STATE (the Planner hands its spec to the Reviewer there).

  It runs IN PARALLEL with the build lane (LOOP-STATE.md, turn: builder | reviewer). The two lanes touch at exactly
  one point: an `approved` spec in the queue above is claimed by the Builder into LOOP-STATE.pending-for-builder.
  SINGLE-WRITER-PER-FILE: the plan lane owns the sidecar baton + idea pool; the build lane owns LOOP-STATE.md; cross-
  lane access is READ-ONLY (the plan lane reconciles `claimed`/`done` by reading LOOP-STATE + the ledger) with EXACTLY
  ONE sanctioned exception: the Planner's FEEDER->BUILD HANDOFF - writing `pending-for-screen` (or, on an owner-GO
  promote, `pending-for-builder`) plus the matching `turn:` flip (reviewer / builder) on LOOP-STATE.md - IS a
  sanctioned cross-lane write (it is how the spec reaches the Reviewer; a Planner following its role literally is NOT
  violating this contract). Every OTHER cross-lane access stays read-only, and the single-writer guarantee for the
  pool/baton is unchanged (the Planner still never writes the researcher's pool except via `plan-cli drain-idea`).
  The build lane NEVER writes the sidecar (enforced by location: it lives in the plan-only autonomy-plan dir).
  The Reviewer (T2) runs on LOOP-STATE only; the plan-SCREEN happens there too, so it never needs to watch this baton.

  PLAN-BREAKER: plan-epoch / plan-no-progress-epochs are the feeder's runaway guard (breaker.maxPlanEpochs /
  breaker.maxPlanNoProgress); a trip parks to FOR-REVIEW.md + turn: human, the sanctioned exception to no-stand-down.
  plan-epoch is also the integrity fence: `plan-cli set-turn` REFUSES a write whose plan-epoch goes backwards
  (a wiped template reverts to 0), so a corrupted baton HALTS instead of silently re-running research.
-->
