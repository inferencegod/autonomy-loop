// Tests for the idempotent upgrade migrator. migrateConfig tops up missing config knobs without
// changing existing values; migrateLoopState adds missing baton fields without resetting turn:.
// Run: node --test test/migrate-config.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { migrateConfig, migrateLoopState } from "../hooks/migrate-config.mjs";

// ---- migrateConfig ----

test("adds the breaker block when missing (incl. the v0.6 plan fields)", () => {
  const { config, added } = migrateConfig({ gate: {} });
  assert.deepEqual(config.breaker, { maxEpochs: 50, maxNoProgressEpochs: 3, maxBudgetUsd: 0, maxPlanEpochs: 40, maxPlanNoProgress: 3 });
  assert.ok(added.includes("breaker"));
});

test("tops up missing breaker subkeys WITHOUT changing existing values", () => {
  const mine = { maxEpochs: 9, maxNoProgressEpochs: 1, maxBudgetUsd: 5 };
  const { config, added } = migrateConfig({ gate: {}, breaker: { ...mine } });
  assert.equal(config.breaker.maxEpochs, 9);            // existing values preserved
  assert.equal(config.breaker.maxNoProgressEpochs, 1);
  assert.equal(config.breaker.maxBudgetUsd, 5);
  assert.equal(config.breaker.maxPlanEpochs, 40);       // v0.6 plan fields topped up
  assert.equal(config.breaker.maxPlanNoProgress, 3);
  assert.ok(!added.includes("breaker"));                // the block existed, not re-created whole
  assert.ok(added.includes("breaker.maxPlanEpochs"));
});

test("adds the roles block (default off = v0.5) when missing", () => {
  const { config, added } = migrateConfig({ gate: {} });
  assert.deepEqual(config.roles, { research: false, planner: false });
  assert.ok(added.includes("roles"));
});

test("preserves an existing roles value and tops up a missing role key", () => {
  const { config, added } = migrateConfig({ gate: {}, roles: { planner: true } });
  assert.equal(config.roles.planner, true);     // not overwritten
  assert.equal(config.roles.research, false);   // topped up
  assert.ok(!added.includes("roles"));
  assert.ok(added.includes("roles.research"));
});

test("adds models.researcher/planner ONLY when a models block exists", () => {
  const withModels = migrateConfig({ models: { builder: "opus" } });
  assert.equal(withModels.config.models.researcher, "sonnet");
  assert.equal(withModels.config.models.planner, "opus");
  assert.ok(withModels.added.includes("models.researcher"));
  const noModels = migrateConfig({ gate: {} });
  assert.equal(noModels.config.models, undefined); // never invents a models block
});

test("preserves an existing models.planner override", () => {
  const { config, added } = migrateConfig({ models: { planner: "sonnet" } });
  assert.equal(config.models.planner, "sonnet");    // not overwritten
  assert.equal(config.models.researcher, "sonnet"); // topped up
  assert.ok(!added.includes("models.planner"));
});

test("adds gate.selfMutate (default off) when gate exists without it", () => {
  const { config, added } = migrateConfig({ gate: { test: "npm test" } });
  assert.equal(config.gate.selfMutate, false);
  assert.ok(added.includes("gate.selfMutate"));
});

test("preserves an existing gate.selfMutate=true", () => {
  const { config, added } = migrateConfig({ gate: { selfMutate: true } });
  assert.equal(config.gate.selfMutate, true);
  assert.ok(!added.includes("gate.selfMutate"));
});

test("v0.8: adds gate.requireProdProtection (default true) when gate exists without it", () => {
  const { config, added } = migrateConfig({ gate: { test: "npm test" } });
  assert.equal(config.gate.requireProdProtection, true);
  assert.ok(added.includes("gate.requireProdProtection"));
});

test("v0.8: preserves a deliberate gate.requireProdProtection=false (never re-demands it)", () => {
  const { config, added } = migrateConfig({ gate: { requireProdProtection: false } });
  assert.equal(config.gate.requireProdProtection, false);
  assert.ok(!added.includes("gate.requireProdProtection"));
});

test("adds required protectedPaths without dropping the user's own", () => {
  const { config, added } = migrateConfig({ gate: {}, protectedPaths: ["test/golden/"] });
  assert.ok(config.protectedPaths.includes("test/golden/"));
  assert.ok(config.protectedPaths.includes("autonomy.config.json"));
  assert.ok(config.protectedPaths.includes(".autonomy-coverage.json"));
  assert.ok(added.some((a) => a.includes("autonomy.config.json")));
});

test("IDEMPOTENT: a second run adds nothing", () => {
  const once = migrateConfig({ gate: {} }).config;
  const twice = migrateConfig(once);
  assert.deepEqual(twice.added, []);
  assert.deepEqual(twice.config, once);
});

test("does not mutate the caller's input object", () => {
  const input = { gate: {} };
  migrateConfig(input);
  assert.equal(input.breaker, undefined);
});

// ---- migrateLoopState ----

test("adds the three baton fields right after turn:", () => {
  const { text, added } = migrateLoopState("turn: builder\npending-for-builder: do x\n");
  assert.deepEqual(added, ["epoch", "no-progress-epochs", "last-tree-sha"]);
  const lines = text.split("\n");
  assert.equal(lines[0], "turn: builder");
  assert.equal(lines[1], "epoch: 0");
  assert.equal(lines[2], "no-progress-epochs: 0");
  assert.equal(lines[3], "last-tree-sha: <none>");
  assert.ok(text.includes("pending-for-builder: do x")); // existing lines preserved
});

test("NEVER resets an existing turn: or duplicates a present field", () => {
  const src = "turn: reviewer\nepoch: 12\nlast-tree-sha: a1b2c3d\n";
  const { text, added } = migrateLoopState(src);
  assert.deepEqual(added, ["no-progress-epochs"]); // only the truly missing one
  assert.ok(text.includes("turn: reviewer"));
  assert.ok(text.includes("epoch: 12"));            // not reset to 0
  assert.equal((text.match(/^epoch:/gm) || []).length, 1); // exactly one epoch line: not reset, not duplicated
});

test("IDEMPOTENT: a fully-migrated baton is unchanged", () => {
  const once = migrateLoopState("turn: human\n").text;
  const twice = migrateLoopState(once);
  assert.deepEqual(twice.added, []);
  assert.equal(twice.text, once);
});

test("prepends when there is no turn: line", () => {
  const { text } = migrateLoopState("# notes\n");
  assert.ok(text.startsWith("epoch: 0\n"));
  assert.ok(text.includes("# notes"));
});

test("deterministic", () => {
  const a = migrateConfig({ gate: {} });
  const b = migrateConfig({ gate: {} });
  assert.deepEqual(a, b);
});
