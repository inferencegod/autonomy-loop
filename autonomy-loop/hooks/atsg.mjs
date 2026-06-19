// autonomy-loop: atsg (Acceptance-Test Strength Gate, Spec B5). Pure decision core. The bite proves
// a NEW test fails when you revert the FIX; ATSG proves the ACCEPTANCE test fails when you MUTATE
// the spec'd behavior. A test that executes the changed line with a weak assertion can pass the bite
// yet pin nothing; ATSG closes that by requiring the acceptance test to KILL >=1 non-trivial mutant
// of the spec'd source. Reuses the project's mutate model (text-level operators). Fail-closed:
// 0 pass, 1 too-weak (no mutant killed), 2 cannot-verify. No I/O, no deps.

// decideAcceptanceStrength(input) -> { pass: 0|1|2, reason, killed, viable }
//   input.mutantResults: [{ mutantId, lineNo, viable, killedByAcceptanceTest, timedOut, buildError }]
//     - viable: false means an equivalent/unviable mutant, EXCLUDED from the denominator.
//     - killedByAcceptanceTest: the acceptance test failed (assertion) when this mutant was live.
//   input.requireKills: minimum mutants the acceptance test must kill (default 1).
//   input.assertionStrong: from assert-classify (the acceptance test must ALSO be >=S1).
//   input.checkedCoverage: optional advisory; if provided and false, weakens confidence (not a hard fail by default).
export function decideAcceptanceStrength(input) {
  const mr = Array.isArray(input?.mutantResults) ? input.mutantResults : null;
  if (mr === null) return { pass: 2, reason: "no-mutant-results", killed: 0, viable: 0 };

  // Distinguish a real "stayed-alive" from a cannot-verify (every mutant errored/timed out -> can't tell).
  const viable = mr.filter((m) => m && m.viable !== false);
  if (viable.length === 0) return { pass: 2, reason: "no-viable-mutants", killed: 0, viable: 0 };

  // If EVERY viable mutant build-errored (never produced a clean run AND was not a timeout-kill),
  // we cannot verify strength (fail-closed). A timeout is NOT inconclusive: it counts as a KILL
  // (the test hung the mutant = detected a difference), so it is excluded from this check.
  const buildErroredOnly = viable.every((m) => m.buildError && !m.timedOut && !m.killedByAcceptanceTest);
  if (buildErroredOnly) return { pass: 2, reason: "all-mutants-inconclusive", killed: 0, viable: viable.length };

  // A timeout counts as KILLED (the test hung the mutant = detected a difference), per the mutate model.
  const killed = viable.filter((m) => m.killedByAcceptanceTest || m.timedOut).length;
  const requireKills = Number.isInteger(input.requireKills) ? input.requireKills : 1;

  // The acceptance test must ALSO be a strong oracle (>=S1); a weak assertion that "kills" a mutant
  // by a truthiness flip is not acceptance strength. If assertionStrong is provided and false -> weak.
  if (input.assertionStrong === false) {
    return { pass: 1, reason: "weak-assertion-not-acceptance-strength", killed, viable: viable.length };
  }

  if (killed >= requireKills) {
    return { pass: 0, reason: "acceptance-test-kills-mutant", killed, viable: viable.length };
  }
  return { pass: 1, reason: "acceptance-test-pins-nothing", killed, viable: viable.length };
}
