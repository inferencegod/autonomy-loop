#!/usr/bin/env node
// hooks/preflight-run.mjs - the SessionStart RUNNER (impure layer) for the pure decidePreflight core
// (preflight.mjs). v0.8 "provision or refuse": measure the ACTUAL assurance of this setup and, if the
// gate cannot defend itself, REFUSE TO START (non-zero exit blocks the session) instead of warning and
// continuing. Gathers four probes, calls decidePreflight, then either blocks with the mapped REFUSALS
// strings or prints the banner and persists allowUnattended for the loop / promotion-guard to read.
//
// FAIL-CLOSED throughout: an unmeasurable probe resolves to its UNSAFE value, never its safe one. A
// writable-or-unprovable control plane means the gate could disable itself, so we refuse to start; a
// prod-protection probe we cannot run resolves to "unprotected"; an absent sandbox resolves to "not
// live". The only thing that lifts a refusal is positive, measured evidence.

import { spawnSync } from "node:child_process";
import { openSync, closeSync, writeSync, unlinkSync, existsSync, statSync, readFileSync, writeFileSync, constants as FS } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { decidePreflight, REFUSALS } from "./preflight.mjs";
import { verifyPresence } from "./presence-verify-run.mjs";

const HERE = dirname(fileURLToPath(import.meta.url)); // the plugin hooks/ dir
const STATE_FILE = ".autonomy-preflight.json";

// repoRoot: the git toplevel, or cwd if not in a repo (matches the house convention in migrate-config).
function repoRoot(cwd) {
  try {
    const r = spawnSync("git", ["rev-parse", "--show-toplevel"], { cwd, encoding: "utf8" });
    if (r.status === 0 && r.stdout) return r.stdout.trim();
  } catch { /* fall through */ }
  return cwd;
}

// readConfig: autonomy.config.json at the repo root. Fail-closed to {} (decidePreflight then defaults
// requireProdProtection=true and demands every rail).
function readConfig(root) {
  try {
    return JSON.parse(readFileSync(join(root, "autonomy.config.json"), "utf8"));
  } catch {
    return {};
  }
}

// ---- PROBE 1: controlPlaneWritable -------------------------------------------------------------
// Attempt an O_APPEND temp-create write, as the agent uid, against every protectedPath entry plus the
// plugin hooks/ dir. ANY success => the gate can rewrite its own config/hooks/leases => writable=true.
// A target counts as LOCKED only on a clean permission/read-only denial (EACCES/EPERM/EROFS); any other
// error is ambiguous and, fail-closed, counts as writable so the setup is refused rather than trusted.
function looksLikeDir(p) {
  try { return statSync(p).isDirectory(); } catch { return p.endsWith("/") || p.endsWith("\\"); }
}

function targetWritable(target, root) {
  // Resolve a config substring entry to an absolute path under the repo; absolute entries pass through.
  const abs = target.startsWith("/") || /^[A-Za-z]:[\\/]/.test(target) ? target : join(root, target);
  // We never mutate a real protected file: we create-and-remove a sibling probe file. If the parent
  // dir itself is locked, the create fails with EACCES/EPERM (the dir is read-only => good). If it is a
  // file path, probe its directory; a writable dir is enough for an attacker to swap the file.
  const probeDir = looksLikeDir(abs) ? abs : dirname(abs);
  const probe = join(probeDir, `.autonomy-wtest-${process.pid}-${Date.now()}`);
  let fd;
  try {
    fd = openSync(probe, FS.O_CREAT | FS.O_APPEND | FS.O_WRONLY, 0o600);
    try { writeSync(fd, "x"); } catch { /* opened but could not write: still effectively writable */ }
    return true; // create succeeded => the location is agent-writable
  } catch (err) {
    const code = err && err.code;
    if (code === "EACCES" || code === "EPERM" || code === "EROFS") return false; // provably locked
    if (code === "ENOENT") return false; // target/dir does not exist => nothing to protect here
    return true; // ambiguous failure -> fail-closed to writable so the gate refuses to start
  } finally {
    if (fd !== undefined) { try { closeSync(fd); } catch { /* ignore */ } }
    try { unlinkSync(probe); } catch { /* probe may not exist; ignore */ }
  }
}

