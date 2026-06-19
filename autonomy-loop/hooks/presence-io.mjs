// autonomy-loop: presence-io. The IMPURE wrapper around the pure presence core (presence.mjs).
// Reads/writes per-role lease files under presence/ and commits them. This is the only layer that
// touches the filesystem and git; all DECISIONS live in presence.mjs and stay unit-tested.
//
// INTEGRATION NOTES (wire these into the real plugin):
//   - claimRole() is called at SessionStart for a terminal (which role it is comes from the
//     command, e.g. /autonomy-loop:builder -> role "builder").
//   - renewLease() is called on each turn tick and on a timer (renewEverySeconds).
//   - liveRoster() is called by the scheduler/safety-floor before deciding.
//   - Commits here are deliberately small and touch ONLY presence/<role>.lease.json so they never
//     collide with the baton's single-writer discipline.
//   - This file is environment-coupled (child_process git); it is NOT unit-tested in the pure
//     suite. Test it with an integration harness against a scratch repo.
//
// HARDENING over the provided glue:
//   - Writes are atomic (write temp + rename) so a concurrent reader never sees half a file; the
//     pure core skips corrupt JSON anyway, this just removes the window.
//   - claimRole re-reads leases immediately before writing (a second canClaim check) to shrink the
//     check-then-act race when two terminals start at once; the loser is refused fail-closed.
//   - commitLease is fully path-scoped: it stages ONLY this role's lease file and commits with an
//     explicit pathspec, so an unrelated dirty working tree is never swept into a presence commit.
//   - Every git invocation is wrapped; a missing remote / offline state degrades to a local commit
//     and never throws out of the public functions (fail-closed: refuse, do not crash the loop).

import { execFileSync } from "node:child_process";
import { writeFileSync, readFileSync, readdirSync, mkdirSync, existsSync, renameSync } from "node:fs";
import { join } from "node:path";
import { isLive, roster, canClaim } from "./presence.mjs";

const PRESENCE_DIR = "presence";

