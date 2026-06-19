import { test } from "node:test";
import assert from "node:assert/strict";
import { isLive, roster, detectDoubleClaim, canClaim, epochAccepted } from "../hooks/presence.mjs";

const NOW = "2026-06-18T12:00:00Z";
function lease(role, { ageSec = 0, ttl = 90, pid = "h:1:aaa" } = {}) {
  const hb = new Date(Date.parse(NOW) - ageSec * 1000).toISOString();
  return { role, pid, epoch: 1, heartbeatUtc: hb, ttlSeconds: ttl, claimedAtUtc: NOW };
}

// --- isLive ---
test("AC1: lease older than ttl is not live", () => {
  assert.equal(isLive(lease("reviewer", { ageSec: 120, ttl: 90 }), NOW), false);
  assert.equal(isLive(lease("reviewer", { ageSec: 30, ttl: 90 }), NOW), true);
});

test("fail-closed: malformed leases are not live", () => {
  assert.equal(isLive(null, NOW), false);
  assert.equal(isLive({}, NOW), false);
  assert.equal(isLive({ role: "builder" }, NOW), false); // no heartbeat/ttl
  assert.equal(isLive({ role: "nope", heartbeatUtc: NOW, ttlSeconds: 90 }, NOW), false); // bad role
  assert.equal(isLive({ role: "builder", heartbeatUtc: "garbage", ttlSeconds: 90 }, NOW), false);
  assert.equal(isLive({ role: "builder", heartbeatUtc: NOW, ttlSeconds: 0 }, NOW), false); // ttl<=0
});

test("clock skew: mild future heartbeat tolerated, absurd future rejected", () => {
  assert.equal(isLive(lease("builder", { ageSec: -30, ttl: 90 }), NOW), true);   // 30s future, within ttl
  assert.equal(isLive(lease("builder", { ageSec: -200, ttl: 90 }), NOW), false); // 200s future, absurd
});

// --- roster ---
test("AC4 + rank order: roster lists only live roles, rank-sorted", () => {
  const leases = [
    lease("reviewer", { ageSec: 10 }),
    lease("builder", { ageSec: 10 }),
    lease("researcher", { ageSec: 300, ttl: 90 }), // stale -> dropped
  ];
  assert.deepEqual(roster(leases, NOW), ["builder", "reviewer"]); // researcher stale, rank order
});

test("kill a role, wait past ttl -> roster drops it", () => {
  const live = [lease("builder", { ageSec: 10 }), lease("reviewer", { ageSec: 10 })];
  assert.deepEqual(roster(live, NOW), ["builder", "reviewer"]);
  const reviewerDead = [lease("builder", { ageSec: 10 }), lease("reviewer", { ageSec: 200, ttl: 90 })];
  assert.deepEqual(roster(reviewerDead, NOW), ["builder"]);
});

test("roster is deterministic regardless of input order (property)", () => {
  const a = [lease("reviewer", { ageSec: 5 }), lease("researcher", { ageSec: 5 }), lease("builder", { ageSec: 5 }), lease("planner", { ageSec: 5 })];
  assert.deepEqual(roster(a, NOW), ["researcher", "planner", "builder", "reviewer"]);
  assert.deepEqual(roster(a.slice().reverse(), NOW), ["researcher", "planner", "builder", "reviewer"]);
});

test("empty / missing leases -> empty roster", () => {
  assert.deepEqual(roster([], NOW), []);
  assert.deepEqual(roster(undefined, NOW), []);
});

// --- detectDoubleClaim ---
test("AC2: same role, two fresh, different pid -> conflict", () => {
  const leases = [
    lease("builder", { ageSec: 5, pid: "h:1:aaa" }),
    lease("builder", { ageSec: 5, pid: "h:2:bbb" }),
  ];
  assert.deepEqual(detectDoubleClaim(leases, NOW), ["builder"]);
});

test("same role, same pid (a renew) -> NOT a conflict", () => {
  const leases = [
    lease("builder", { ageSec: 20, pid: "h:1:aaa" }),
    lease("builder", { ageSec: 5, pid: "h:1:aaa" }),
  ];
  assert.deepEqual(detectDoubleClaim(leases, NOW), []);
});

test("a stale duplicate does not count as a live conflict", () => {
  const leases = [
    lease("builder", { ageSec: 5, pid: "h:1:aaa" }),
    lease("builder", { ageSec: 300, ttl: 90, pid: "h:2:bbb" }), // dead
  ];
  assert.deepEqual(detectDoubleClaim(leases, NOW), []);
});

// --- canClaim ---
test("canClaim: free role yes; held-by-other no; held-by-me yes", () => {
  const heldByOther = [lease("reviewer", { ageSec: 5, pid: "h:9:zzz" })];
  assert.equal(canClaim("reviewer", "h:1:aaa", heldByOther, NOW), false);
  assert.equal(canClaim("reviewer", "h:1:aaa", [], NOW), true);
  const heldByMe = [lease("reviewer", { ageSec: 5, pid: "h:1:aaa" })];
  assert.equal(canClaim("reviewer", "h:1:aaa", heldByMe, NOW), true);
});

test("canClaim: a stale lease by another pid does NOT block (reclaim)", () => {
  const stale = [lease("reviewer", { ageSec: 300, ttl: 90, pid: "h:9:zzz" })];
  assert.equal(canClaim("reviewer", "h:1:aaa", stale, NOW), true);
});

test("canClaim fail-closed on unknown role", () => {
  assert.equal(canClaim("nonsense", "h:1:aaa", [], NOW), false);
});

// --- epochAccepted (fencing token) ---
test("AC6: epoch fencing accepts only batonEpoch+1; zombie old epoch rejected", () => {
  assert.equal(epochAccepted(6, 5), true);   // next step
  assert.equal(epochAccepted(5, 5), false);  // replay
  assert.equal(epochAccepted(4, 5), false);  // zombie behind
  assert.equal(epochAccepted(7, 5), false);  // skipped ahead
  assert.equal(epochAccepted("x", 5), false); // fail-closed
  assert.equal(epochAccepted(6, "y"), false);
});
