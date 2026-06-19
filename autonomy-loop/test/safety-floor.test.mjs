import { test } from "node:test";
import assert from "node:assert/strict";
import { evaluate, promotionBlockedReason } from "../hooks/safety-floor.mjs";

const REQ_REVIEWER = { roles: { builder: "auto", reviewer: "required", planner: "auto", researcher: "auto" }, safety: { reducedTrustOptIn: false } };

// --- Spec A3 acceptance criteria ---
test("AC1: builder+reviewer -> full, allowPromotion true", () => {
  const d = evaluate(["builder", "reviewer"], { ...REQ_REVIEWER, seed: true });
  assert.equal(d.trust, "full");
  assert.equal(d.allowPromotion, true);
  assert.equal(d.refuse, false);
});

test("AC2: lone builder with reviewer:required -> refuse", () => {
  const d = evaluate(["builder"], { ...REQ_REVIEWER, seed: true });
  assert.equal(d.refuse, true);
  assert.equal(d.reason, "required-role-absent:reviewer");
});

test("AC3: lone builder, reviewer off, opt-in true -> reduced, no promotion, must label", () => {
  const cfg = { roles: { reviewer: "off" }, safety: { reducedTrustOptIn: true }, seed: true };
  const d = evaluate(["builder"], cfg);
  assert.equal(d.trust, "reduced");
  assert.equal(d.allowPromotion, false);
  assert.equal(d.mustLabel, true);
  assert.equal(d.refuse, false);
});

test("AC4: lone builder, reviewer off, opt-in false -> refuse", () => {
  const cfg = { roles: { reviewer: "off" }, safety: { reducedTrustOptIn: false }, seed: true };
  const d = evaluate(["builder"], cfg);
  assert.equal(d.refuse, true);
});

test("AC5: corrupt roster input -> refuse (fail-closed)", () => {
  assert.equal(evaluate(null, REQ_REVIEWER).refuse, true);
  assert.equal(evaluate("nope", REQ_REVIEWER).refuse, true);
  assert.equal(evaluate(["builder"], null).refuse, true);
});

test("vetoed role present -> refuse", () => {
  const cfg = { roles: { reviewer: "off" }, safety: { reducedTrustOptIn: true }, seed: true };
  // reviewer is vetoed but also launched -> contradiction -> refuse
  const d = evaluate(["builder", "reviewer"], cfg);
  assert.equal(d.refuse, true);
  assert.equal(d.reason, "vetoed-role-present:reviewer");
});

test("starved pipeline (reviewer alone) -> refuse", () => {
  const d = evaluate(["reviewer"], { roles: { reviewer: "required" }, safety: {} });
  assert.equal(d.refuse, true);
});

test("builder+reviewer+researcher -> full (spec-lite drain, verifier present)", () => {
  const d = evaluate(["builder", "reviewer", "researcher"], REQ_REVIEWER);
  assert.equal(d.trust, "full");
  assert.equal(d.allowPromotion, true);
});

test("all four -> full", () => {
  const d = evaluate(["builder", "reviewer", "planner", "researcher"], REQ_REVIEWER);
  assert.equal(d.trust, "full");
  assert.equal(d.allowPromotion, true);
});

// --- AC6: THE INVARIANT. No roster/config ever yields allowPromotion=true without a live reviewer. ---
test("AC6 INVARIANT: allowPromotion=true implies an independent verifier (reviewer) is live", () => {
  const roles = ["researcher", "planner", "builder", "reviewer"];
  const subsets = [];
  for (let mask = 0; mask < 16; mask++) subsets.push(roles.filter((_, i) => mask & (1 << i)));

  const configs = [
    { roles: {}, safety: { reducedTrustOptIn: false } },
    { roles: {}, safety: { reducedTrustOptIn: true } },
    REQ_REVIEWER,
    { roles: { reviewer: "off" }, safety: { reducedTrustOptIn: true } },
    { roles: { builder: "required" }, safety: { reducedTrustOptIn: true } },
  ];

  for (const subset of subsets) {
    for (const baseCfg of configs) {
      for (const seed of [true, false]) {
        const d = evaluate(subset, { ...baseCfg, seed });
        if (d.allowPromotion === true) {
          // the ONLY way this is allowed: reviewer is live (independent verifier)
          assert.ok(subset.includes("reviewer"), `promotion allowed without reviewer for ${JSON.stringify(subset)} / ${JSON.stringify(baseCfg)}`);
          assert.equal(d.trust, "full");
        }
      }
    }
  }
});

// --- promotionBlockedReason helper ---
test("promotionBlockedReason: null when allowed, string when blocked", () => {
  assert.equal(promotionBlockedReason({ allowPromotion: true }), null);
  assert.ok(promotionBlockedReason({ allowPromotion: false, trust: "reduced" }).includes("reduced-trust"));
  assert.ok(promotionBlockedReason({ allowPromotion: false, refuse: true, reason: "x" }).includes("x"));
});
