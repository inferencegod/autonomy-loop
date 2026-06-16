import { test } from "node:test";
import assert from "node:assert/strict";
import { decideRatchet } from "../hooks/coverage-ratchet.mjs";

// The drift guard eats its own dogfood. The last six were added after an adversarial red-team
// (garbage baseline, absurd epsilon, empty measurement) that broke the earlier version.

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

test("BLOCKS a real drop below the floor (the drift Matt named)", () => {
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

test("one step past the epsilon band fails", () => {
  const r = decideRatchet({ lines: 68.4 }, { lines: 68.9, epsilon: 0.2 });
  assert.equal(r.ok, false);
  assert.equal(r.action, "regression");
});

test("ratchets the floor UP on a genuine improvement", () => {
  const r = decideRatchet({ lines: 72.0, branches: 80 }, { lines: 68.9, branches: 77 });
  assert.equal(r.ok, true);
  assert.equal(r.action, "ratchet");
  assert.equal(r.newBaseline.lines, 72.0);
  assert.equal(r.newBaseline.branches, 80);
});

test("the branch floor never drops even when this run's branches dip", () => {
  const r = decideRatchet({ lines: 72.0, branches: 70 }, { lines: 68.9, branches: 77 });
  assert.equal(r.action, "ratchet");
  assert.equal(r.newBaseline.branches, 77);
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

// ---- hardening tests added after the red-team ----

test("the DEFAULT epsilon is 0.2 pp (pinned, not only passed explicitly)", () => {
  assert.equal(decideRatchet({ lines: 79.7 }, { lines: 80 }).ok, false); // 0.3 drop beyond the 0.2 band
  assert.equal(decideRatchet({ lines: 79.9 }, { lines: 80 }).ok, true);  // 0.1 dip within the band
});

test("an explicit opts.epsilon widens the band (the opts path is honored)", () => {
  assert.equal(decideRatchet({ lines: 86 }, { lines: 90 }, { epsilon: 5 }).action, "hold");
  assert.equal(decideRatchet({ lines: 86 }, { lines: 90 }).ok, false);
});

test("a garbage baseline.lines is a hard ERROR, never a silent re-seed (red-team P0)", () => {
  const r = decideRatchet({ lines: 10 }, { lines: "garbage" });
  assert.equal(r.ok, false);
  assert.equal(r.action, "error");
  assert.equal(r.newBaseline, undefined);
});

test("an absurd epsilon is clamped, so a big drop cannot be swallowed (red-team P0)", () => {
  const r = decideRatchet({ lines: 1 }, { lines: 90 }, { epsilon: 1000 });
  assert.equal(r.ok, false);
  assert.equal(r.action, "regression");
});

test("a negative epsilon clamps to a strict no-drop (red-team P1)", () => {
  assert.equal(decideRatchet({ lines: 89.9 }, { lines: 90 }, { epsilon: -1 }).ok, false);
  assert.equal(decideRatchet({ lines: 90 }, { lines: 90 }, { epsilon: -1 }).ok, true);
});

test("an empty-string measurement is an error, not a fake 0% regression (red-team P1)", () => {
  assert.equal(decideRatchet({ lines: "" }, { lines: 90 }).action, "error");
});