function git(args, cwd) {
  // Capture stderr instead of inheriting it to the parent console. These calls are best-effort and
  // wrapped by gitQuiet, so an offline pull / a missing push remote must degrade SILENTLY, never spew
  // git warnings or fatals into the loop's output. stdout is still captured and returned.
  return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

// gitQuiet: run git but never throw; returns { ok, out } so callers can degrade gracefully. The
// captured stderr (not the generic "Command failed" line) is surfaced as out for any caller that logs.
function gitQuiet(args, cwd) {
  try {
    return { ok: true, out: git(args, cwd) };
  } catch (err) {
    const msg = (err && (err.stderr || err.message)) || err;
    return { ok: false, out: String(msg).trim() };
  }
}

function leaseRel(role) {
  return join(PRESENCE_DIR, `${role}.lease.json`);
}

function leasePath(repo, role) {
  return join(repo, leaseRel(role));
}

function ensureDir(repo) {
  const dir = join(repo, PRESENCE_DIR);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

// writeAtomic: write to a temp sibling then rename over the target. rename is atomic on the same
// filesystem, so a reader either sees the old file or the new one, never a truncated one.
function writeAtomic(path, contents) {
  const tmp = `${path}.tmp-${process.pid}-${Date.now()}`;
  writeFileSync(tmp, contents);
  renameSync(tmp, path);
}

function readAllLeases(repo) {
  const dir = join(repo, PRESENCE_DIR);
  if (!existsSync(dir)) return [];
  const out = [];
  for (const f of readdirSync(dir)) {
    if (!f.endsWith(".lease.json")) continue;
    try { out.push(JSON.parse(readFileSync(join(dir, f), "utf8"))); } catch { /* skip corrupt */ }
  }
  return out;
}

// makePid: a unique claim identity for this process.
export function makePid() {
  const host = process.env.HOSTNAME || "host";
  const uuid = (globalThis.crypto?.randomUUID?.() || String(Math.random()).slice(2));
  return `${host}:${process.pid}:${uuid}`;
}

// claimRole: attempt to claim `role`. Returns { ok, pid } or { ok:false, heldBy }.
// Fail-closed: if another process holds a LIVE lease for this role, refuse. Unknown role is also
// refused (canClaim returns false for it).
export function claimRole(repo, role, { ttlSeconds = 90, epoch = 1, pid = makePid(), nowUtc = new Date().toISOString() } = {}) {
  ensureDir(repo);
  // Pull latest presence state first so we see other terminals' claims.
  gitQuiet(["pull", "--ff-only"], repo); // offline / no remote: proceed locally
  const leases = readAllLeases(repo);
  if (!canClaim(role, pid, leases, nowUtc)) {
    const held = leases.find((l) => l.role === role && isLive(l, nowUtc));
    return { ok: false, heldBy: held?.pid ?? "unknown" };
  }
  // Re-read immediately before writing: shrink the check-then-act window if another terminal
  // claimed the same role between our pull and now. Still refuse fail-closed on a fresh conflict.
  const recheck = readAllLeases(repo);
  if (!canClaim(role, pid, recheck, nowUtc)) {
    const held = recheck.find((l) => l.role === role && isLive(l, nowUtc));
    return { ok: false, heldBy: held?.pid ?? "unknown" };
  }
  const lease = { role, pid, epoch, heartbeatUtc: nowUtc, ttlSeconds, claimedAtUtc: nowUtc };
  writeAtomic(leasePath(repo, role), JSON.stringify(lease, null, 2) + "\n");
  commitLease(repo, role, `presence: claim ${role}`);
  return { ok: true, pid };
}

// renewLease: refresh this process's own lease heartbeat. Touches only its own file.
// Refuses (fail-closed) if the lease is missing, corrupt, or owned by another pid.
export function renewLease(repo, role, { pid, epoch, ttlSeconds = 90, nowUtc = new Date().toISOString() } = {}) {
  const p = leasePath(repo, role);
  if (!existsSync(p)) return { ok: false, reason: "no-lease-to-renew" };
  let lease;
  try { lease = JSON.parse(readFileSync(p, "utf8")); } catch { return { ok: false, reason: "corrupt-lease" }; }
  if (pid && lease.pid !== pid) return { ok: false, reason: "not-my-lease" }; // someone else owns it
  lease.heartbeatUtc = nowUtc;
  if (epoch !== undefined) lease.epoch = epoch;
  if (ttlSeconds !== undefined) lease.ttlSeconds = ttlSeconds;
  writeAtomic(p, JSON.stringify(lease, null, 2) + "\n");
  commitLease(repo, role, `presence: renew ${role}`);
  return { ok: true };
}

// liveRoster: the rank-ordered list of live roles right now (pulls latest first).
export function liveRoster(repo, { nowUtc = new Date().toISOString() } = {}) {
  gitQuiet(["pull", "--ff-only"], repo); // proceed locally if offline
  return roster(readAllLeases(repo), nowUtc);
}

// allLeases: raw lease objects (for the baton layer, which needs pids/epochs, not just roles).
export function allLeases(repo) {
  return readAllLeases(repo);
}

// commitLease: stage and commit ONLY this role's lease file with an explicit pathspec, so an
// unrelated dirty tree is never swept in. No-op-clean (nothing staged) is treated as success.
function commitLease(repo, role, msg) {
  const rel = leaseRel(role);
  const add = gitQuiet(["add", "--", rel], repo);
  if (!add.ok) return; // could not stage (e.g. not a repo): heartbeat file still written locally
  // Commit only the pathspec; if nothing changed, git exits non-zero and we treat it as fine.
  gitQuiet(["commit", "-m", msg, "--", rel], repo);
  gitQuiet(["push"], repo); // offline: local commit stands, pushes on next renew
}
