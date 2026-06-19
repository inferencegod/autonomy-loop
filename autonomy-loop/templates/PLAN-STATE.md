# PLAN-STATE — the upstream (feeder) baton

turn: research
last-research-cycle: <none>
last-planned-spec: <none>
pending-for-plan: <T3 Researcher notes "pool has N fresh ideas; top = IDEA-xxx">
# plan-SCREEN is NOT on this baton: the Planner hands its spec to the Reviewer on LOOP-STATE.pending-for-screen, every shape
plan-epoch: 0
plan-no-progress-epochs: 0

--- APPROVED SPEC QUEUE (single writer = the plan lane) ---
<!-- <spec-id>   status: approved | parked | claimed | done   risk: <tier>   -> note -->

<!--
  4-TERMINAL OPT-IN ONLY. Used when a Researcher is launched (the 4-terminal power mode). The default 3-terminal shape does
  NOT use this file: the Planner runs on LOOP-STATE.md with `turn: planner`.

  This is the upstream feeder lane and the single source of truth for the upstream turn. A terminal works ONLY when
  `turn:` is its name: research (T3) | plan (T4) | human. The turn cycles
  research -> plan -> research, one writer at a time (whoever holds the turn writes this file). This baton is the
  idea-pool REFILL channel ONLY; the plan-SCREEN happens on LOOP-STATE (the Planner hands its spec to the Reviewer there).

  It runs IN PARALLEL with the build lane (LOOP-STATE.md, turn: builder | reviewer). The two lanes touch at exactly
  one point: an `approved` spec in the queue above is claimed by the Builder into LOOP-STATE.pending-for-builder.
  SINGLE-WRITER-PER-FILE: the plan lane owns this file + tasks/IDEAS.md; the build lane owns LOOP-STATE.md; all
  cross-lane access is READ-ONLY (the plan lane reconciles `claimed`/`done` by reading LOOP-STATE + the ledger).
  The Reviewer (T2) runs on LOOP-STATE only; the plan-SCREEN happens there too, so it never needs to watch this baton.

  PLAN-BREAKER: plan-epoch / plan-no-progress-epochs are the feeder's runaway guard (breaker.maxPlanEpochs /
  breaker.maxPlanNoProgress); a trip parks to FOR-REVIEW.md + turn: human, the sanctioned exception to no-stand-down.
-->
