// autonomy-loop: oracle-separation (Spec B10). Pure core. Same-family LLM judges are correlated
// (error correlation higher for same-developer/same-architecture models; self-preference ~10-25%).
// For money-path / irreversible specs, the acceptance-test author must be a DIFFERENT model family
// than the spec author and the implementer, so a shared blind spot can't pass unchecked. For merely
// additive specs, role separation within one family + the deterministic floor (B8) suffices. This is
// a tiebreaker around the floor, never a replacement. No I/O, no deps, fail-closed.

// checkSeparation(assignment, opts) -> { ok, park, reason }
//   assignment: { specAuthor:{family}, testAuthor:{family}, implementer:{family}, reviewer:{family} }
//   opts.tier: "additive" | "money-path" | "irreversible" (from mpid)
//   opts.maxVoters: cap on independent voters configured (returns plateau guard, default 5)
export function checkSeparation(assignment, opts = {}) {
  const a = assignment && typeof assignment === "object" ? assignment : null;
  if (!a) return { ok: false, park: true, reason: "no-assignment" };

  const tier = opts.tier || "additive";
  const fam = (role) => a[role] && a[role].family ? String(a[role].family) : null;

  const specF = fam("specAuthor");
  const testF = fam("testAuthor");
  const implF = fam("implementer");

  // Additive: no cross-family requirement; the deterministic floor carries it.
  if (tier === "additive") {
    return { ok: true, park: false, reason: "additive-floor-suffices" };
  }

  // Money-path / irreversible: the test author MUST be a different family than spec author AND
  // implementer (break the shared-prior correlation on the safety-critical path).
  if (!testF || !specF || !implF) {
    return { ok: false, park: true, reason: "missing-family-assignment" };
  }
  if (testF === specF) return { ok: false, park: true, reason: "test-author-same-family-as-spec" };
  if (testF === implF) return { ok: false, park: true, reason: "test-author-same-family-as-implementer" };

  // Plateau guard: more than ~3-5 independent voters is wasted spend, not more safety.
  const distinctFamilies = new Set([specF, testF, implF, fam("reviewer")].filter(Boolean));
  const maxVoters = Number.isInteger(opts.maxVoters) ? opts.maxVoters : 5;
  if (distinctFamilies.size > maxVoters) {
    return { ok: false, park: true, reason: "too-many-voters-diminishing-returns" };
  }

  return { ok: true, park: false, reason: "cross-family-separation-satisfied" };
}

export const _internal = {};
