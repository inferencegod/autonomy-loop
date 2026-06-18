# PLAN-STATE — the upstream (feeder) baton

turn: research
last-research-cycle: <none>
last-planned-spec: <none>
pending-for-plan: <T3 Researcher notes "pool has N fresh ideas; top = IDEA-xxx">
pending-for-screen: <T4 Planner writes the spec id awaiting the Reviewer's plan-screen>
plan-epoch: 0
plan-no-progress-epochs: 0

--- APPROVED SPEC QUEUE (single writer = the plan lane) ---
<!-- <spec-id>   status: approved | parked | claimed | done   risk: <tier>   -> note -->

<!--
  4-TERMINAL OPT-IN ONLY. Created when roles.research is true. The default (recommended) 3-terminal shape does
  NOT use this file: the Planner runs on LOOP-STATE.md with `turn: planner`.

  This is the upstream feeder lane and the single source of truth for the upstream turn. A terminal works ONLY when
  `turn:` is its name: research (T3) | plan (T4) | reviewer (the plan-screen) | human. The turn cycles
  research -> plan -> reviewer(screen) -> research, one writer at a time (whoever holds the turn writes this file).

  It runs IN PARALLEL with the build lane (LOOP-STATE.md, turn: builder | reviewer). The two lanes touch at exactly
  one point: an `approved` spec in the queue above is claimed by the Builder into LOOP-STATE.pending-for-builder.
  SINGLE-WRITER-PER-FILE: the plan lane owns this file + tasks/IDEAS.md; the build lane owns LOOP-STATE.md; all
  cross-lane access is READ-ONLY (the plan lane reconciles `claimed`/`done` by reading LOOP-STATE + the ledger).
  The Reviewer (T2) services BOTH batons, code review first so a busy build lane is never blocked by spec screening.

  PLAN-BREAKER: plan-epoch / plan-no-progress-epochs are the feeder's runaway guard (breaker.maxPlanEpochs /
  breaker.maxPlanNoProgress); a trip parks to FOR-REVIEW.md + turn: human, the sanctioned exception to no-stand-down.
-->
