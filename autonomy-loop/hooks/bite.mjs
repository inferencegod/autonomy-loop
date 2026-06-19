#!/usr/bin/env node
// autonomy-loop: bite (the assertion gate, mechanized). For most of this project's life the "bite"
// was a sentence in the reviewer prompt: revert the fix, confirm the test goes RED, restore. An LLM
// did it by hand, so it was discipline, not enforcement. This makes it a real deterministic check.
//
// WHAT IT PROVES: coverage proves a line RAN; the bite proves a test ASSERTS. It reverts ONLY the
// source change of a wave (keeping the test in place), runs the target test, and requires it to FAIL
// with an assertion error. A test that still passes with the fix reverted catches nothing and is a
// no-op. Pairs with the ratchet (no drift) and patch coverage (changed lines run).
//
// DESIGN (validated against mutation-testing / RTS prior art):
//  - exit code is NOT a valid RED. A reverted fix that will not build ERRORS with a non-zero code that
//    looks identical to a real failure, so we classify assert-fail vs error vs timeout, and only an
//    assertion failure counts as a caught bite.
//  - flake guard: the reverted test must fail the SAME way N times in a row (default 3); mixed results
//    are inconclusive, never a pass.
//  - baseline first: the test must be GREEN on the fixed code, or a later RED proves nothing.
//  - mapping sanity: if we know the named test does not execute the reverted code, that is cannot-verify,
//    not a pass (it is the wrong test).
//  - fail closed: pass = 0, stayed-green = 1, cannot-verify = 2 (blocking by default, GNU diff/grep
//    convention). The runner uses a disposable detached worktree and never mutates the live tree.
//
// PURE CORE: decideBite() + classifyOutcome() do no I/O and are unit-tested. The runner does the git
// worktree dance and the test runs. No external deps. No em dashes anywhere.

import { execSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const NUM = (v, d) => { const n = Number(v); return Number.isFinite(n) ? n : d; };
const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));

const cannotVerify = (code, reason) => ({ ok: false, action: "cannot-verify", code, exit: 2, reason });

// PURE: turn a finished test run into one of four outcomes. code = process exit code; text = combined
// stdout+stderr (lower-cased by the caller is fine, we lower it here). assertRe (optional RegExp) is the
// caller's positive signature for an ASSERTION failure in their runner; when given it is authoritative.
const ERROR_MARKERS = [
  "cannot find module", "err_module_not_found", "modulenotfounderror", "module not found",
  "syntaxerror", "importerror", "cannot find name", "compilation failed", "cannot resolve",
  "no such file", "unexpected token", "collected 0 items", "collection error", "errno",
  // runtime crashes: a reverted fix that CRASHES is not a caught assertion. These are checked BEFORE
  // the assert markers so a crash that merely mentions "expected" cannot masquerade as a caught bite.
  "typeerror", "referenceerror", "rangeerror", "cannot read propert", "is not a function",
  "is not defined", "is not iterable", "is not a constructor", "uncaught", "unhandledrejection",
  "thrown:", "segmentation fault", "fatal error", "panic:",
];
const TIMEOUT_MARKERS = ["timed out", "timeout", "etimedout", "exceeded"];
// Deliberately NARROW + runner-specific. The bare words "assert"/"expected"/"to be" and run-summary
// lines ("failing tests"/"fail:") were dropped: they also appear in plain crash output, which let a
// crash classify as a false "caught" (fail-open) inside the crown-jewel bite. Mainstream JS runners
// (node:test, jest, vitest, mocha/chai, TAP) still match; for anything else, pass --assert-regex.
const ASSERT_MARKERS = [
  "assertionerror", "assertion failed", "err_assertion", "expect(", "tobe(", "toequal(",
  "expected:", "received:", "actual:", "not ok ", "✖", "✗",
];

