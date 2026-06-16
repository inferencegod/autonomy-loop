import { test } from "node:test";
import assert from "node:assert/strict";
import { decideRatchet } from "../hooks/coverage-ratchet.mjs";

// The drift guard eats its own dogfood: every rule below is RED-before-green and the
// reviewer can bite any of them (neuter the rule, watch the matching test go red).

test("seeds the floor on the first run (no baseline) and never blocks", () => {
  const r = decideRatchet({ lines: 68.9, branches: 77.4 }, null);
  assert.equal(r.ok, true);
  assert.equal(r.action, "seed");
  assert.equal(r.newBaseline.lines, 68.9);
  assert.equal(r.newBaseline.branches, 77.4);
});

test("holds (passes, no rewrite) when coverage sits exactly at the floor", () => {
  const r = decideRatchet({ lines: 68.9 }, { lines: 68.9 });
  assert.equal(r.ok, true);
  assert.equal(r.action, "hold");
  assert.equal(r.newBaseline, undefined);
});

test("BLOCKS a real drop below the floor (this is the drift Matt named)", () => {
  const r = decideRatchet({ lines: 65.0 }, { lines: 68.9 });
  assert.equal(r.ok, false);
  assert.equal(r.action, "regression");
});

test("a dip inside the epsilon noise band is tolerated, not blocked", () => {
  const r = decideRatchet({ lines: 68.8 }, { lines: 68.9, epsilon: 0.2 });
  assert.equal(r.ok, true);
  assert.equal(r.action, "hold");
});

test("epsilon boundary: exactly floor minus epsilon still passes", () => {
  const r = decideRatchet({ lines: 68.7 }, { lines: 68.9, epsilon: 0.2 });
  assert.equal(r.ok, true);
});

test("one step past the epsilon band fails (the band is not a loophole)", () => {
  const r = decideRatchet({ lines: 68.4 }, { lines: 68.9, epsilon: 0.2 });
  assert.equal(r.ok, false);
  assert.equal(r.action, "regression");
});

test("ratchets the floor UP on a genuine improvement (only ever rises)", () => {
  const r = decideRatchet({ lines: 72.0, branches: 80 }, { lines: 68.9, branches: 77 });
  assert.equal(r.ok, true);
  assert.equal(r.action, "ratchet");
  assert.equal(r.newBaseline.lines, 72.0);
  assert.equal(r.newBaseline.branches, 80);
});

test("the branch floor never drops even when this run's branches dip", () => {
  const r = decideRatchet({ lines: 72.0, branches: 70 }, { lines: 68.9, branches: 77 });
  assert.equal(r.action, "ratchet");
  assert.equal(r.newBaseline.branches, 77); // max(77, 70), never the lower number
});

test("missing measured line coverage is an honest error, never a silent pass", () => {
  const r = decideRatchet({ branches: 50 }, { lines: 68.9 });
  assert.equal(r.ok, false);
  assert.equal(r.action, "error");
});

test("non-numeric / out-of-range coverage is rejected, not coerced", () => {
  assert.equal(decideRatchet({ lines: "garbage" }, { lines: 68.9 }).ok, false);
  assert.equal(decideRatchet({ lines: 140 }, { lines: 68.9 }).ok, false);
});

test("deterministic: identical inputs yield a byte-identical decision", () => {
  const a = decideRatchet({ lines: 70 }, { lines: 68.9 });
  const b = decideRatchet({ lines: 70 }, { lines: 68.9 });
  assert.deepEqual(a, b);
});
