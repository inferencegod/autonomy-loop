// autonomy-loop: integration harness for the IMPURE runtime (presence-io.mjs + baton-io.mjs).
// Exercises the real fs + real `git` against a fresh SCRATCH repo created with `git init`. The
// pure cores are unit-tested separately (presence.test.mjs, turn-scheduler.test.mjs); THIS proves
// the thin runners do the right git/fs side effects and stay fail-closed.
//
// Run:  node --test test/presence-baton.integration.mjs
// No external deps. NO em dashes.

import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync, readFileSync, mkdirSync, existsSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { claimRole, renewLease, liveRoster, makePid } from "../hooks/presence-io.mjs";
import { initState, readState, writeCursor, tick } from "../hooks/baton-io.mjs";

const NOW = "2026-06-18T12:00:00Z";
function nowPlus(seconds) {
  return new Date(Date.parse(NOW) + seconds * 1000).toISOString();
}

function git(repo, args) {
  // Capture stderr so the suite output stays clean: scratch repos have no remote and use the default
  // autocrlf, both of which make git write warnings/fatals that gitQuiet already handles functionally.
  return execFileSync("git", args, { cwd: repo, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

// freshRepo: a real git repo in a temp dir, isolated identity, with one root commit so HEAD exists.
function freshRepo() {
  const dir = mkdtempSync(join(tmpdir(), "autoloop-scratch-"));
  git(dir, ["init", "-q"]);
  git(dir, ["config", "user.email", "test@autonomy.loop"]);
  git(dir, ["config", "user.name", "Autonomy Loop Test"]);
  git(dir, ["config", "commit.gpgsign", "false"]);
  git(dir, ["config", "core.autocrlf", "false"]); // deterministic line endings: no LF/CRLF rewrite warnings
  writeFileSync(join(dir, "README.md"), "scratch\n");
  git(dir, ["add", "--", "README.md"]);
  git(dir, ["commit", "-q", "-m", "root"]);
  return dir;
}

function cleanup(dir) {
  try { rmSync(dir, { recursive: true, force: true }); } catch { /* best effort */ }
}

// lastCommitFiles: the files changed by HEAD (proves a commit touched ONLY what we expect).
function lastCommitFiles(repo) {
  const out = git(repo, ["show", "--name-only", "--pretty=format:", "HEAD"]);
  return out.split("\n").map((s) => s.trim()).filter(Boolean);
}

function leaseFilePath(repo, role) {
  return join(repo, "presence", `${role}.lease.json`);
}

// overwriteLeaseHeartbeat: simulate an aged lease by hand-editing heartbeatUtc on disk (and commit
// it the same path-scoped way the runner would), so liveRoster judges it stale.
function ageLeaseOnDisk(repo, role, agedHeartbeatUtc) {
  const p = leaseFilePath(repo, role);
  const lease = JSON.parse(readFileSync(p, "utf8"));
  lease.heartbeatUtc = agedHeartbeatUtc;
  writeFileSync(p, JSON.stringify(lease, null, 2) + "\n");
  git(repo, ["add", "--", join("presence", `${role}.lease.json`)]);
  git(repo, ["commit", "-q", "-m", `test: age ${role}`, "--", join("presence", `${role}.lease.json`)]);
}

// ---------------------------------------------------------------------------
// TASK 1: presence-io against a real repo.
// ---------------------------------------------------------------------------

test("T1.AC1: launching a builder writes exactly presence/builder.lease.json and commits ONLY that file", () => {
  const repo = freshRepo();
  try {
    const res = claimRole(repo, "builder", { pid: "h:1:builderA", nowUtc: NOW });
    assert.equal(res.ok, true, "claim should succeed on a free role");

    // exactly one lease file exists, and it is builder's
    const leaseDir = join(repo, "presence");
    assert.ok(existsSync(leaseFilePath(repo, "builder")), "builder lease file must exist");
    assert.deepEqual(readdirSync(leaseDir).sort(), ["builder.lease.json"], "ONLY builder lease present");

    // the HEAD commit touched ONLY presence/builder.lease.json
    assert.deepEqual(lastCommitFiles(repo), ["presence/builder.lease.json"], "commit touched only the one lease");

    // the lease body is well-formed
    const lease = JSON.parse(readFileSync(leaseFilePath(repo, "builder"), "utf8"));
    assert.equal(lease.role, "builder");
    assert.equal(lease.pid, "h:1:builderA");
    assert.equal(lease.heartbeatUtc, NOW);
  } finally { cleanup(repo); }
});

test("T1.AC2: a second process claiming builder with a different pid is refused (fail-closed)", () => {
  const repo = freshRepo();
  try {
    const first = claimRole(repo, "builder", { pid: "h:1:builderA", nowUtc: NOW });
    assert.equal(first.ok, true);

    // a different pid tries to claim the SAME role while the first lease is still live
    const second = claimRole(repo, "builder", { pid: "h:2:builderB", nowUtc: nowPlus(5) });
    assert.equal(second.ok, false, "second claimant must be refused");
    assert.equal(second.heldBy, "h:1:builderA", "refusal reports the live holder");

    // disk still shows the ORIGINAL owner (the refused claim wrote nothing)
    const lease = JSON.parse(readFileSync(leaseFilePath(repo, "builder"), "utf8"));
    assert.equal(lease.pid, "h:1:builderA", "refused claim did not overwrite the lease");
  } finally { cleanup(repo); }
});

test("T1.AC3: a lease past ttlSeconds drops out of liveRoster()", () => {
  const repo = freshRepo();
  try {
    claimRole(repo, "builder", { pid: "h:1:builderA", ttlSeconds: 90, nowUtc: NOW });
    // fresh: builder is live
    assert.deepEqual(liveRoster(repo, { nowUtc: nowPlus(10) }), ["builder"], "fresh lease is live");
    // age the heartbeat to 200s old vs a 90s ttl -> stale
    ageLeaseOnDisk(repo, "builder", nowPlus(-200));
    assert.deepEqual(liveRoster(repo, { nowUtc: NOW }), [], "lease older than ttl drops out");
  } finally { cleanup(repo); }
});

test("T1.AC4: two terminals (builder + reviewer) produce a 2-entry roster, no baton-file collision", () => {
  const repo = freshRepo();
  try {
    const b = claimRole(repo, "builder", { pid: "h:1:builderA", nowUtc: NOW });
    const r = claimRole(repo, "reviewer", { pid: "h:9:reviewerZ", nowUtc: nowPlus(1) });
    assert.equal(b.ok, true);
    assert.equal(r.ok, true);

    // rank-ordered 2-entry roster
    assert.deepEqual(liveRoster(repo, { nowUtc: nowPlus(2) }), ["builder", "reviewer"]);

    // two distinct lease files, no collision; each commit touched only its own file
    const leaseDir = join(repo, "presence");
    assert.deepEqual(readdirSync(leaseDir).sort(), ["builder.lease.json", "reviewer.lease.json"]);
    assert.deepEqual(lastCommitFiles(repo), ["presence/reviewer.lease.json"], "reviewer commit isolated");

    // and there is no LOOP-STATE.md churn from presence ops (routing is a separate concern/file)
    assert.equal(existsSync(join(repo, "LOOP-STATE.md")), false, "presence ops never touch the baton file");
  } finally { cleanup(repo); }
});

// ---------------------------------------------------------------------------
// TASK 2: baton-io against a real repo (routing cursor in LOOP-STATE.md).
// ---------------------------------------------------------------------------

test("T2.AC1: a stale reviewer lease is skipped; the builder keeps getting turns", () => {
  const repo = freshRepo();
  try {
    initState(repo);
    claimRole(repo, "builder", { pid: "h:1:builderA", ttlSeconds: 90, nowUtc: NOW });
    claimRole(repo, "reviewer", { pid: "h:9:reviewerZ", ttlSeconds: 90, nowUtc: NOW });
    // age reviewer so it is NOT live; builder stays live (heartbeat at NOW, judged a few s later)
    ageLeaseOnDisk(repo, "reviewer", nowPlus(-300));

    // roster at this instant is builder-only
    assert.deepEqual(liveRoster(repo, { nowUtc: nowPlus(5) }), ["builder"], "stale reviewer is gone");

    // two consecutive ticks: builder must hold the turn both times (reviewer never appears)
    const t1 = tick(repo, { nowUtc: nowPlus(5) });
    assert.equal(t1.acted, true);
    assert.equal(t1.to, "builder", "tick 1 routes to builder");
    const t2 = tick(repo, { nowUtc: nowPlus(6) });
    assert.equal(t2.acted, true);
    assert.equal(t2.to, "builder", "tick 2 still builder (reviewer stale -> skipped)");

    // cursor on disk reflects builder and a monotonically advanced epoch
    const st = readState(repo);
    assert.equal(st.cursor.turn, "builder");
    assert.ok(st.cursor.epoch >= 2, "epoch advanced on each reassigning tick");
  } finally { cleanup(repo); }
});

test("T2.AC2: a role that dies holding the turn is reclaimed (epoch+1) and the loop does not deadlock", () => {
  const repo = freshRepo();
  try {
    initState(repo);
    claimRole(repo, "builder", { pid: "h:1:builderA", ttlSeconds: 90, nowUtc: NOW });
    claimRole(repo, "reviewer", { pid: "h:9:reviewerZ", ttlSeconds: 90, nowUtc: NOW });

    // give the turn to reviewer (both live): builder -> reviewer
    const handoff = tick(repo, { nowUtc: nowPlus(5) }); // from null holder -> first live (builder)
    const handoff2 = tick(repo, { nowUtc: nowPlus(6) }); // builder -> reviewer
    assert.equal(handoff.to, "builder");
    assert.equal(handoff2.to, "reviewer", "turn handed to reviewer");
    const epochAfterHandoff = readState(repo).cursor.epoch;

    // reviewer DIES while holding the turn (age its lease past ttl)
    ageLeaseOnDisk(repo, "reviewer", nowPlus(-300));
    assert.deepEqual(liveRoster(repo, { nowUtc: nowPlus(7) }), ["builder"], "reviewer dead, builder live");

    // next tick must RECLAIM from the dead holder, bump epoch, and not deadlock
    const reclaimed = tick(repo, { nowUtc: nowPlus(7) });
    assert.equal(reclaimed.acted, true, "loop did not deadlock");
    assert.equal(reclaimed.kind, "reclaim", "it was a reclaim, not a normal advance");
    assert.equal(reclaimed.to, "builder", "turn reclaimed to the live builder");
    assert.equal(reclaimed.toEpoch, epochAfterHandoff + 1, "reclaim bumped epoch by exactly 1");

    const st = readState(repo);
    assert.equal(st.cursor.turn, "builder");
    assert.equal(st.cursor.epoch, epochAfterHandoff + 1);
  } finally { cleanup(repo); }
});

test("T2.AC3: a second write carrying a stale epoch is rejected; only the monotonic next-epoch write lands", () => {
  const repo = freshRepo();
  try {
    initState(repo);
    claimRole(repo, "builder", { pid: "h:1:builderA", ttlSeconds: 90, nowUtc: NOW });

    // baseline cursor: epoch 0, parked
    const base = readState(repo).cursor;
    assert.equal(base.epoch, 0);

    // the legitimate next write: epoch 1 (currentEpoch+1) lands
    const good = writeCursor(repo, { turn: "builder", epoch: 1 });
    assert.equal(good.ok, true, "monotonic next-epoch write accepted");
    assert.equal(readState(repo).cursor.epoch, 1);
    const headAfterGood = git(repo, ["rev-parse", "HEAD"]);

    // a zombie write carrying a STALE epoch (1, when current is already 1) is rejected
    const stale = writeCursor(repo, { turn: "reviewer", epoch: 1 });
    assert.equal(stale.ok, false, "stale-epoch write rejected");
    assert.equal(stale.reason, "stale-epoch");

    // a behind epoch (0) is likewise rejected
    const behind = writeCursor(repo, { turn: "reviewer", epoch: 0 });
    assert.equal(behind.ok, false, "behind-epoch write rejected");

    // a skipped-ahead epoch (3, when current is 1) is rejected (must be exactly +1)
    const ahead = writeCursor(repo, { turn: "reviewer", epoch: 3 });
    assert.equal(ahead.ok, false, "non-monotonic skip rejected");

    // disk + git are UNCHANGED by all the rejected writes: still builder @ epoch 1, same HEAD
    const st = readState(repo);
    assert.equal(st.cursor.turn, "builder", "rejected writes did not move the cursor");
    assert.equal(st.cursor.epoch, 1);
    assert.equal(git(repo, ["rev-parse", "HEAD"]), headAfterGood, "no commit from rejected writes");

    // the ONLY legitimate continuation (epoch 2) lands and reassigns
    const next = writeCursor(repo, { turn: "reviewer", epoch: 2 });
    assert.equal(next.ok, true, "the monotonic next-epoch write lands");
    assert.equal(readState(repo).cursor.turn, "reviewer");
    assert.equal(readState(repo).cursor.epoch, 2);
  } finally { cleanup(repo); }
});

// ---------------------------------------------------------------------------
// Cross-cutting: routing state (cursor) is structurally SEPARATE from work state (body).
// ---------------------------------------------------------------------------

test("T2.AC4 (separation): a routing write preserves an edited work-state body verbatim", () => {
  const repo = freshRepo();
  try {
    initState(repo);
    // a human edits the BODY (outside the routing sentinel block)
    const p = join(repo, "LOOP-STATE.md");
    const original = readFileSync(p, "utf8");
    const edited = original.replace("(none yet)", "BUILDER: finished module X, REVIEWER please verify.");
    writeFileSync(p, edited);
    git(repo, ["add", "--", "LOOP-STATE.md"]);
    git(repo, ["commit", "-q", "-m", "work: builder note", "--", "LOOP-STATE.md"]);

    // now move the cursor via the runner
    const r = writeCursor(repo, { turn: "reviewer", epoch: 1 });
    assert.equal(r.ok, true);

    // the body note survives; the cursor moved
    const after = readState(repo);
    assert.ok(after.body.includes("BUILDER: finished module X"), "work-state body preserved across routing write");
    assert.equal(after.cursor.turn, "reviewer", "routing cursor advanced");
    assert.equal(after.cursor.epoch, 1);
  } finally { cleanup(repo); }
});
