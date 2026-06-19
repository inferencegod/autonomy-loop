#!/usr/bin/env node
// autonomy-loop: verify-gate (the complementary-gate ROUTER). For most of this project's life the
// reviewer's verification step called ONE thing unconditionally: the golden-revert bite. That bite needs
// a baseline to revert to, so for brand-new code (GREENFIELD), an empty fix, or a behavior-preserving
// refactor it ERRORS (reverting deletes the unit the test imports) and reads as cannot-verify forever; or,
// if anyone "relaxes" that, it silently passes code whose test asserts nothing. With 200+ installs running
// autonomously, a wrong route ships bad code behind a green check. This router fixes that by dispatching
// each commit through the already-built pure classifyBite(): REGRESSION -> the golden-revert bite,
// GREENFIELD / EMPTY_FIX / REFACTOR_SUSPECT -> the mutation-bite runner, UNCLASSIFIABLE -> cannot-verify.
//
// This is the highest-risk change in the loop, so it ships behind gate.verifyGate (DEFAULT off) and
// fail-closed:
//   off    = NO-OP. Today's behavior exactly: defer to the existing golden-revert bite, exit with ITS code.
//            (The reviewer in 'off' calls bite.mjs directly; if this router is invoked in off it just defers.)
//   shadow = RUN the router (classify + dispatch) to compute the verdict it WOULD return, append a JSONL
//            line {ts,sha,wouldRoute,wouldDecide,...} to .autonomy-verify-shadow.log, but the EXISTING bite
//            still GOVERNS: exit with the current bite's code. The routed verdict does NOT govern.
//   govern = the routed verdict governs (exit with the routed exit). The JSONL keeps being written as audit.
//
// GLOBAL INVARIANT (the one rule the whole gate hangs on): never exit 0 without a recorded proof, i.e. a
// clean assertion RED from the golden bite (action caught) or a killed mutant from the mutation-bite
// (exit 0 with killed>=1). UNCLASSIFIABLE -> 2, no-kill / no-op -> 1, any router exception -> 2. There is
// no phase in which an unproven change can exit 0; in off/shadow the governing exit is the current bite's
// (which already fails closed), in govern the routed exit fails closed by construction.
//
// Reuses the pure classifyBite() core and shells to the existing runners (bite.mjs / mutation-bite.mjs);
// it forks NOTHING. No external deps. No em dashes anywhere.

import { execSync, spawnSync } from "node:child_process";
import { appendFileSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { classifyBite } from "./classify-bite.mjs";

const HOOKS_DIR = dirname(fileURLToPath(import.meta.url));
const NUM = (v, d) => { const n = Number(v); return Number.isFinite(n) ? n : d; };

function sh(cmd, cwd) { return execSync(cmd, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 64 * 1024 * 1024 }); }

// resolve the active mode: explicit --mode wins, else gate.verifyGate from a config, else the safe default.
// DEFAULT is "off" (the dangerous path stays dark until an owner opts in).
function resolveMode(args, repoRoot) {
  const cli = String(args.mode || "").toLowerCase();
  if (cli === "off" || cli === "shadow" || cli === "govern") return cli;
  const cfgPath = args.config ? args.config : (repoRoot ? join(repoRoot, "autonomy.config.json") : null);
  if (cfgPath) {
    try {
      const cfg = JSON.parse(readFileSync(cfgPath, "utf8"));
      const v = cfg && cfg.gate && typeof cfg.gate.verifyGate === "string" ? cfg.gate.verifyGate.toLowerCase() : "";
      if (v === "off" || v === "shadow" || v === "govern") return v;
    } catch { /* no config / unreadable -> default off */ }
  }
  return "off"; // fail-closed default: behave exactly like today's gate
}