function probeControlPlaneWritable(root, cfg) {
  const protectedPaths = Array.isArray(cfg.protectedPaths) ? cfg.protectedPaths : [];
  const targets = [...protectedPaths, HERE]; // always include the plugin hooks/ dir itself
  for (const t of targets) {
    try { if (targetWritable(t, root)) return true; }
    catch { return true; } // any unhandled error -> fail-closed to writable
  }
  return false;
}

// ---- PROBE 2: prodProtected --------------------------------------------------------------------
// gh api repos/{owner}/{repo}/rules/branches/{prodBranch}; protected iff the active rules include BOTH
// a pull_request rule and a non_fast_forward rule (server-side required review + no force-push that the
// agent token cannot bypass). Fail-closed to FALSE on any error: missing gh, no remote, API failure,
// unparseable JSON, or either rule absent.
function ghRepoSlug(root) {
  try {
    const r = spawnSync("git", ["remote", "get-url", "origin"], { cwd: root, encoding: "utf8" });
    if (r.status !== 0 || !r.stdout) return null;
    const url = r.stdout.trim();
    // git@github.com:owner/repo.git  |  https://github.com/owner/repo(.git)
    const m = url.match(/[:/]([^/:]+)\/([^/]+?)(?:\.git)?$/);
    if (!m) return null;
    return { owner: m[1], repo: m[2] };
  } catch {
    return null;
  }
}

function probeProdProtected(root, prodBranch) {
  const slug = ghRepoSlug(root);
  if (!slug) return false; // no remote / unparseable => cannot prove protection => fail-closed
  try {
    const r = spawnSync(
      "gh",
      ["api", `repos/${slug.owner}/${slug.repo}/rules/branches/${prodBranch}`],
      { cwd: root, encoding: "utf8", timeout: 8000 }
    );
    if (r.error || r.status !== 0 || !r.stdout) return false; // gh missing / API error => fail-closed
    let rules;
    try { rules = JSON.parse(r.stdout); } catch { return false; }
    if (!Array.isArray(rules)) return false;
    const types = new Set(rules.map((x) => x && x.type));
    return types.has("pull_request") && types.has("non_fast_forward");
  } catch {
    return false;
  }
}

// ---- PROBE 3: sandboxLive ----------------------------------------------------------------------
// Optional: import sandboxLive() from ./sandbox-detect.mjs if that module exists; else false.
async function probeSandboxLive() {
  const mod = join(HERE, "sandbox-detect.mjs");
  if (!existsSync(mod)) return false;
  try {
    const m = await import("./sandbox-detect.mjs");
    return m.sandboxLive ? m.sandboxLive() === true : false;
  } catch {
    return false; // a broken detector must not be read as "sandboxed"
  }
}

// ---- flags / config knobs ----------------------------------------------------------------------
// Attended-only escape hatch: --i-accept-reduced-assurance flag OR AUTONOMY_ACCEPT_REDUCED_ASSURANCE=1.
function acceptReducedAssurance(argv, env) {
  if (argv && argv.includes("--i-accept-reduced-assurance")) return true;
  const v = env && env.AUTONOMY_ACCEPT_REDUCED_ASSURANCE;
  return v === "1" || v === "true";
}

// requireProdProtection lives under gate.* in the config (per the REFUSAL copy); accept a flat
// top-level key too. Default true. Pass it to decidePreflight as the flat key the core reads.
function requireProdProtection(cfg) {
  if (cfg && cfg.gate && typeof cfg.gate.requireProdProtection === "boolean") return cfg.gate.requireProdProtection;
  if (cfg && typeof cfg.requireProdProtection === "boolean") return cfg.requireProdProtection;
  return true;
}

