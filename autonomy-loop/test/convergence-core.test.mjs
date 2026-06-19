import test from "node:test";
import assert from "node:assert/strict";
import { decideConvergence } from "../hooks/convergence-core.mjs";

const nonpass = (sig) => ({ passed: false, signature: sig, treeSha: Math.random().toString(36) });

test("B1: A<->B oscillation with a CHANGING tree-sha is flagged (the no-progress breaker would miss it)", () => {
  const r = decideConvergence({ waves: [nonpass("A"), nonpass("B"), nonpass("A"), nonpass("B")], maxAttemptsPerTask: 10, oscillationK: 2 });
  assert.equal(r.oscillation, true);
  assert.ok(r.rung >= 1);
});

test("B2: attempt budget climbs one rung per breach and parks within bounded waves", () => {
  assert.equal(decideConvergence({ waves: [nonpass("a"), nonpass("b"), nonpass("c")], maxAttemptsPerTask: 3 }).rung, 1);
  assert.equal(decideConvergence({ waves: [nonpass("a"), nonpass("b"), nonpass("c"), nonpass("d")], maxAttemptsPerTask: 3 }).rung, 2);
  assert.equal(decideConvergence({ waves: [nonpass("a"), nonpass("b"), nonpass("c"), nonpass("d"), nonpass("e")], maxAttemptsPerTask: 3 }).action, "park");
});

test("B3: a healthy short log (distinct signatures, under budget) does NOT escalate", () => {
  assert.equal(decideConvergence({ waves: [nonpass("big"), nonpass("med"), nonpass("small")], maxAttemptsPerTask: 5, oscillationK: 2 }).rung, 0);
});

test("B4: unparseable gate output is counted as a failed wave (never a free pass)", () => {
  assert.ok(decideConvergence({ waves: [nonpass(null), nonpass(null)], oscillationK: 2 }).rung >= 1);
  assert.equal(decideConvergence({ waves: [nonpass(null)], maxAttemptsPerTask: 5 }).attempts, 1);
});

test("a passing last wave resets to continue; empty history continues", () => {
  assert.equal(decideConvergence({ waves: [nonpass("a"), nonpass("a"), { passed: true }] }).rung, 0);
  assert.equal(decideConvergence({ waves: [] }).rung, 0);
});
