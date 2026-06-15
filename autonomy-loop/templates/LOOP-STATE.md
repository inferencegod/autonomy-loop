# LOOP-STATE — the baton

turn: human
last-builder-sha: <none>
last-reviewed-sha: <none>
pending-for-builder: <T2 writes the next concrete builder task here>
pending-for-reviewer: <T1 writes the commit range to review here>

<!--
  A terminal works ONLY when `turn:` is its name (builder | reviewer | human).
  `turn: human` = setup isn't approved yet, a Gate was hit needing a human call, the human paused the
  loop, OR the loop is truly blocked on every front at once (all remaining paths need a human answer
  AND research is genuinely dry). An EMPTY bug/feature backlog is NOT one of these — when the backlog
  is drained the loop runs the Research & Ideation lane (see RESEARCH-LANE.md); owner-gated items are
  PARKED to FOR-REVIEW.md as an approval menu and never set `turn: human`.
  This baton is the single source of truth for whose turn it is — never the commit log.
-->
