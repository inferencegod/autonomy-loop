#!/usr/bin/env node
// hooks/harden-control-plane.mjs - v0.8 "provision or refuse" PROVISION half: lock the control plane
// read-only so a bypassed gate cannot disable itself. This is the action the preflight's
// REFUSALS.controlPlaneWritable demands; once this runs, decidePreflight sees controlPlaneWritable:false.
//
// PURE CORE (no I/O, unit-tested): planHardening(cfg, platform) -> the ordered list of {path, kind} the
// runner must MATERIALIZE-THEN-LOCK. The runner does the fs.touch + chmod/chattr/icacls. No deps, no em
// dashes, fail-closed (a path we cannot lock is reported as a failure, never silently skipped).
//
// MATERIALIZE-THEN-LOCK is mandatory, not cosmetic. You cannot read-only-protect a file that does not
// exist: CVE-2026-25725 was exactly this. A sandbox tried to RO-bind a missing settings.json, the bind
// was a no-op because there was nothing there, the agent then CREATED the file and injected a hook into
// the gap. So for every target we touch an empty file if absent FIRST, then lock the now-existing inode.
// A directory is locked in place (its existing entries are not clobbered); we never touch a dir to a file.
//
// Locking, by platform:
//   POSIX: chmod a-w (strip every write bit) THEN chattr +i where available (immutable: beats even the
//          owner and, on most filesystems, root via the kernel attribute, so a root-equivalent agent
//          still cannot append). We PRINT guidance to chown the path to a non-agent user, because perms
//          the agent owns, the agent can in principle restore; ownership by another principal is the
//          durable barrier. chattr is best-effort (tmpfs / non-ext do not support it) but chmod is not.
//   Windows: icacls <path> /deny "<agentuser>:(W)" best-effort (deny write to the agent principal).
//
// Idempotent: re-running re-touches nothing already present and re-applies the same locks (a no-op).

import { existsSync, statSync, closeSync, openSync, chmodSync, readFileSync } from "node:fs";
import { join, isAbsolute } from "node:path";
import { execFileSync, execSync } from "node:child_process";
import { fileURLToPath } from "node:url";

// The plugin's own hooks/ dir, resolved relative to THIS file, so the lockdown always covers the gate's
// code even if the operator never listed it in protectedPaths. Returned as an absolute path.
export function pluginHooksDir() {
  return fileURLToPath(new URL(".", import.meta.url)).replace(/[\\/]+$/, "");
}

// PURE: the ordered hardening plan. Returns { targets: [{ path, source }], platform }.
//   cfg.protectedPaths : the operator's protected substrings/paths (relative to repoRoot or absolute)
//   opts.repoRoot      : base for resolving relative protectedPaths (default ".")
//   opts.pluginHooks    : the plugin hooks dir to always include (default pluginHooksDir())
//   opts.platform       : "win32" | posix-ish (default process.platform)
// De-duped, order-stable: protectedPaths first (in declared order), then the plugin hooks dir last.
// Empty/blank entries are dropped (fail-closed: we never emit a target we cannot name).
export function planHardening(cfg = {}, opts = {}) {
  const repoRoot = typeof opts.repoRoot === "string" && opts.repoRoot ? opts.repoRoot : ".";
  const platform = opts.platform || process.platform;
  const pluginHooks = typeof opts.pluginHooks === "string" && opts.pluginHooks ? opts.pluginHooks : pluginHooksDir();
  const raw = Array.isArray(cfg.protectedPaths) ? cfg.protectedPaths : [];
  const resolve = (p) => (isAbsolute(p) ? p : join(repoRoot, p));

  const seen = new Set();
  const targets = [];
  const push = (p, source) => {
    const s = typeof p === "string" ? p.trim() : "";
    if (!s) return;                       // drop blank entries, do not emit an unnameable target
    const abs = resolve(s);
    if (seen.has(abs)) return;            // de-dupe so a re-listed path is locked once
    seen.add(abs);
    targets.push({ path: abs, source });
  };
  for (const p of raw) push(p, "protectedPaths");
  push(pluginHooks, "pluginHooks");       // always lock the gate's own code, last so it is never skipped
  return { targets, platform };
}

// PURE: is a protectedPaths entry a directory-style target (trailing slash) vs a file? Used by the runner
// to decide touch-file vs leave-dir. A trailing slash is the house convention for a dir (see config).
export function isDirTarget(p) {
  return typeof p === "string" && /[\\/]$/.test(p);
}

// ---- thin runner (impure: fs + chmod/chattr/icacls) ----

function materialize(absPath, looksDir) {
  // Returns "exists" | "created-file" | "missing-dir". Touch-then-lock: create an empty file if absent so
  // there is an inode to protect. We never create a dir target (we cannot know its intended contents) and
  // we never clobber an existing dir into a file.
  if (existsSync(absPath)) return "exists";
  if (looksDir) return "missing-dir"; // report it; an absent dir target cannot be safely materialized blind
  try { closeSync(openSync(absPath, "a")); return "created-file"; } catch { return "create-failed"; }
}

