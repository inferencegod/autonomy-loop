import test from "node:test";
import assert from "node:assert/strict";
import { verifyRoster } from "../hooks/presence-verify.mjs";

const now = "2026-06-19T05:00:00Z", fresh = "2026-06-19T04:59:30Z", stale = "2026-06-19T04:00:00Z";

test("P0-3 closed: a FRESH lease file with no live holder -> reviewer ABSENT", () => {
  const r = verifyRoster({ leases: [{ role: "reviewer", ownerUid: 1001, heartbeatUtc: fresh, ttlSeconds: 90 }], liveness: { reviewer: false }, self: { uid: 1000, platform: "linux" }, nowUtc: now });
  assert.equal(r.reviewer.present, false);
  assert.equal(r.reviewer.live, false);
});

test("live holder + different uid -> live + separated", () => {
  const r = verifyRoster({ leases: [{ role: "reviewer", ownerUid: 1001, heartbeatUtc: fresh, ttlSeconds: 90 }], liveness: { reviewer: true }, self: { uid: 1000, platform: "linux" }, nowUtc: now });
  assert.equal(r.reviewer.live, true);
  assert.equal(r.reviewer.separated, true);
});

test("same uid -> live but NOT separated", () => {
  const r = verifyRoster({ leases: [{ role: "reviewer", ownerUid: 1000, heartbeatUtc: fresh, ttlSeconds: 90 }], liveness: { reviewer: true }, self: { uid: 1000, platform: "linux" }, nowUtc: now });
  assert.equal(r.reviewer.separated, false);
});

test("a root builder is never 'separated' (it can forge any ownership)", () => {
  assert.equal(verifyRoster({ leases: [{ role: "reviewer", ownerUid: 5, heartbeatUtc: fresh, ttlSeconds: 90 }], liveness: { reviewer: true }, self: { uid: 0, platform: "linux" }, nowUtc: now }).reviewer.separated, false);
});

test("win32: a different owner SID -> separated", () => {
  assert.equal(verifyRoster({ leases: [{ role: "reviewer", ownerSid: "S-1-5-21-B", heartbeatUtc: fresh, ttlSeconds: 90 }], liveness: { reviewer: true }, self: { sid: "S-1-5-21-A", platform: "win32" }, nowUtc: now }).reviewer.separated, true);
});

test("win32: no SID available -> honest not-separated (fs uid is inert on Windows)", () => {
  assert.equal(verifyRoster({ leases: [{ role: "reviewer", heartbeatUtc: fresh, ttlSeconds: 90 }], liveness: { reviewer: true }, self: { uid: 0, platform: "win32" }, nowUtc: now }).reviewer.separated, false);
});

test("a stale heartbeat is not live even when a holder is reported", () => {
  assert.equal(verifyRoster({ leases: [{ role: "reviewer", ownerUid: 1001, heartbeatUtc: stale, ttlSeconds: 90 }], liveness: { reviewer: true }, self: { uid: 1000, platform: "linux" }, nowUtc: now }).reviewer.live, false);
});
