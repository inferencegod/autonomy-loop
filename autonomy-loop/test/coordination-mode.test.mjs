import test from "node:test";
import assert from "node:assert/strict";
import { decideCoordination } from "../hooks/coordination-mode.mjs";
const OK = { coordination: { mode: "single-cli" }, gate: { deterministicEnabled: true, bindsVerdict: true }, safety: { reducedTrustOptIn: true }, subagent: { reviewerIsolated: true } };
test("AC1: default/multi-process -> full-independence, no label", () => { const d = decideCoordination({}); assert.equal(d.trustTier, "full-independence"); assert.equal(d.mustLabel, false); assert.equal(d.refuse, false); });
test("AC2: single-cli happy -> reduced-independence + advisory + label", () => { const d = decideCoordination(OK); assert.equal(d.mode, "single-cli"); assert.equal(d.advisoryCritique, true); assert.equal(d.mustLabel, true); assert.equal(d.refuse, false); });
test("AC3: gate disabled -> refuse", () => assert.equal(decideCoordination({ ...OK, gate: { deterministicEnabled: false, bindsVerdict: true } }).reason, "single-cli-requires-deterministic-gate"));
test("AC4: gate not binding -> refuse", () => assert.equal(decideCoordination({ ...OK, gate: { deterministicEnabled: true, bindsVerdict: false } }).reason, "single-cli-requires-gate-to-bind-verdict"));
test("AC5: no opt-in -> refuse", () => assert.equal(decideCoordination({ ...OK, safety: { reducedTrustOptIn: false } }).reason, "single-cli-requires-reduced-trust-opt-in"));
test("AC6: reviewer not isolated -> refuse", () => assert.equal(decideCoordination({ ...OK, subagent: { reviewerIsolated: false } }).reason, "single-cli-requires-isolated-reviewer-subagent"));
test("AC7: malformed / unknown -> refuse", () => { assert.equal(decideCoordination(null).refuse, true); assert.equal(decideCoordination("nope").refuse, true); assert.equal(decideCoordination({ coordination: { mode: "duo" } }).refuse, true); });
test("AC8: truthy-but-not-true does not pass the gate", () => assert.equal(decideCoordination({ ...OK, gate: { deterministicEnabled: "true", bindsVerdict: 1 } }).refuse, true));
test("AC9 INVARIANT: non-refuse single-cli => gate enabled AND binding (brute force)", () => {
  const vals = [true, false, undefined, null, 1, 0, "true"]; let bad = 0;
  for (const de of vals) for (const bv of vals) for (const oi of vals) for (const ri of vals) {
    const d = decideCoordination({ coordination: { mode: "single-cli" }, gate: { deterministicEnabled: de, bindsVerdict: bv }, safety: { reducedTrustOptIn: oi }, subagent: { reviewerIsolated: ri } });
    if (d.refuse === false && !(de === true && bv === true && d.advisoryCritique === true && d.mustLabel === true)) bad++;
  }
  assert.equal(bad, 0);
});
test("AC10: multi-process ignores single-cli knobs (byte-identical)", () => { const a = decideCoordination({ coordination: { mode: "multi-process" } }); const b = decideCoordination({ coordination: { mode: "multi-process" }, gate: { deterministicEnabled: false }, safety: { reducedTrustOptIn: true } }); assert.deepEqual(a, b); assert.equal(a.refuse, false); });
