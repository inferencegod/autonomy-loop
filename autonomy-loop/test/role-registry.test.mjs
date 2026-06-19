import { test } from "node:test";
import assert from "node:assert/strict";
import { composePipeline, ROLES } from "../hooks/role-registry.mjs";

// --- Spec A1 acceptance criteria ---

test("AC1: builder+reviewer+researcher wires spec-lite drain, valid, has verifier", () => {
  const r = composePipeline(["builder", "reviewer", "researcher"]);
  assert.equal(r.valid, true);
  assert.equal(r.hasIndependentVerifier, true);
  assert.deepEqual(r.danglingProducers, []);
  const lite = r.edges.find((e) => e.via === "spec-lite");
  assert.ok(lite && lite.from === "researcher" && lite.to === "builder");
  assert.ok(r.fallbacks.some((f) => f.role === "builder" && f.capability === "spec-lite"));
  assert.equal(r.drainOwner, "builder"); // no planner, builder drains
});

test("AC2: reviewer alone is starved (nothing to review)", () => {
  const r = composePipeline(["reviewer"]);
  assert.equal(r.valid, false);
  assert.deepEqual(r.starvedConsumers, ["reviewer"]);
});

test("AC3: researcher alone is valid but inert (dangling producer, no verifier)", () => {
  const r = composePipeline(["researcher"]);
  assert.equal(r.valid, true);
  assert.deepEqual(r.danglingProducers, ["researcher"]);
  assert.equal(r.hasIndependentVerifier, false);
});

test("AC4: all four wire researcher->planner->builder->reviewer, valid", () => {
  const r = composePipeline(["builder", "reviewer", "planner", "researcher"]);
  assert.equal(r.valid, true);
  assert.equal(r.drainOwner, "planner"); // planner outranks builder as idea-pool consumer
  // builder must NOT have a spec-lite fallback when planner is live
  assert.equal(r.fallbacks.length, 0);
  // edges include planner producing build-spec consumed by builder
  assert.ok(r.edges.some((e) => e.from === "planner" && e.artifact === "build-spec" && e.to === "builder"));
  assert.ok(r.edges.some((e) => e.from === "builder" && e.artifact === "commit" && e.to === "reviewer"));
});

test("AC5: lone builder valid with seed, starved without", () => {
  const withSeed = composePipeline(["builder"], { seed: true });
  assert.equal(withSeed.valid, true);
  assert.equal(withSeed.hasIndependentVerifier, false);

  const noSeed = composePipeline(["builder"]);
  assert.equal(noSeed.valid, false);
  assert.deepEqual(noSeed.starvedConsumers, ["builder"]);
});

// --- builder+reviewer (the mandatory safe core) ---
test("builder+reviewer with seed is the full-trust core", () => {
  const r = composePipeline(["builder", "reviewer"], { seed: true });
  assert.equal(r.valid, true);
  assert.equal(r.hasIndependentVerifier, true);
  assert.deepEqual(r.danglingProducers, []);
});

test("builder+reviewer without seed: builder starved (no spec source)", () => {
  const r = composePipeline(["builder", "reviewer"]);
  assert.equal(r.valid, false);
  assert.ok(r.starvedConsumers.includes("builder"));
});

// --- builder+reviewer+planner (no researcher): planner SELF-SOURCES (A0) ---
test("A0 AC1: builder+reviewer+planner with seed: planner self-sources, valid", () => {
  const r = composePipeline(["builder", "reviewer", "planner"], { seed: true });
  assert.equal(r.valid, true);
  assert.equal(r.starvedConsumers.includes("planner"), false);
  assert.ok(r.fallbacks.some((f) => f.role === "planner" && f.capability === "self-source"));
  assert.equal(r.drainOwner, "planner");
});

test("A0 AC1b: builder+reviewer+planner NO seed: planner self-sources, builder uses planner spec, valid", () => {
  const r = composePipeline(["builder", "reviewer", "planner"]);
  // planner self-sources ideas and produces build-spec; builder consumes it; reviewer verifies.
  assert.equal(r.valid, true);
  assert.equal(r.starvedConsumers.includes("planner"), false);
  assert.equal(r.starvedConsumers.includes("builder"), false);
});

test("AC6: all 16 subsets are deterministic and rank-ordered", () => {
  const roles = ["researcher", "planner", "builder", "reviewer"];
  const subsets = [];
  for (let mask = 0; mask < 16; mask++) {
    const s = roles.filter((_, i) => mask & (1 << i));
    subsets.push(s);
  }
  assert.equal(subsets.length, 16);
  for (const s of subsets) {
    const a = composePipeline(s, { seed: true });
    const b = composePipeline(s.slice().reverse(), { seed: true });
    // deterministic regardless of input order
    assert.deepEqual(a.live, b.live);
    assert.deepEqual(a.starvedConsumers.sort(), b.starvedConsumers.sort());
    // live is rank-ordered
    const ranks = a.live.map((r) => ROLES[r].rank);
    assert.deepEqual(ranks, ranks.slice().sort((x, y) => x - y));
  }
});

test("empty roster is valid-but-empty, no verifier", () => {
  const r = composePipeline([]);
  assert.equal(r.hasIndependentVerifier, false);
  assert.deepEqual(r.starvedConsumers, []);
  assert.deepEqual(r.live, []);
});

test("unknown roles are ignored", () => {
  const r = composePipeline(["builder", "reviewer", "nonsense"], { seed: true });
  assert.deepEqual(r.live, ["builder", "reviewer"]);
});