// Resolve a relative import specifier from a test file to a repo-relative path, best-effort + static.
// Returns a NORMALIZED candidate path (no leading ./). A bare module specifier (a dependency) -> null.
// We do NOT emit a bare extensionless stem: classifyBite compares against real file paths, so a spurious
// stem would register as an "existing" import and wrongly defeat the GREENFIELD test. Extensionless specs
// are matched against the changed paths by trying the common source extensions (see importsOfTest).
function resolveImport(spec, testRel) {
  if (!spec || /^[a-z][a-z0-9+.-]*:/i.test(spec)) return null; // url/protocol
  if (!spec.startsWith(".") && !spec.startsWith("/")) return null; // bare module specifier (a dependency)
  const baseDir = dirname(testRel);
  let p = spec.startsWith("/") ? spec.replace(/^\/+/, "") : join(baseDir, spec);
  return p.replace(/\\/g, "/").replace(/^\.\//, "");
}
const SRC_EXTS = [".mjs", ".cjs", ".js", ".ts", ".tsx", ".jsx", ".mts", ".cts"];

// Parse a test FILE's static imports/requires into repo-relative source paths that ACTUALLY EXIST among
// the wave's changed paths (passed in). For an extensionless spec we expand to the changed file whose
// stem matches. This guarantees every emitted import is a real path classifyBite can compare, and never
// a spurious bare stem. changedPaths = the wave's changed-file paths (so we resolve to a real file).
function importsOfTest(absTestPath, testRel, changedPaths = []) {
  let src; try { src = readFileSync(absTestPath, "utf8"); } catch { return []; }
  const specs = new Set();
  const rxes = [
    /import\s+[^'"]*?from\s*['"]([^'"]+)['"]/g,
    /import\s*['"]([^'"]+)['"]/g,
    /import\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
    /require\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
  ];
  for (const rx of rxes) { let m; while ((m = rx.exec(src))) specs.add(m[1]); }
  const changed = new Set((changedPaths || []).map((p) => String(p).replace(/\\/g, "/")));
  const out = [];
  for (const s of specs) {
    const base = resolveImport(s, testRel);
    if (!base) continue;
    const hasExt = SRC_EXTS.some((e) => base.toLowerCase().endsWith(e));
    if (hasExt) { out.push(base); continue; }
    // extensionless: prefer a changed file whose path is base+<ext> or base/index.<ext>; else emit the
    // most likely candidate (base + ".mjs") so a net-new extensionless import still resolves to a path.
    let matched = null;
    for (const e of SRC_EXTS) { if (changed.has(base + e)) { matched = base + e; break; } }
    if (!matched) for (const e of SRC_EXTS) { if (changed.has(base + "/index" + e)) { matched = base + "/index" + e; break; } }
    out.push(matched || (base + ".mjs"));
  }
  return [...new Set(out)];
}

const TEST_RX = [/\.test\./, /\.spec\./, /(^|\/)tests?\//, /(^|\/)__tests__\//];
const isTestPath = (p) => TEST_RX.some((r) => r.test(String(p || "").toLowerCase()));

// Build the classifyBite input from git: changed-file statuses + the changed/added test file imports.
function buildClassifierInput(fixSha, repoRoot) {
  // status: A|M|D|R (added/modified/deleted/renamed). -M%/-R can append a score; take the first letter.
  const raw = sh(`git diff --name-status ${fixSha}~1 ${fixSha}`, repoRoot).trim();
  const changedFiles = [];
  const changedPaths = [];
  for (const line of raw.split("\n").filter(Boolean)) {
    const parts = line.split(/\t/);
    const status = parts[0].slice(0, 1).toUpperCase();
    // a rename row is "R100\told\tnew"; the NEW path is the last column.
    const path = parts[parts.length - 1];
    changedFiles.push({ path, status });
    changedPaths.push(path);
  }
  // gather imports from every changed/added test file (resolved against the fix worktree = the live tree).
  let testImports = [];
  for (const p of changedPaths) {
    if (!isTestPath(p)) continue;
    const abs = join(repoRoot, p);
    testImports = testImports.concat(importsOfTest(abs, p.replace(/\\/g, "/"), changedPaths));
  }
  return { changedFiles, testImports: [...new Set(testImports)] };
}

// Shell a runner and capture its exit code (and a short reason from its last stdout line).
function runRunner(file, runnerArgs, repoRoot) {
  const r = spawnSync(process.execPath, [join(HOOKS_DIR, file), ...runnerArgs], { cwd: repoRoot, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  const out = (r.stdout || "") + (r.stderr || "");
  const exit = typeof r.status === "number" ? r.status : 2; // a spawn failure / signal -> cannot-verify
  const lastLine = out.trim().split("\n").filter(Boolean).pop() || "";
  return { exit, reason: lastLine, out };
}

// Compute the ROUTED verdict: classify, then dispatch to the chosen runner. Pure-ish: only shells runners.
function routedVerdict(c, opts, repoRoot) {
  if (c.gate === "golden-revert") {
    const a = ["--fix=" + opts.fix, "--test=" + opts.test];
    if (opts.assertRegex) a.push("--assert-regex=" + opts.assertRegex);
    if (opts.runs != null) a.push("--runs=" + opts.runs);
    const r = runRunner("bite.mjs", a, repoRoot);
    return { exit: r.exit, reason: r.reason, proof: r.exit === 0 ? "caught" : null };
  }
  if (c.gate === "mutation-bite") {
    const a = ["--fix=" + opts.fix, "--test=" + opts.test];
    if (opts.coverage) a.push("--coverage=" + opts.coverage);
    if (opts.covFile) a.push("--cov-file=" + opts.covFile);
    if (opts.assertRegex) a.push("--assert-regex=" + opts.assertRegex);
    const r = runRunner("mutation-bite.mjs", a, repoRoot);
    // a routed 0 on the mutation path MUST carry a recorded killed mutant. The runner prints "exit 0:
    // killed N mutant(s)..."; if it somehow exits 0 without that proof, we DOWNGRADE to cannot-verify (2).
    const provedKill = r.exit === 0 && /\bkilled\s+\d+\s+mutant/i.test(r.reason || r.out || "");
    if (r.exit === 0 && !provedKill) return { exit: 2, reason: "INVARIANT GUARD: mutation-bite exit 0 without a recorded killed mutant; downgraded to cannot-verify", proof: null };
    return { exit: r.exit, reason: r.reason, proof: provedKill ? "killed" : null };
  }
  // UNCLASSIFIABLE (gate null) -> fail closed, no runner is run.
  return { exit: 2, reason: c.reason || "unclassifiable: no test constrains the change", proof: null };
}

function main(argv) {
  const args = Object.fromEntries(argv.slice(2).map((a) => { const m = a.match(/^--([^=]+)=(.*)$/); return m ? [m[1], m[2]] : [a.replace(/^--/, ""), true]; }));
  const fixSha = args.fix || args.sha || "HEAD";
  const testCmd = args.test;
  const coverage = args.coverage || null;
  const covFile = args["cov-file"] || null;
  const assertRegex = args["assert-regex"] || null;
  const runs = args.runs != null ? NUM(args.runs, 3) : null;

  if (!testCmd) { console.error('[verify-gate] need --test "<command that runs ONLY the new test>". Optional: --fix=<sha> --coverage="<cmd>" --assert-regex=<re> --mode=off|shadow|govern --log=<path>'); process.exit(2); }
  if (!/^[0-9A-Za-z_./^~-]+$/.test(fixSha)) { console.error(`[verify-gate] refusing a fix ref with unexpected characters: ${fixSha}`); process.exit(2); }

  // FAIL-CLOSED WRAPPER: any exception below is a cannot-verify (exit 2), never a pass.
  try {
    let repoRoot;
    try { repoRoot = sh("git rev-parse --show-toplevel").trim(); }
    catch (e) { console.error(`[verify-gate] not a git repo / cannot resolve root: ${e && e.message}`); process.exit(2); }

    const mode = resolveMode(args, repoRoot);
    const logPath = args.log ? (String(args.log).match(/^([A-Za-z]:[\\/]|[\\/])/) ? String(args.log) : join(repoRoot, String(args.log))) : join(repoRoot, ".autonomy-verify-shadow.log");
    const sha = (() => { try { return sh(`git rev-parse ${fixSha}`, repoRoot).trim(); } catch { return fixSha; } })();

    // ---- mode OFF: pure no-op. Defer to the existing golden-revert bite, exit with ITS code. ----
    // (Byte-for-byte today's behavior. No classification, no logging, no new path exercised.)
    if (mode === "off") {
      const a = ["--fix=" + fixSha, "--test=" + testCmd];
      if (assertRegex) a.push("--assert-regex=" + assertRegex);
      if (runs != null) a.push("--runs=" + runs);
      const r = runRunner("bite.mjs", a, repoRoot);
      if (r.out) process.stdout.write(r.out.endsWith("\n") ? r.out : r.out + "\n");
      process.exit(r.exit);
    }

    // ---- shadow + govern: RUN the router. ----
    const input = buildClassifierInput(fixSha, repoRoot);
    const c = classifyBite(input);
    const opts = { fix: fixSha, test: testCmd, coverage, covFile, assertRegex, runs };
    const routed = routedVerdict(c, opts, repoRoot);

    // common shadow/audit record. Includes the task's named fields (wouldRoute / wouldDecide) AND the
    // spec's fields (case / gate / routedExit / currentExit / agree / reason) so nothing is lost.
    const rec = {
      ts: new Date().toISOString(),
      sha,
      mode,
      wouldRoute: c.case,                 // GREENFIELD | REGRESSION | EMPTY_FIX | REFACTOR_SUSPECT | UNCLASSIFIABLE
      wouldDecide: routed.exit,           // the exit code the routed verdict WOULD return
      case: c.case,
      gate: c.gate,                       // golden-revert | mutation-bite | null
      routedExit: routed.exit,
      proof: routed.proof,                // "caught" | "killed" | null  (the recorded proof, if any)
      reason: routed.reason,
    };

    if (mode === "shadow") {
      // The CURRENT bite governs. Run it and let ITS exit be the gate's real exit. The routed verdict is
      // computed + logged but does NOT govern: behavior on disk is byte-identical to the off path.
      const a = ["--fix=" + fixSha, "--test=" + testCmd];
      if (assertRegex) a.push("--assert-regex=" + assertRegex);
      if (runs != null) a.push("--runs=" + runs);
      const current = runRunner("bite.mjs", a, repoRoot);
      rec.currentExit = current.exit;
      rec.agree = routed.exit === current.exit;
      try { appendFileSync(logPath, JSON.stringify(rec) + "\n"); } catch (e) { console.error(`[verify-gate] shadow log append failed (non-fatal): ${e && e.message}`); }
      console.log(`[verify-gate] SHADOW: would route ${c.case} -> ${c.gate || "cannot-verify"} -> exit ${routed.exit}; the existing bite GOVERNS with exit ${current.exit}. ${routed.exit === current.exit ? "AGREE" : "DISAGREE"}.`);
      if (current.out) process.stdout.write(current.out.endsWith("\n") ? current.out : current.out + "\n");
      process.exit(current.exit); // defer to the existing bite
    }

    // mode === "govern": the routed verdict governs. Still write the audit row (currentExit = not-run).
    rec.currentExit = null;
    rec.agree = null;
    try { appendFileSync(logPath, JSON.stringify(rec) + "\n"); } catch (e) { console.error(`[verify-gate] govern log append failed (non-fatal): ${e && e.message}`); }
    console.log(`[verify-gate] GOVERN: routed ${c.case} -> ${c.gate || "cannot-verify"} -> exit ${routed.exit}: ${routed.reason}`);
    process.exit(routed.exit);
  } catch (e) {
    console.error(`[verify-gate] router exception (fail closed): ${e && e.message}`);
    process.exit(2); // an exception is a cannot-verify, NEVER a pass
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main(process.argv);

// exported for the integration harness (pure-ish helpers; no process exit on import).
export { classifyBite, buildClassifierInput, resolveImport, importsOfTest, resolveMode };