// gatherAndDecide: run every probe, call the pure core, return { decision, probe }.
export async function gatherAndDecide(root, cfg, opts = {}) {
  const prodBranch = (cfg && cfg.prodBranch) || "main";

  let controlPlaneWritable, prodProtected, sandboxLive, reviewer;
  try { controlPlaneWritable = probeControlPlaneWritable(root, cfg); } catch { controlPlaneWritable = true; }
  try { prodProtected = probeProdProtected(root, prodBranch); } catch { prodProtected = false; }
  try { sandboxLive = await probeSandboxLive(); } catch { sandboxLive = false; }
  try {
    const rv = verifyPresence(root);
    reviewer = { live: rv.reviewer.live === true, separated: rv.reviewer.separated === true };
  } catch {
    reviewer = { live: false, separated: false }; // no measurable reviewer -> fail-closed absent
  }

  const probe = { controlPlaneWritable, prodProtected, sandboxLive, reviewer };
  const decisionCfg = {
    requireProdProtection: requireProdProtection(cfg),
    acceptReducedAssurance: opts.acceptReducedAssurance === true,
  };
  return { decision: decidePreflight(probe, decisionCfg), probe };
}

async function main() {
  const cwd = process.cwd();
  const root = repoRoot(cwd);
  const cfg = readConfig(root);
  const accept = acceptReducedAssurance(process.argv.slice(2), process.env);

  let decision, probe;
  try {
    ({ decision, probe } = await gatherAndDecide(root, cfg, { acceptReducedAssurance: accept }));
  } catch (e) {
    // A total failure to even gather probes is itself a refusal to start (fail-closed).
    process.stderr.write("[autonomy-loop preflight] could not establish assurance: " + (e && e.message) + "\n");
    process.exit(1);
  }

  if (!decision.allowStart) {
    process.stderr.write("[autonomy-loop] REFUSING TO START -- the gate cannot defend itself:\n");
    for (const key of decision.refusals) {
      if (REFUSALS[key]) process.stderr.write("  - " + REFUSALS[key] + "\n");
    }
    process.stderr.write("\n" + decision.banner + "\n");
    process.exit(1); // non-zero blocks the SessionStart
  }

  // Allowed to start. Persist the decision so the loop / promotion-guard reads allowUnattended without
  // re-probing, and surface any remaining refusals (auto-promotion may still be off) in the banner.
  try {
    const state = {
      tier: decision.tier,
      allowStart: decision.allowStart,
      allowUnattended: decision.allowUnattended,
      refusals: decision.refusals,
      probe,
      decidedAtUtc: new Date().toISOString(),
    };
    writeFileSync(join(root, STATE_FILE), JSON.stringify(state, null, 2) + "\n");
  } catch (e) {
    // If we cannot record the decision, do not silently let the loop assume unattended is allowed.
    process.stderr.write("[autonomy-loop preflight] WARNING: could not write " + STATE_FILE + ": " + (e && e.message) + "\n");
  }

  process.stdout.write(decision.banner + "\n");
  if (decision.refusals.length) {
    process.stdout.write("[autonomy-loop] attended run permitted; auto-promotion stays OFF until: " + decision.refusals.join(", ") + ".\n");
  }
  process.exit(0);
}

// Run main() only when executed directly (node hooks/preflight-run.mjs), never on import (tests import
// gatherAndDecide). Matches the invocation guard used by promotion-guard.mjs.
const __invokedPath = (process.argv[1] || "").replace(/\\/g, "/");
const __thisPath = decodeURIComponent(new URL(import.meta.url).pathname).replace(/^\/([A-Za-z]:)/, "$1");
if (__invokedPath && (__thisPath.endsWith(__invokedPath) || __invokedPath.endsWith(__thisPath))) {
  main().catch((e) => { process.stderr.write("[autonomy-loop preflight] " + (e && e.message) + "\n"); process.exit(1); });
}

export const _internal = { repoRoot, probeControlPlaneWritable, probeProdProtected, ghRepoSlug, requireProdProtection, acceptReducedAssurance, STATE_FILE };
