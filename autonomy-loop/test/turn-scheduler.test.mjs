import { test } from "node:test";
import assert from "node:assert/strict";
import { advanceTurn, reclaim, commitAccepted, wouldDeadlock } from "../hooks/turn-scheduler.mjs";

// --- advanceTurn ---
test("AC1: builder->reviewer in a 2-role roster", () => {
  const r = advanceTurn("builder", ["builder", "reviewer"], 5);
  assert.equal(r.nextHolder, "reviewer");
  assert.equal(r.newEpoch, 6);
});

test("wraps reviewer->builder", () => {
  assert.equal(advanceTurn("reviewer", ["builder", "reviewer"], 5).nextHolder, "builder");
});

test("AC2: a stale reviewer is simply absent from roster -> builder stays (skip)", () => {
  // reviewer not in the live roster; from builder, wrap back to builder (only live role)
  const r = advanceTurn("builder", ["builder"], 5);
  assert.equal(r.nextHolder, "builder");
});

test("full roster advances in rank order researcher->planner->builder->reviewer->researcher", () => {
  const full = ["researcher", "planner", "builder", "reviewer"];
  assert.equal(advanceTurn("researcher", full, 1).nextHolder, "planner");
  assert.equal(advanceTurn("planner", full, 1).nextHolder, "builder");
  assert.equal(advanceTurn("builder", full, 1).nextHolder, "reviewer");
  assert.equal(advanceTurn("reviewer", full, 1).nextHolder, "researcher");
});

test("holder absent (just died) -> hand to highest-ranked live role", () => {
  const r = advanceTurn("planner", ["builder", "reviewer"], 7); // planner gone
  assert.equal(r.nextHolder, "builder");
  assert.equal(r.reason, "holder-absent");
});

test("fail-closed: empty roster -> nextHolder null (park, never spin)", () => {
  const r = advanceTurn("builder", [], 5);
  assert.equal(r.nextHolder, null);
  assert.equal(r.reason, "empty-roster");
});

// --- reclaim ---
const aliveSet = (set) => (role) => set.includes(role);

test("AC3: reclaim fires only when the pointed-to role is dead; epoch = old+1", () => {
  // holder reviewer is dead; builder live
  const out = reclaim({ turn: "reviewer", epoch: 9 }, ["builder"], aliveSet(["builder"]));
  assert.ok(out);
  assert.equal(out.turn, "builder");
  assert.equal(out.epoch, 10);
});

test("reclaim returns null when the holder is alive (nothing to do)", () => {
  const out = reclaim({ turn: "builder", epoch: 9 }, ["builder", "reviewer"], aliveSet(["builder", "reviewer"]));
  assert.equal(out, null);
});

test("reclaim returns null when no live roles exist", () => {
  const out = reclaim({ turn: "builder", epoch: 9 }, [], aliveSet([]));
  assert.equal(out, null);
});

// --- AC4: epoch fencing on simultaneous attempts ---
test("AC4: only the write matching expected epoch+1 is accepted", () => {
  // baton at epoch 9; two processes both try to write
  assert.equal(commitAccepted(10, 9), true);  // first writer, correct next epoch
  assert.equal(commitAccepted(10, 10), false); // second writer, baton already advanced -> rejected
  assert.equal(commitAccepted(9, 9), false);   // replay
  assert.equal(commitAccepted(8, 9), false);   // zombie behind
});

// --- AC6: no deadlock with >=1 live role ---
test("AC6: never deadlocks when at least one role is live", () => {
  const rosters = [["builder"], ["builder", "reviewer"], ["researcher", "planner", "builder", "reviewer"]];
  for (const r of rosters) {
    for (const holder of [...r, "ghost"]) {
      assert.equal(wouldDeadlock(holder, r, 1), false);
    }
  }
});

// --- AC5: join mid-run becomes eligible next boundary ---
test("AC5: a newly joined role appears in subsequent advances", () => {
  // before join: only builder+reviewer
  assert.equal(advanceTurn("builder", ["builder", "reviewer"], 1).nextHolder, "reviewer");
  // planner joins (now in roster); from researcher-less roster, advancing reviewer wraps,
  // and planner is now reachable in rank order
  const withPlanner = ["planner", "builder", "reviewer"];
  assert.equal(advanceTurn("reviewer", withPlanner, 1).nextHolder, "planner");
  assert.equal(advanceTurn("planner", withPlanner, 1).nextHolder, "builder");
});
