import { test } from "node:test";
import assert from "node:assert/strict";
import { rosterPanel, banner, recommendations } from "../hooks/ux-banner.mjs";

const REQ = { roles: { reviewer: "required" }, safety: { reducedTrustOptIn: false }, seed: true };

test("AC1: builder+reviewer -> FULL, no reviewer-gain nag", () => {
  const p = rosterPanel(["builder", "reviewer"], REQ);
  assert.equal(p.trust, "FULL");
  assert.equal(p.allowPromotion, true);
  assert.ok(!p.gains.some((g) => g.includes("reviewer")));
});

test("AC2: builder+reviewer+researcher (no seed) -> spec-lite note + FULL", () => {
  // realistic researcher scenario: the researcher IS the idea source, so no human seed.
  const cfg = { roles: { reviewer: "required" }, safety: { reducedTrustOptIn: false } };
  const p = rosterPanel(["builder", "reviewer", "researcher"], cfg);
  assert.equal(p.trust, "FULL");
  assert.ok(p.notes.some((n) => n.includes("spec-lite")));
  assert.ok(banner(["builder", "reviewer", "researcher"], cfg).includes("Researcher feeds"));
});

test("AC3: researcher alone -> inert warning", () => {
  const p = rosterPanel(["researcher"], { roles: {}, safety: {} });
  assert.ok(p.notes.some((n) => n.includes("nothing is building")));
});

test("AC4: reviewer off, no opt-in -> REFUSED banner with reason", () => {
  const cfg = { roles: { reviewer: "off" }, safety: { reducedTrustOptIn: false }, seed: true };
  const b = banner(["builder"], cfg);
  assert.ok(b.startsWith("REFUSED"));
});

test("lone builder reviewer:required -> REFUSED, mentions safe core", () => {
  const b = banner(["builder"], REQ);
  assert.ok(b.includes("mandatory safe core"));
});

test("planner self-source note when no researcher", () => {
  const p = rosterPanel(["builder", "reviewer", "planner"], REQ);
  assert.ok(p.notes.some((n) => n.includes("self-sourcing")));
});

test("recommendations match decided defaults", () => {
  const r = recommendations();
  assert.deepEqual(r.newcomer, ["builder", "reviewer"]);
  assert.deepEqual(r.poweUser, ["builder", "reviewer", "researcher"]);
});
