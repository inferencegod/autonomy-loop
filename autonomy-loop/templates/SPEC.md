# SPEC-<date>-<slug>

> The grill-to-goal package the Builder builds from. Filled by the Planner (T3), screened by the Reviewer (T2),
> built by the Builder (T1). Every field is sourced (a file:line or a fetched URL); no fabricated numbers.
> The ACCEPTANCE block is the oracle: if the Builder cannot make it go RED-then-GREEN, this spec is not done and
> the plan gate fails it. No em dashes are required; write plainly.

status:     draft            # draft | needs-owner | parked | approved | claimed | done
risk tier:  additive         # additive | money-path | frozen-invariant | new-infra | irreversible

## problem
<one or two sentences. each claim carries a file:line or a fetched URL.>

## the feature
<the detailed doc: what it does, the behavior, the edges. enough that the Builder needs no interpretation.>

## anchor files
<the exact files / interfaces the Builder will touch. the Builder re-reads them fresh before building.>

## acceptance        (the oracle: observable + falsifiable)
- <observable pass condition 1>
- <observable pass condition 2>

## RED test
<the failing-first test that encodes the acceptance criteria: the test file + exactly what it asserts.>

## out of scope
<explicit non-goals, so the wave stays small.>

## gate plan
<which gates apply: bite (yes for new logic) · coverage / patch-coverage · golden-cold (must stay byte-identical?)
· build · lint. Anything that would drift the frozen invariant is a PARK, not a build.>

## build prompt        (goal-ready: hand this to the Builder)
<a self-contained prompt that references this spec by id and tells the Builder exactly what to build and how it
will be verified (the acceptance test above). this is the goal-style hand-off the Builder executes behind the
full gate.>