export function classifyOutcome(code, text = "", opts = {}) {
  const t = String(text || "").toLowerCase();
  if (code === 0) return "pass";
  if (opts.assertRe) return opts.assertRe.test(String(text || "")) ? "assert-fail" : "error";
  if (TIMEOUT_MARKERS.some((m) => t.includes(m))) return "timeout";
  if (ERROR_MARKERS.some((m) => t.includes(m))) return "error";
  if (ASSERT_MARKERS.some((m) => t.includes(m))) return "assert-fail";
  // ambiguous non-zero: no timeout, no build-error, and no assertion signature matched, and no
  // --assert-regex was supplied. An exit code alone is NOT a valid RED (a crash or an exotic build
  // failure looks the same), so fail CLOSED to "error" (cannot-verify) rather than fake a caught bite.
  // The assert markers are intentionally conservative, so a borderline crash lands here as "error"
  // (a safe cannot-verify) instead of a false "caught"; supply --assert-regex for an exotic runner.
  return "error";
}

// PURE decision core. obs = { baselineGreen, coversChangedCode (true|false|null=unknown), revertRuns: [outcome] }.
export function decideBite(obs = {}, opts = {}) {
  const runs = clamp(NUM(opts.runs, 3), 1, 25);

  if (obs.baselineGreen !== true) {
    return cannotVerify("baseline-not-green", "the target test is not GREEN on the fixed code, so a RED after reverting proves nothing. Stabilize the test first, then bite.");
  }
  if (obs.coversChangedCode === false) {
    return cannotVerify("unmapped", "the target test does not execute the reverted lines, so it cannot be the test that catches this fix. Name the right test or this bite is a no-op.");
  }

  const r = Array.isArray(obs.revertRuns) ? obs.revertRuns : [];
  if (r.length < runs) {
    return cannotVerify("insufficient-runs", `need ${runs} reverted runs to rule out a flake, got ${r.length}.`);
  }
  const judged = r.slice(-runs);

  if (judged.some((o) => o === "error" || o === "timeout")) {
    return cannotVerify("unviable", `reverting the fix made the target test ERROR or TIME OUT (build/collect/crash), which is not a real RED. A valid bite needs an assertion failure. runs: ${judged.join(", ")}`);
  }
  const allFail = judged.every((o) => o === "assert-fail");
  const allPass = judged.every((o) => o === "pass");
  if (!allFail && !allPass) {
    return cannotVerify("flaky", `the target test gave mixed results across ${runs} reverted runs (${judged.join(", ")}); cannot confirm a stable RED.`);
  }
  if (allPass) {
    return { ok: false, action: "no-op", exit: 1, reason: "the target test STILL PASSES when the fix is reverted. It does not catch the bug it claims to. Strengthen the assertion, or name the test that actually pins this behavior." };
  }
  return { ok: true, action: "caught", exit: 0, reason: `the target test fails with an assertion error on all ${runs} reverted runs: it genuinely catches the reverted bug.` };
}

// ---- thin runner (worktree isolation; only when invoked directly) ----
function sh(cmd, cwd) {
  return execSync(cmd, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 64 * 1024 * 1024 });
}
function runTest(cmd, cwd) {
  try { const out = sh(cmd, cwd); return { code: 0, text: out }; }
  catch (e) { return { code: (e && e.status) || 1, text: ((e && e.stdout) || "") + "\n" + ((e && e.stderr) || "") }; }
}
// is a path a TEST file (kept in place when we revert the source)? substring globs, lowercased.
function isTestPath(p, globs) {
  const s = p.toLowerCase();
  return globs.some((g) => s.includes(g));
}

