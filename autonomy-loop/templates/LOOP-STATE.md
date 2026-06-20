# LOOP-STATE - the baton

turn: human
last-builder-sha: <none>
last-reviewed-sha: <none>
pending-for-builder: <T2 writes the next concrete builder task here>
pending-for-reviewer: <T1 writes the commit range to review here>
pending-for-screen:
epoch: 0
no-progress-epochs: 0
last-tree-sha: <none>

<!--
  A terminal works ONLY when `turn:` is its name (planner | builder | reviewer | human). When a PLANNER is LIVE
  (its `/autonomy-loop:planner` terminal is launched) it is the feeder: the turn cycles planner -> reviewer(screen)
  -> builder -> reviewer(code) -> planner, and `pending-for-screen` carries a spec id for the Reviewer's plan-screen.
  When no planner is live this is the classic 2-terminal loop and `turn: planner` / `pending-for-screen` are unused.
  VOCAB NOTE (do not confuse the two FSMs): this BUILD baton's planner token is `planner`. It is a DIFFERENT
  machine from the 4-terminal upstream PLAN baton (the `plan-cli` sidecar, turns research | plan | human), whose
  planner token is `plan`. The 3-terminal Planner runs HERE on `turn: planner` and never touches the plan sidecar;
  only the 4-terminal Researcher+Planner use `plan-cli`. Keep the tokens distinct so a baton never strands.
  `turn: human` = setup isn't approved yet, a Gate was hit needing a human call, a circuit-breaker
  tripped (epoch / no-progress / budget cap), the human paused the loop, OR the loop is truly blocked
  on every front at once (all remaining paths need a human answer AND research is genuinely dry). An
  EMPTY bug/feature backlog is NOT one of these. When the backlog
  is drained the loop runs the Research & Ideation lane (see RESEARCH-LANE.md); owner-gated items are
  PARKED to FOR-REVIEW.md as an approval menu and never set `turn: human`.
  This baton is the single source of truth for whose turn it is - never the commit log.
-->