function lockPosix(absPath, isDir, out) {
  // chmod a-w on the inode (strip u+g+o write). For a dir this removes the write bit so new entries cannot
  // be created in it; existing entries keep their own perms (we lock files we know about separately).
  try { chmodSync(absPath, isDir ? 0o555 : 0o444); out.chmod = true; } catch (e) { out.chmod = false; out.chmodErr = String(e && e.message || e); }
  // chattr +i: kernel immutable attribute. Beats the owner and, where the fs supports it, root. Best-effort.
  try { execFileSync("chattr", ["+i", absPath], { stdio: "pipe" }); out.chattr = true; }
  catch { out.chattr = false; } // tmpfs / non-ext / no chattr binary: chmod still holds, immutability does not
  return out;
}

function lockWindows(absPath, agentUser, out) {
  try { execFileSync("icacls", [absPath, "/deny", `${agentUser}:(W)`], { stdio: "pipe" }); out.icacls = true; }
  catch (e) { out.icacls = false; out.icaclsErr = String(e && e.message || e); }
  return out;
}

function currentUser(platform) {
  try {
    if (platform === "win32") return process.env.USERNAME || process.env.USER || "%USERNAME%";
    return process.env.USER || String(execSync("id -un", { stdio: ["ignore", "pipe", "ignore"] }).toString().trim()) || "$USER";
  } catch { return platform === "win32" ? "%USERNAME%" : "$USER"; }
}

function repoRoot() { try { return execSync("git rev-parse --show-toplevel", { encoding: "utf8" }).trim(); } catch { return process.cwd(); } }

function main(argv) {
  const args = Object.fromEntries(argv.slice(2).map((a) => { const m = a.match(/^--([^=]+)=(.*)$/); return m ? [m[1], m[2]] : [a.replace(/^--/, ""), true]; }));
  const base = args.repoRoot || repoRoot();
  const cfgPath = args.config || join(base, "autonomy.config.json");
  let cfg = {};
  try { cfg = JSON.parse(readFileSync(cfgPath, "utf8")); }
  catch { process.stderr.write(`[harden] WARNING: ${cfgPath} missing/unparseable; hardening the plugin hooks dir only.\n`); }

  const platform = process.platform;
  const agentUser = typeof args.agentuser === "string" ? args.agentuser : currentUser(platform);
  // We need the ORIGINAL relative strings to decide dir-vs-file, but planHardening returns absolutes; so we
  // pair each resolved target back to whether its source string looked like a dir.
  const declared = Array.isArray(cfg.protectedPaths) ? cfg.protectedPaths : [];
  const dirHint = new Map();
  for (const p of declared) { const s = typeof p === "string" ? p.trim() : ""; if (s) dirHint.set(isAbsolute(s) ? s : join(base, s), isDirTarget(s)); }

  const { targets } = planHardening(cfg, { repoRoot: base, platform });
  const report = [];
  let failures = 0;
  for (const t of targets) {
    const looksDir = dirHint.get(t.path) === true || (existsSync(t.path) && safeIsDir(t.path));
    const mat = materialize(t.path, looksDir);
    const isDir = looksDir || (existsSync(t.path) && safeIsDir(t.path));
    const lock = platform === "win32" ? lockWindows(t.path, agentUser, {}) : lockPosix(t.path, isDir, {});
    const ok = mat !== "create-failed" && mat !== "missing-dir"
      && (platform === "win32" ? lock.icacls === true : lock.chmod === true);
    if (!ok) failures++;
    report.push({ path: t.path, source: t.source, materialize: mat, ...lock, ok });
  }

  for (const r of report) {
    const lockStr = platform === "win32"
      ? `icacls-deny=${r.icacls}`
      : `chmod=${r.chmod} chattr=${r.chattr}`;
    process.stdout.write(`[harden] ${r.ok ? "OK " : "FAIL"} ${r.materialize.padEnd(13)} ${lockStr}  ${r.path}\n`);
  }
  if (platform !== "win32") {
    process.stdout.write(
      "[harden] GUIDANCE: chmod/chattr that the agent uid set, a root-equivalent agent could in principle reset.\n"
      + "[harden] The durable barrier is OWNERSHIP by a non-agent principal. As a non-agent admin, run:\n"
      + `[harden]   sudo chown -R <non-agent-user> ${JSON.stringify(targets.map((t) => t.path))}\n`
      + "[harden] then re-run this hook as that user so chattr +i is set under an owner the agent is not.\n"
    );
  }
  process.stdout.write(`[harden] ${failures === 0 ? "all targets locked." : failures + " target(s) FAILED to lock (see above)."}\n`);
  process.exit(failures === 0 ? 0 : 1); // fail-closed: a target we could not lock is a non-zero exit
}

function safeIsDir(p) { try { return statSync(p).isDirectory(); } catch { return false; } }

// run only when invoked directly, never on import (so tests import the pure core without side effects)
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main(process.argv);