function main(argv) {
  const args = Object.fromEntries(argv.slice(2).map((a) => {
    const m = a.match(/^--([^=]+)=(.*)$/); return m ? [m[1], m[2]] : [a.replace(/^--/, ""), true];
  }));
  const fixSha = args.fix || args.sha || "HEAD";
  const testCmd = args.test;               // command that runs ONLY the target test, e.g. "node --test test/foo.test.mjs"
  const runs = clamp(NUM(args.runs, 3), 1, 25);
  const assertRe = args["assert-regex"] ? new RegExp(args["assert-regex"], "i") : null;
  const testGlobs = String(args["test-glob"] || ".test.,_test.,/test/,/tests/,/__tests__/,.spec.").split(",").map((g) => g.trim().toLowerCase()).filter(Boolean);
  const coversArg = args.covers === "true" ? true : args.covers === "false" ? false : null;

  if (!testCmd) {
    console.error("[bite] need --test \"<command that runs the single target test>\". Optional: --fix=<sha> --runs=3 --assert-regex=<re> --test-glob=a,b --covers=true|false");
    process.exit(2);
  }

  // defense in depth: the fix ref is interpolated into git commands, so reject anything but the
  // characters a real ref/sha can contain (no spaces, no shell metacharacters).
  if (!/^[0-9A-Za-z_./^~-]+$/.test(fixSha)) {
    console.error(`[bite] refusing a fix ref with unexpected characters: ${fixSha}`);
    process.exit(2);
  }

  let repoRoot, parent, changedFiles;
  try {
    repoRoot = sh("git rev-parse --show-toplevel").trim();
    // Use ~1 (parent), NEVER a bare ^ : on Windows execSync runs through cmd.exe, where ^ is the escape
    // character, so `<sha>^` loses the caret, resolves to the commit itself, and the diff comes back empty
    // (a false "no source files / cannot-verify" on every wave). ~ is not special to cmd.exe.
    parent = sh(`git rev-parse ${fixSha}~1`).trim();
    // a merge commit has 2+ parents; reverting against the first parent only would revert the wrong slice.
    // Detect it caret-free: `rev-list --parents -n 1` prints the commit then each parent, space-separated.
    const parentCount = sh(`git rev-list --parents -n 1 ${fixSha}`).trim().split(/\s+/).length - 1;
    if (parentCount >= 2) {
      console.log("[bite] CANNOT-VERIFY: the fix is a merge commit; point --fix at a single non-merge commit that carries the source change.");
      process.exit(2);
    }
    changedFiles = sh(`git diff --name-only ${fixSha}~1 ${fixSha}`).trim().split("\n").filter(Boolean);
  } catch (e) {
    console.error(`[bite] cannot resolve the fix commit ${fixSha} or its parent: ${e && e.message}`);
    process.exit(2);
  }
  const sourceFiles = changedFiles.filter((f) => !isTestPath(f, testGlobs));
  if (sourceFiles.length === 0) {
    console.log("[bite] CANNOT-VERIFY: the wave changed no source files (test/doc only), nothing to revert. Skipping.");
    process.exit(2);
  }

  // baseline: the target test must pass on the fixed code (current working tree at fixSha is assumed)
  const baseline = runTest(testCmd, repoRoot);
  const baselineGreen = baseline.code === 0;

  // disposable detached worktree at the fix, then revert ONLY the source files to their pre-fix content
  // (keeping the test that was added in the same wave). Discard the worktree after; the live tree is
  // never touched, so there is nothing to restore and nothing to byte-compare (autocrlf-safe).
  const wt = mkdtempSync(join(tmpdir(), "bite-"));
  const revertRuns = [];
  try {
    sh(`git worktree add --detach "${wt}" ${fixSha}`);
    for (const f of sourceFiles) {
      // restore the file's PRE-FIX content. Only `git rm` a file that genuinely did not exist at the
      // parent (so it was new in the fix); otherwise a failed checkout must surface, not silently delete.
      let existedAtParent = true;
      try { sh(`git cat-file -e ${parent}:"${f}"`, wt); } catch { existedAtParent = false; }
      if (existedAtParent) sh(`git checkout ${parent} -- "${f}"`, wt);
      else try { sh(`git rm -f --quiet "${f}"`, wt); } catch { /* not tracked at the fix either */ }
    }
    for (let i = 0; i < runs; i++) {
      const res = runTest(testCmd, wt);
      revertRuns.push(classifyOutcome(res.code, res.text, { assertRe }));
    }
  } catch (e) {
    console.error(`[bite] worktree/ revert failed: ${e && e.message}`);
    try { sh(`git worktree remove --force "${wt}"`); } catch { /* best effort */ }
    try { rmSync(wt, { recursive: true, force: true }); } catch { /* best effort */ }
    process.exit(2);
  }
  try { sh(`git worktree remove --force "${wt}"`); } catch { /* best effort */ }
  try { rmSync(wt, { recursive: true, force: true }); } catch { /* best effort */ }

  const r = decideBite({ baselineGreen, coversChangedCode: coversArg, revertRuns }, { runs });
  console.log(`[bite] ${r.action.toUpperCase()}: ${r.reason}`);
  process.exit(r.exit);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main(process.argv);
