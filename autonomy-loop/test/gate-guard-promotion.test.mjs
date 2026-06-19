import { test } from "node:test";
import assert from "node:assert/strict";
import { isPromotionCommand, decideGuard } from "../hooks/gate-guard-promotion.mjs";

const FULL = ["builder", "reviewer"];
const REQ = { roles: { reviewer: "required" }, safety: { reducedTrustOptIn: false }, seed: true };

test("isPromotionCommand detects merges/prod-pushes/pr-merge/tags", () => {
  assert.equal(isPromotionCommand("git push origin main"), true);
  assert.equal(isPromotionCommand("git merge feature"), true);
  assert.equal(isPromotionCommand("gh pr merge 42"), true);
  assert.equal(isPromotionCommand("git push --tags"), true);
  assert.equal(isPromotionCommand("git push origin work-branch"), false); // not prod
  assert.equal(isPromotionCommand("git commit -m x"), false);
  assert.equal(isPromotionCommand("npm test"), false);
});

test("FULL trust (builder+reviewer): promotion allowed", () => {
  const d = decideGuard("git push origin main", FULL, REQ);
  assert.equal(d.block, false);
  assert.equal(d.exitCode, 0);
});

test("REFUSED (lone builder, reviewer required): promotion blocked with exit 2", () => {
  const d = decideGuard("git merge x", ["builder"], REQ);
  assert.equal(d.block, true);
  assert.equal(d.exitCode, 2);
  assert.ok(d.reason.includes("required-role-absent:reviewer"));
});

test("REDUCED (reviewer off + opt-in): promotion blocked", () => {
  const cfg = { roles: { reviewer: "off" }, safety: { reducedTrustOptIn: true }, seed: true };
  const d = decideGuard("gh pr merge 1", ["builder"], cfg);
  assert.equal(d.block, true);
  assert.equal(d.exitCode, 2);
  assert.ok(d.reason.includes("reduced-trust"));
});

test("non-promotion commands are never blocked by THIS guard regardless of trust", () => {
  // a lone builder running tests/commits is fine; only PROMOTION is gated here
  assert.equal(decideGuard("npm test", ["builder"], REQ).block, false);
  assert.equal(decideGuard("git commit -m wip", ["builder"], REQ).block, false);
});

test("INVARIANT: a promotion command is allowed ONLY when reviewer is live", () => {
  const roles = ["researcher", "planner", "builder", "reviewer"];
  for (let mask = 0; mask < 16; mask++) {
    const subset = roles.filter((_, i) => mask & (1 << i));
    const d = decideGuard("git push origin main", subset, { roles: {}, safety: { reducedTrustOptIn: true }, seed: true });
    if (!d.block) assert.ok(subset.includes("reviewer"), `promotion allowed without reviewer: ${JSON.stringify(subset)}`);
  }
});
