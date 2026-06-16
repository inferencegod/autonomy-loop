import { test } from "node:test";
import assert from "node:assert/strict";
import { decideRatchet } from "../hooks/coverage-ratchet.mjs";

test("seeds a floor when there is no baseline", () => {
  const r = decideRatchet({ lines: 68.9, branches: 77.4 }, null);
  assert.equal(r.ok, true);
  assert.equal(r.action, "seed");
  assert.equal(r.newBaseline.lines, 68.9);
  assert.equal(r.newBaseline.branches, 77.4);
});

test("holds when coverage is exactly at the floor", () => {
  const r = decideRatchet({ lines: 68.9 }, { lines: 68.9 });
  assert.equal(r.ok, true);
  assert.equal(r.action, "hold");
  assert.equal(r.newBaseline, undefined);
});

test("regresses when coverage falls well below the floor", () => {
  const r = decideRatchet({ lines: 65.0 }, { lines: 68.9 });
  assert.equal(r.ok, false);
  assert.equal(r.action, "regression");
});

test("a dip within the default epsilon band holds", () => {
  const r = decideRatchet({ lines: 68.8 }, { lines: 68.9, epsilon: 0.2 });
  assert.equal(r.ok, true);
  assert.equal(r.action, "hold");
});

test("a dip at the exact edge of the band holds", () => {
  const r = decideRatchet({ lines: 68.7 }, { lines: 68.9, epsilon: 0.2 });
  assert.equal(r.ok, true);
});

test("a dip just past the band regresses", () => {
  const r = decideRatchet({ lines: 68.4 }, { lines: 68.9, epsilon: 0.2 });
  assert.equal(r.ok, false);
  assert.equal(r.action, "regression");
});

test("ratchets the floor up when coverage rises", () => {
  const r = decideRatchet({ lines: 72.0, branches: 80 }, { lines: 68.9, branches: 77 });
  assert.equal(r.ok, true);
  assert.equal(r.action, "ratchet");
  assert.equal(r.newBaseline.lines, 72.0);
  assert.equal(r.newBaseline.branches, 80);
});

test("the branch floor never drops on a within-band dip (lines rising)", () => {
  // branches dip 0.1, inside the 0.2 band, while lines rise -> ratchet on lines, branch floor held
  const r = decideRatchet({ lines: 72.0, branches: 76.9 }, { lines: 68.9, branches: 77, epsilon: 0.2 });
  assert.equal(r.action, "ratchet");
  assert.equal(r.newBaseline.branches, 77);
});

test("missing measured lines is an error, not a regression", () => {
  const r = decideRatchet({ branches: 50 }, { lines: 68.9 });
  assert.equal(r.ok, false);
  assert.equal(r.action, "error");
});

test("garbage and out-of-range measured lines are errors", () => {
  assert.equal(decideRatchet({ lines: "garbage" }, { lines: 68.9 }).ok, false);
  assert.equal(decideRatchet({ lines: 140 }, { lines: 68.9 }).ok, false);
});

test("the decision is deterministic", () => {
  const a = decideRatchet({ lines: 70 }, { lines: 68.9 });
  const b = decideRatchet({ lines: 70 }, { lines: 68.9 });
  assert.deepEqual(a, b);
});

test("a drop beyond the band fails and a dip within it passes", () => {
  assert.equal(decideRatchet({ lines: 79.7 }, { lines: 80 }).ok, false); // 0.3 drop beyond the 0.2 band
  assert.equal(decideRatchet({ lines: 79.9 }, { lines: 80 }).ok, true);  // 0.1 dip within the band
});

test("an absurd epsilon is clamped, so a big drop cannot be swallowed (red-team P0)", () => {
  assert.equal(decideRatchet({ lines: 86 }, { lines: 90 }, { epsilon: 5 }).action, "hold");
  assert.equal(decideRatchet({ lines: 86 }, { lines: 90 }).ok, false);
});

test("a corrupt baseline lines value is an error, not a silent re-seed (red-team P1)", () => {
  const r = decideRatchet({ lines: 10 }, { lines: "garbage" });
  assert.equal(r.ok, false);
  assert.equal(r.action, "error");
  assert.equal(r.newBaseline, undefined);
});

test("an absurd epsilon is clamped down (red-team P0)", () => {
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
