// Tests for the symmetric branch-coverage floor (closes the branch-rot gap: branch coverage
// could fall under a flat line number because branches were never in the lines denominator).
// Run: node --test test/branch-floor.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { decideRatchet } from "../hooks/coverage-ratchet.mjs";

test("branch rot is now a regression: lines flat, branches drop past the band", () => {
  const r = decideRatchet({ lines: 90, branches: 70 }, { lines: 90, branches: 80, epsilon: 0.2 });
  assert.equal(r.ok, false);
  assert.equal(r.action, "regression");
  assert.equal(r.newBaseline, undefined);
});

test("a within-band branch dip is a HOLD and writes nothing", () => {
  const r = decideRatchet({ lines: 90, branches: 79.9 }, { lines: 90, branches: 80, epsilon: 0.2 });
  assert.equal(r.ok, true);
  assert.equal(r.action, "hold");
  assert.equal(r.newBaseline, undefined);
});

test("branches ratchet up on their own even when lines hold", () => {
  const r = decideRatchet({ lines: 90, branches: 85 }, { lines: 90, branches: 80 });
  assert.equal(r.action, "ratchet");
  assert.equal(r.newBaseline.lines, 90);
  assert.equal(r.newBaseline.branches, 85);
});

test("a real branch floor with no branch measurement this run is cannot-verify", () => {
  const r = decideRatchet({ lines: 90 }, { lines: 90, branches: 80 });
  assert.equal(r.ok, false);
  assert.equal(r.action, "error");
});

test("a repo with no branches (floor 0) is unaffected: lines-only, still passes", () => {
  const r = decideRatchet({ lines: 90 }, { lines: 90, branches: 0 });
  assert.equal(r.ok, true);
  assert.notEqual(r.action, "error");
});

test("a corrupt branch baseline errors rather than silently disabling the branch gate", () => {
  const r = decideRatchet({ lines: 90, branches: 80 }, { lines: 90, branches: "garbage" });
  assert.equal(r.ok, false);
  assert.equal(r.action, "error");
});

test("the branch floor is monotonic: a big branch dip fails and never lowers the stored floor", () => {
  const r = decideRatchet({ lines: 90, branches: 60 }, { lines: 90, branches: 90, epsilon: 0.2 });
  assert.equal(r.action, "regression");
  assert.equal(r.newBaseline, undefined); // nothing written, floor stays at 90
});
