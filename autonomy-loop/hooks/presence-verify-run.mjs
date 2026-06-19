// hooks/presence-verify-run.mjs - the IMPURE runner that feeds the pure verifyRoster core
// (presence-verify.mjs). For each presence/<role>.lease.json it stat's the file OWNER, probes a real
// HOLDER's liveness, and hands the assembled evidence to verifyRoster, which DECIDES. P0-3 (a forged
// roster: a fresh lease file with no live process) is closed here because liveness is a kernel fact
// (a flock another process holds), not a value the lease author can write.
//
// This layer is environment-coupled (fs.statSync, child_process flock, powershell Get-Acl) and is NOT
// in the pure unit suite; exercise it with the integration harness in test/preflight-run.integration.sh.
// Fail-closed everywhere: any probe error degrades to "no evidence" (not separated, not live), never to
// a false positive and never throws out of verifyPresence.
//
// LIVENESS MODEL: a holder keeps presence/<role>.lock open under an exclusive flock for as long as it
// lives. We make a NON-BLOCKING exclusive flock attempt on that same path; the kernel denies it (the
// child exits non-zero) exactly while a live holder is on it, and grants it (exit 0) when the file has
// no holder. A granted lock is released the instant our short-lived child exits, so the probe never
// itself becomes a phantom holder. No live holder => liveness[role] = false => verifyRoster: ABSENT.

import { spawnSync } from "node:child_process";
import { statSync, readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { verifyRoster } from "./presence-verify.mjs";

const PRESENCE_DIR = "presence";

// ownerUid: the POSIX uid that owns the lease file. On Windows fs.statSync().uid is always 0 and inert,
// so we leave ownerUid undefined there and rely on ownerSid instead. Fail-closed: undefined on error.
function ownerUid(path) {
  if (process.platform === "win32") return undefined;
  try {
    return statSync(path).uid;
  } catch {
    return undefined;
  }
}

// ownerSid: the Windows owner SID via PowerShell Get-Acl, best-effort. Empty/undefined on any failure
// (no powershell, access denied, not Windows). verifyRoster treats a missing SID as not-separated.
function ownerSid(path) {
  if (process.platform !== "win32") return undefined;
  try {
    const r = spawnSync(
      "powershell",
      ["-NoProfile", "-NonInteractive", "-Command", `(Get-Acl -LiteralPath '${path.replace(/'/g, "''")}').Owner`],
      { encoding: "utf8", timeout: 4000 }
    );
    if (r.status !== 0 || !r.stdout) return undefined;
    const sid = r.stdout.trim();
    return sid.length ? sid : undefined;
  } catch {
    return undefined;
  }
}

// selfSid: this process's own owner SID on Windows, so verifyRoster can compare builder vs lease owner.
// Best-effort; undefined off-Windows or on any failure.
function selfSid() {
  if (process.platform !== "win32") return undefined;
  try {
    const r = spawnSync("powershell", ["-NoProfile", "-NonInteractive", "-Command", "[System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value"], { encoding: "utf8", timeout: 4000 });
    if (r.status !== 0 || !r.stdout) return undefined;
    const sid = r.stdout.trim();
    return sid.length ? sid : undefined;
  } catch {
    return undefined;
  }
}

// liveHolder: is a real process holding presence/<role>.lock right now?
// A non-blocking exclusive flock attempt: the child exits non-zero WHILE a holder is on the lock (kernel
// denies the conflicting lock) and 0 when the file is unheld. So "could NOT acquire" == a live holder.
// Fail-closed: if flock is unavailable or the probe errors, report NOT live (never a false positive).
function liveHolder(repo, role) {
  const lockPath = join(repo, PRESENCE_DIR, `${role}.lock`);
  try {
    // -w 0: do not wait; -x: exclusive; -c true: acquire, run a no-op, release on child exit.
    const r = spawnSync("flock", ["-w", "0", "-x", lockPath, "-c", "true"], { stdio: "ignore", timeout: 4000 });
    if (r.error) return false;       // flock binary missing / spawn failure -> fail-closed
    if (r.status === 0) return false; // WE acquired it -> no live holder was present
    if (r.status === 1) return true;  // could not acquire within 0s -> a live holder is on the lock
    return false;                     // any other status (124 timeout, signal) -> fail-closed
  } catch {
    return false;
  }
}

// readLeaseFiles: list { role, path, lease } for every presence/<role>.lease.json. Corrupt JSON is
// skipped (the pure core would ignore it anyway; this just keeps the input clean).
function readLeaseFiles(repo) {
  const dir = join(repo, PRESENCE_DIR);
  if (!existsSync(dir)) return [];
  const out = [];
  let names = [];
  try { names = readdirSync(dir); } catch { return []; }
  for (const f of names) {
    if (!f.endsWith(".lease.json")) continue;
    const path = join(dir, f);
    let lease;
    try { lease = JSON.parse(readFileSync(path, "utf8")); } catch { continue; }
    if (!lease || !lease.role) continue;
    out.push({ role: lease.role, path, lease });
  }
  return out;
}

// verifyPresence(repo, nowUtc): build verifyRoster's input from real stat + lock probes and return its
// result { present, byRole, reviewer }. Never throws; fail-closed empty roster on a total failure.
export function verifyPresence(repo, nowUtc = new Date().toISOString()) {
  let files = [];
  try { files = readLeaseFiles(repo); } catch { files = []; }

  const leases = [];
  const liveness = {};
  for (const { role, path, lease } of files) {
    leases.push({
      role,
      ownerUid: ownerUid(path),
      ownerSid: ownerSid(path),
      heartbeatUtc: lease.heartbeatUtc,
      ttlSeconds: lease.ttlSeconds,
      pid: lease.pid,
    });
    liveness[role] = liveHolder(repo, role);
  }

  const self = {
    uid: process.getuid ? process.getuid() : undefined,
    sid: selfSid(),
    platform: process.platform,
  };

  return verifyRoster({ leases, liveness, self, nowUtc });
}

export const _internal = { ownerUid, ownerSid, selfSid, liveHolder, readLeaseFiles, PRESENCE_DIR };
