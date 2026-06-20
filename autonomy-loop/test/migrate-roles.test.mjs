import { test } from "node:test";
import assert from "node:assert/strict";
import { migrateRoles, isMigrated } from "../hooks/migrate-roles.mjs";

test("AC1: legacy {planner:false, research:false} -> off/off + core + lease + safety", () => {
  const { cfg } = migrateRoles({ roles: { planner: false, research: false } });
  assert.equal(cfg.roles.planner, "off");
  assert.equal(cfg.roles.researcher, "off");
  assert.equal(cfg.roles.builder, "auto");
  assert.equal(cfg.roles.reviewer, "required");
  assert.equal(cfg.lease.ttlSeconds, 90);
  assert.equal(cfg.safety.reducedTrustOptIn, false);
});

test("AC2: legacy {planner:true} -> planner:auto", () => {
  const { cfg } = migrateRoles({ roles: { planner: true } });
  assert.equal(cfg.roles.planner, "auto");
});

test("AC3: idempotent - running twice yields no further change", () => {
  const first = migrateRoles({ roles: { planner: true, research: false } }).cfg;
  assert.equal(isMigrated(first), true);
  const second = migrateRoles(first);
  assert.deepEqual(second.cfg.roles, first.roles);
  assert.deepEqual(second.cfg.lease, first.lease);
  assert.deepEqual(second.cfg.safety, first.safety);
});

test("never overwrites an already-set new-shape value", () => {
  const { cfg } = migrateRoles({ roles: { reviewer: "auto", planner: "off" }, safety: { reducedTrustOptIn: true } });
  assert.equal(cfg.roles.reviewer, "auto");        // kept, not forced to required
  assert.equal(cfg.roles.planner, "off");          // kept
  assert.equal(cfg.safety.reducedTrustOptIn, true); // kept
});

test("empty / missing config -> full defaults", () => {
  const { cfg } = migrateRoles(undefined);
  assert.equal(cfg.roles.reviewer, "required");
  assert.equal(cfg.roles.builder, "auto");
  assert.equal(cfg.roles.planner, "auto");
  assert.equal(cfg.roles.researcher, "auto");
});

test("does not mutate the input object", () => {
  const input = { roles: { planner: true } };
  const snapshot = JSON.stringify(input);
  migrateRoles(input);
  assert.equal(JSON.stringify(input), snapshot);
});

test("preserves unrelated config keys (breaker, gate, models)", () => {
  const { cfg } = migrateRoles({ breaker: { maxEpochs: 50 }, gate: { selfMutate: true }, models: { planner: "opus" }, roles: { planner: false } });
  assert.deepEqual(cfg.breaker, { maxEpochs: 50 });
  assert.equal(cfg.gate.selfMutate, true); // preserved; other rigor keys topped up around it
  assert.deepEqual(cfg.models, { planner: "opus" });
});

test("research alias maps to researcher", () => {
  const { cfg } = migrateRoles({ roles: { research: true } });
  assert.equal(cfg.roles.researcher, "auto");
});

test("dogfood mixed state: stray legacy research:false is DROPPED, researcher:auto wins (no veto)", () => {
  const { cfg } = migrateRoles({ roles: { builder: "auto", reviewer: "required", planner: "auto", researcher: "auto", research: false } });
  assert.equal(cfg.roles.researcher, "auto");                       // the new key wins
  assert.equal(Object.prototype.hasOwnProperty.call(cfg.roles, "research"), false); // alias is gone
  assert.equal(cfg.roles.builder, "auto");
  assert.equal(cfg.roles.reviewer, "required");
  assert.equal(cfg.roles.planner, "auto");
});

test("mixed state is NOT considered migrated (so the runner re-strips the alias)", () => {
  // all four new keys valid + lease + safety present, but a stray legacy research lingers.
  const mixed = { roles: { builder: "auto", reviewer: "required", planner: "auto", researcher: "auto", research: false }, lease: { ttlSeconds: 90, renewEverySeconds: 30 }, safety: { reducedTrustOptIn: false } };
  assert.equal(isMigrated(mixed), false);                           // stray alias -> needs the drop
  const { cfg } = migrateRoles(mixed);
  assert.equal(Object.prototype.hasOwnProperty.call(cfg.roles, "research"), false);
  assert.equal(cfg.roles.researcher, "auto");
  assert.equal(isMigrated(cfg), true);                              // and now it is migrated
});

test("legacy {research:true, planner:false} -> researcher:auto, planner:off, no research key remains", () => {
  const { cfg } = migrateRoles({ roles: { research: true, planner: false } });
  assert.equal(cfg.roles.researcher, "auto");
  assert.equal(cfg.roles.planner, "off");
  assert.equal(Object.prototype.hasOwnProperty.call(cfg.roles, "research"), false);
});

test("idempotent: migrate twice drops research once and it never reappears", () => {
  const first = migrateRoles({ roles: { builder: "auto", reviewer: "required", planner: "auto", researcher: "auto", research: false } }).cfg;
  assert.equal(Object.prototype.hasOwnProperty.call(first.roles, "research"), false);
  assert.equal(isMigrated(first), true);
  const second = migrateRoles(first).cfg;
  assert.deepEqual(second.roles, first.roles);                      // no further change
  assert.equal(Object.prototype.hasOwnProperty.call(second.roles, "research"), false); // stays gone
});

test("rigor gates default ON (best-output philosophy)", () => {
  const { cfg } = migrateRoles({ roles: { planner: false } });
  assert.equal(cfg.gate.selfMutate, true);
  assert.equal(cfg.gate.acceptanceStrength, true);
  assert.equal(cfg.gate.weakAssertion, true);
  assert.equal(cfg.gate.checkedCoverage, true);
});

test("rigor defaults never overwrite a user's explicit off", () => {
  const { cfg } = migrateRoles({ gate: { selfMutate: false }, roles: {} });
  assert.equal(cfg.gate.selfMutate, false); // user chose speed; preserved
  assert.equal(cfg.gate.acceptanceStrength, true); // the rest still default on
});
