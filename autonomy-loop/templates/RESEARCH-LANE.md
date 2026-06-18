# RESEARCH & IDEATION LANE — the research-phase contract

> The contract for the loop's research phase. Run by the **Planner** (T3) inline in the 3-terminal shape, by the
> dedicated **Researcher** (T3) in the 4-terminal shape, and by the **Builder's MODE A** in the classic 2-terminal
> shape. Lowest priority, but the DEFAULT idle activity, never a stand-down: when the bug/feature backlog drains or
> everything left is owner-gated, the loop's job is to run this lane (the next dated cycle), not to go `turn: human`.

## The fan-out (read wide, write one)
- **One theme per cycle.** `ultrathink`, then fan out subagents across the LENSES below. **Fan out for READING
  only — never parallelize the writing** (parallel writers make conflicting decisions). A single context converges
  the cycle into one ranked, sourced output.
- **The lenses** (dial on per project, start wide then narrow, cap each one):
  - **product gaps** — capabilities to build next.
  - **competitors (deep)** — per rival: features, pricing, positioning, recent launches, what they do NOT do.
  - **marketing / positioning** — angles, messaging, category, jobs-to-be-done.
  - **SEO / content** — what the market searches, intent, the content gaps competitors own.
  - **pricing / monetization** — value metric, tiers, where you sit.
  - **UX / retention** — onboarding friction, the retention mechanics rivals use.
  - **the project lens** — the domain-specific table stakes for THIS repo.

## Honesty mandate
- Cite sources: every claim carries a **file:line or a fetched URL**, or is flagged unverified. **Verify a URL
  resolves before citing it.** Every stat carries N + CI or says "building, N/30". Never fabricate. Abstain visibly
  when unsure (models do not abstain on their own — force it).

## DIVERGE then CONVERGE
- **DIVERGE** ≥5 candidate ideas with judgment deferred. **CONVERGE**: score each on ROI (value/effort) ·
  differentiation · honesty-safety (additive vs protected-path) · reversibility (two-way door ships fast, one-way
  door parks). Treat the score as an INPUT, not a verdict; keep the raw inputs so false precision is auditable.

## The idea pool (`tasks/IDEAS.md`)
- A dated block per cycle; one ranked card per idea: `IDEA-<id>  <summary>  ROI · diff · risk-tier  src: <file:line / url>`.
- **Dedup** near-duplicates; **stamp a freshness TTL** (short for pricing/competitor moves, long for structural UX);
  re-research only expired themes. Single writer per mode (Planner inline, or the Researcher, or Builder MODE A —
  never two at once).

## Route the output by type
- **Build stream** (buildable code) → the winning idea becomes a grilled SPEC (`templates/SPEC.md`) → the plan gate
  → the Builder behind the FULL gate. BUILD only additive, non-`{{gate.frozenInvariant}}`-path ideas autonomously.
- **Growth stream** (non-code: battlecard · positioning brief · SEO/content plan · pricing rec) → DRAFT into
  `GROWTH.md` and **PARK** to `FOR-REVIEW.md` for the owner to publish. Public content + pricing are gate-list /
  irreversible: the loop drafts, the owner ships.
- **PARK** anything that touches the protected/money path, the frozen invariant, new infra/env/secret, or is a big
  strategic bet → `FOR-REVIEW.md` for the owner's GO. Do NOT build those autonomously.

## Absorb the lesson
- Append every durable learning to `.claude/skills/<project>-operate/SKILL.md` ("what almost broke + the rule that
  caught it").
