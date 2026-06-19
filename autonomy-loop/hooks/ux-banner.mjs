// autonomy-loop: ux-banner (Spec A-ux). Pure functions that turn the live roster + pipeline + trust
// decision into the human-facing roster panel and shape banners. No I/O; the command/hook layer
// prints what these return. Keeps all wording in one tested place.

import { composePipeline } from "./role-registry.mjs";
import { evaluate } from "./safety-floor.mjs";

const ALL_ROLES = ["researcher", "planner", "builder", "reviewer"];
const GAIN = {
  researcher: "add a researcher to fetch web sources and fill the idea pool",
  planner: "add a planner to grill ideas into screened, falsifiable specs",
  builder: "add a builder to write code (required to produce anything)",
  reviewer: "add a reviewer for independent verification (required to promote)",
};

// rosterPanel: the live status block.
export function rosterPanel(roster, config) {
  const live = new Set(roster || []);
  const pipe = composePipeline([...live], { seed: !!(config && config.seed) });
  const decision = evaluate([...live], config || {});

  const lines = ALL_ROLES.map((r) => `${live.has(r) ? "ON " : "-- "} ${r}`);
  const absent = ALL_ROLES.filter((r) => !live.has(r));

  const notes = [];
  // active fallback?
  if (pipe.fallbacks?.some((f) => f.capability === "spec-lite")) {
    notes.push("no planner: the builder is writing spec-lite specs; planning rigor is reduced.");
  }
  if (pipe.fallbacks?.some((f) => f.capability === "self-source")) {
    notes.push("no researcher: the planner is self-sourcing its own ideas.");
  }
  // inert?
  for (const d of pipe.danglingProducers || []) {
    if (d === "researcher") notes.push("researcher is filling the idea pool but nothing is building it -- launch a builder.");
    if (d === "planner") notes.push("planner is producing specs but nothing is building them -- launch a builder.");
  }

  return {
    roles: lines,
    trust: decision.trust.toUpperCase(),
    refused: decision.refuse === true,
    refuseReason: decision.refuse ? decision.reason : null,
    allowPromotion: decision.allowPromotion,
    gains: absent.map((r) => GAIN[r]),
    notes,
    valid: pipe.valid,
  };
}

// banner: the one-line headline for the current shape.
export function banner(roster, config) {
  const live = new Set(roster || []);
  const decision = evaluate([...live], config || {});

  if (decision.refuse) {
    return `REFUSED: ${decision.reason}. The loop will not run. ` +
      (decision.reason.startsWith("required-role-absent:reviewer")
        ? "Builder + Reviewer is the mandatory safe core -- launch a reviewer, or set safety.reducedTrustOptIn to run without one (promotion stays blocked)."
        : "Fix the configuration and relaunch.");
  }
  if (decision.trust === "reduced") {
    return "REDUCED TRUST: no independent verification -- you are trusting the builder's self-assessment. Auto-promotion is blocked.";
  }
  // full-trust shapes
  const has = (r) => live.has(r);
  if (has("builder") && has("reviewer") && has("planner") && has("researcher"))
    return "Full pipeline (researcher -> planner -> builder -> reviewer). Highest token cost.";
  if (has("builder") && has("reviewer") && has("researcher"))
    return "Researcher feeds ideas straight to the builder; the reviewer independently verifies every commit. No separate planner screens the spec.";
  if (has("builder") && has("reviewer") && has("planner"))
    return "Planner grills a spec and the reviewer screens it before the builder builds.";
  if (has("builder") && has("reviewer"))
    return "Safe core: a builder writes, an independent reviewer re-checks every commit. Minimum trustworthy setup.";
  return "Pipeline is inert -- no builder is producing shippable code.";
}

// recommendations: what the product suggests.
export function recommendations() {
  return {
    newcomer: ["builder", "reviewer"],
    poweUser: ["builder", "reviewer", "researcher"],
    principle: "Just launch the roles you want; the loop detects them. The only hard rule is the safety floor: anything promotable needs independent verification (a reviewer).",
  };
}

export const _internal = { ALL_ROLES, GAIN };
