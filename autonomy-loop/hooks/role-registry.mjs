// autonomy-loop: role-registry. Pure decision core for à la carte role composition.
// Each role is an independent capability with declared inputs/outputs and a rank in the
// data-flow order. composePipeline() wires whatever roles are live into a valid pipeline
// or reports why it is not valid. No I/O, no deps. (Spec A1.)

export const ROLES = {
  researcher: { consumes: ["open-web", "open-questions"], produces: ["idea-pool"], safetyClass: "advisory", rank: 1 },
  planner:    { consumes: ["idea-pool", "repo"],          produces: ["build-spec"], safetyClass: "producer", rank: 2 },
  builder:    { consumes: ["build-spec", "idea-pool", "repo"], produces: ["commit", "gate-result"], safetyClass: "producer", rank: 3 },
  reviewer:   { consumes: ["commit", "build-spec"],       produces: ["verdict"], safetyClass: "verifier-independent", rank: 4 },
};

// Artifacts that can come from outside the role set.
//   repo:        always present (the working tree).
//   open-web:    present iff a researcher is live (it is the researcher's source).
//   seed:        a human-provided first spec / task; satisfies build-spec with no planner.
function externalArtifacts(liveSet, { seed = false } = {}) {
  const ext = new Set(["repo"]);
  if (liveSet.has("researcher")) { ext.add("open-web"); ext.add("open-questions"); }
  if (seed) ext.add("build-spec"); // a seed spec is a valid build-spec source
  return ext;
}

// composePipeline: given the live roles, return the wired pipeline + diagnostics.
//   liveRoles: array of role ids that are currently present (from presence.roster()).
//   opts.seed: whether a human seed spec exists.
export function composePipeline(liveRoles, opts = {}) {
  const live = [...new Set(liveRoles)].filter((r) => ROLES[r]);
  const liveSet = new Set(live);
  const ranked = live.slice().sort((a, b) => ROLES[a].rank - ROLES[b].rank);

  // Who PRODUCES each artifact (live producers only), best (highest-rank) producer wins as a source.
  const producersOf = (artifact) => ranked.filter((r) => ROLES[r].produces.includes(artifact));

  const ext = externalArtifacts(liveSet, opts);
  const edges = [];
  const fallbacks = [];
  const starvedConsumers = [];

  // For each live consumer, try to satisfy each required input.
  for (const role of ranked) {
    for (const input of ROLES[role].consumes) {
      // builder/planner consume several alternatives; only ONE needs to be satisfied for the
      // "primary" input. We model the primary input per role explicitly below, and treat the
      // rest as optional. Here we record satisfaction per declared input but only STARVE on
      // the role's primary input.
      const fromExternal = ext.has(input);
      const fromLive = producersOf(input).filter((p) => p !== role);
      if (fromLive.length > 0) edges.push({ from: fromLive[0], artifact: input, to: role });
      else if (fromExternal) edges.push({ from: "external", artifact: input, to: role });
    }
  }

  // Primary-input requirement per role (what it MUST have to do its job at all).
  const PRIMARY = {
    researcher: null,            // self-sourced from open-web
    planner: "idea-pool",        // needs ideas to grill (or a seed handled below)
    builder: "build-spec",       // needs a spec (planner's, a seed, or spec-lite from idea-pool)
    reviewer: "commit",          // needs a builder commit to review
  };

  // Planner self-sourcing (Spec A0): a live planner with no researcher produces its own
  // idea-pool inline (0.6.0 planner already fans out across lenses). So planner is not starved.
  const plannerLive = liveSet.has("planner");
  if (plannerLive && !liveSet.has("researcher")) {
    fallbacks.push({ role: "planner", capability: "self-source", produces: "idea-pool" });
  }

  // Spec-lite drain (Spec A4): if builder is live, no planner is live, but an idea-pool exists,
  // the builder itself drains the pool into a build-spec. Record the fallback and satisfy builder.
  // idea-pool exists if a researcher is live OR a planner self-sources it.
  const ideaPoolExists = liveSet.has("researcher") || plannerLive;
  let builderSpecSatisfied = ext.has("build-spec") || producersOf("build-spec").some((p) => p !== "builder");
  if (liveSet.has("builder") && !builderSpecSatisfied && !plannerLive && ideaPoolExists) {
    fallbacks.push({ role: "builder", capability: "spec-lite", drains: "idea-pool", origin: "spec-lite" });
    edges.push({ from: "researcher", artifact: "idea-pool", to: "builder", via: "spec-lite" });
    builderSpecSatisfied = true;
  }

  // Determine starvation per role on its PRIMARY input.
  for (const role of ranked) {
    const primary = PRIMARY[role];
    if (primary === null) continue;
    if (role === "builder") { if (!builderSpecSatisfied) starvedConsumers.push("builder"); continue; }
    // planner self-sources its idea-pool when no researcher is live (A0).
    if (role === "planner" && plannerLive && !liveSet.has("researcher")) continue;
    const satisfied = ext.has(primary) || producersOf(primary).some((p) => p !== role);
    if (!satisfied) starvedConsumers.push(role);
  }

  // Drain-owner of the idea pool (Spec A4): highest-ranked live consumer of idea-pool.
  const ideaConsumers = ranked.filter((r) => ROLES[r].consumes.includes("idea-pool"));
  const drainOwner = ideaConsumers.length ? ideaConsumers[0] : null;

  // Dangling producers: live roles whose output nobody (live) consumes. Valid-but-inert.
  const danglingProducers = [];
  for (const role of ranked) {
    const outs = ROLES[role].produces;
    const consumed = outs.some((art) => ranked.some((r) => r !== role && ROLES[r].consumes.includes(art)));
    // reviewer's "verdict" is terminal (consumed by the human/promotion), never dangling.
    if (!consumed && role !== "reviewer") danglingProducers.push(role);
  }

  const hasIndependentVerifier = ranked.some((r) => ROLES[r].safetyClass === "verifier-independent");
  const valid = starvedConsumers.length === 0;

  let reason = "ok";
  if (!valid) reason = `starved: ${starvedConsumers.join(",")}`;
  else if (danglingProducers.length) reason = `inert: ${danglingProducers.join(",")} produce output nothing consumes`;

  return {
    live: ranked,
    edges,
    fallbacks,
    drainOwner,
    danglingProducers,
    starvedConsumers,
    hasIndependentVerifier,
    valid,
    reason,
  };
}
