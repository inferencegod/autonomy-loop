import test from "node:test";
import assert from "node:assert/strict";
import { decidePreflight, REFUSALS } from "../hooks/preflight.mjs";

const GOOD = { controlPlaneWritable: false, prodProtected: true, sandboxLive: true, reviewer: { live: true, separated: true } };

test("all rails present -> T3-HARDENED, unattended allowed, no refusals", () => {
  const d = decidePreflight(GOOD, {});
  assert.equal(d.tier, "T3-HARDENED");
  assert.equal(d.allowStart, true);
  assert.equal(d.allowUnattended, true);
  assert.equal(d.refusals.length, 0);
});

test("control plane writable -> refuse to start AND refuse unattended", () => {
  const d = decidePreflight({ ...GOOD, controlPlaneWritable: true }, {});
  assert.equal(d.allowStart, false);
  assert.equal(d.allowUnattended, false);
  assert.ok(d.refusals.includes("controlPlaneWritable"));
});

test("escape hatch lets an attended run START but NEVER enables unattended", () => {
  const d = decidePreflight({ ...GOOD, controlPlaneWritable: true }, { acceptReducedAssurance: true });
  assert.equal(d.allowStart, true);
  assert.equal(d.allowUnattended, false);
});

test("prod unprotected -> no unattended (reviewer separated, so that is NOT also flagged)", () => {
  const d = decidePreflight({ ...GOOD, prodProtected: false }, {});
  assert.equal(d.allowUnattended, false);
  assert.ok(d.refusals.includes("prodUnprotected"));
  assert.ok(!d.refusals.includes("reviewerNotSeparated"));
});

test("requireProdProtection=false -> prod protection not demanded", () => {
  assert.ok(!decidePreflight({ ...GOOD, prodProtected: false }, { requireProdProtection: false }).refusals.includes("prodUnprotected"));
});

test("stale reviewer (no live holder) -> unattended blocked", () => {
  const d = decidePreflight({ ...GOOD, reviewer: { live: false, separated: false } }, {});
  assert.equal(d.allowUnattended, false);
  assert.ok(d.refusals.includes("reviewerNotLive"));
});

test("decision-2 amendment: no live sandbox -> unattended refused", () => {
  const d = decidePreflight({ ...GOOD, sandboxLive: false }, {});
  assert.equal(d.allowUnattended, false);
  assert.ok(d.refusals.includes("sandboxNotLive"));
});

test("the forge (prod protection) provides independence even if the reviewer is not locally separated", () => {
  const d = decidePreflight({ ...GOOD, reviewer: { live: true, separated: false } }, {});
  assert.equal(d.allowUnattended, true);
  assert.ok(!d.refusals.includes("reviewerNotSeparated"));
});

test("no forge AND reviewer not separated -> both flagged", () => {
  const d = decidePreflight({ ...GOOD, prodProtected: false, reviewer: { live: true, separated: false } }, {});
  assert.ok(d.refusals.includes("prodUnprotected"));
  assert.ok(d.refusals.includes("reviewerNotSeparated"));
});

test("INVARIANT: allowUnattended iff !controlPlaneWritable && prodProtected && reviewerLive && sandboxLive", () => {
  const B = [true, false]; let bad = 0;
  for (const cp of B) for (const pp of B) for (const sb of B) for (const rl of B) for (const rs of B) {
    const d = decidePreflight({ controlPlaneWritable: cp, prodProtected: pp, sandboxLive: sb, reviewer: { live: rl, separated: rs } }, {});
    if (d.allowUnattended && !(!cp && pp && rl && sb)) bad++;
  }
  assert.equal(bad, 0);
});

test("every refusal key has a non-empty message string", () => {
  for (const k of ["controlPlaneWritable", "prodUnprotected", "reviewerNotSeparated", "reviewerNotLive", "sandboxNotLive"])
    assert.ok(typeof REFUSALS[k] === "string" && REFUSALS[k].length > 0, k);
});
