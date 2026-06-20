// autonomy-loop: verify-gate UNIT + end-to-end tests for the R3a diff-based mutation fallback (ISSUE-6)
// and the R3b rigor-on default (govern). The pure cores (classifyBite, decideMutationBite) and the broad
// router wiring are exercised in verify-gate.integration.mjs; THIS file pins the two 0.8.3 behaviors:
//   - GREENFIELD with NO --coverage now produces a real mutation-kill verdict (diff-based fallback), and
//     a weak greenfield test still bounces (exit 1, never a free 0), and a no-changed-source wave with no
//     coverage stays cannot-verify (exit 2).
//   - resolveMode DEFAULTS to "govern", while an explicit --mode/config "off" still wins (opt-out).
// Builds tiny THROWAWAY git repos in the OS tmp dir and runs the REAL router + REAL mutation-bite runner.
// Tests run SEQUENTIALLY (concurrency 1) so the per-fixture worktrees never race. No external deps. No em
// dashes anywhere.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveMode } from "../hooks/verify-gate.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const HOOKS = join(HERE, "..", "hooks");
const GATE = join(HOOKS, "verify-gate.mjs");
const NODE = process.execPath;

function git(cwd, args) { return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }); }
function newRepo() {
  const dir = mkdtempSync(join(tmpdir(), "vgt-"));
  git(dir, ["init", "-q", "-b", "main"]);
  git(dir, ["config", "user.email", "t@t.t"]);
  git(dir, ["config", "user.name", "t"]);
  git(dir, ["config", "commit.gpgsign", "false"]);
  git(dir, ["config", "core.autocrlf", "false"]);
  return dir;
}
// a no-op SEED so the wave-under-test always has a parent (HEAD~1 resolves), like a real wave landing on
// top of existing history. Only a brand-new repo's first commit lacks a parent, which is not the gate's case.
function seed(dir) { writeFileSync(join(dir, ".seed"), "seed\n"); git(dir, ["add", "-A"]); git(dir, ["commit", "-q", "-m", "seed"]); }
function write(dir, rel, content) { const abs = join(dir, rel); mkdirSync(dirname(abs), { recursive: true }); writeFileSync(abs, content); }
function commitAll(dir, msg) { git(dir, ["add", "-A"]); git(dir, ["commit", "-q", "-m", msg]); return git(dir, ["rev-parse", "HEAD"]).trim(); }
function rmrf(dir) { try { rmSync(dir, { recursive: true, force: true }); } catch {} }
// SANITIZED env: this file runs under `node --test`, so NODE_TEST_CONTEXT / NODE_V8_COVERAGE would leak
// into the runner's nested test subprocesses and corrupt their TAP output. Always spawn cleaned.
function cleanEnv() { const e = { ...process.env }; delete e.NODE_TEST_CONTEXT; delete e.NODE_V8_COVERAGE; delete e.NODE_OPTIONS; return e; }
function runHook(file, args, cwd) {
  const r = spawnSync(NODE, [file, ...args], { cwd, encoding: "utf8", maxBuffer: 64 * 1024 * 1024, env: cleanEnv() });
  return { exit: typeof r.status === "number" ? r.status : (r.signal ? 137 : 2), out: (r.stdout || "") + (r.stderr || "") };
}
function quote(s) { return /\s/.test(s) ? `"${s}"` : s; }
function testCmd(testRel) { return `${quote(NODE)} --test ${testRel}`; }
const T = (name, fn) => test(name, { concurrency: 1 }, fn); // sequential, never race worktrees

// A real greenfield wave: a NEW module + its test committed TOGETHER. No --coverage is ever passed, so the
// golden-revert bite cannot prove it (reverting the fix deletes the unit the test imports) and the router
// must route to the mutation-bite, which in 0.8.3 mutates the wave's CHANGED SOURCE lines (diff-based).
function commitGreenfield(dir, srcRel, srcBody, testRel, testBody, msg) {
  write(dir, srcRel, srcBody);
  write(dir, testRel, testBody);
  return commitAll(dir, msg || "greenfield wave");
}

// ===================== R3a: GREENFIELD, NO COVERAGE =====================

T("R3a GREENFIELD no-coverage REAL KILL: govern routes to mutation-bite, kills >=1, exit 0", () => {
  const dir = newRepo();
  try {
    seed(dir);
    // a real boundary the test pins on BOTH sides: <= 10 is 'low', 11 is 'high'. The diff-based fallback
    // mutates the changed '<=' line; the assertions catch it -> a recorded kill.
    commitGreenfield(
      dir,
      "src/band.mjs", "export function band(n) {\n  if (n <= 10) return 'low';\n  return 'high';\n}\n",
      "test/band.test.mjs", "import test from 'node:test';\nimport assert from 'node:assert/strict';\nimport { band } from '../src/band.mjs';\ntest('boundary', () => { assert.equal(band(10), 'low'); assert.equal(band(11), 'high'); });\n",
      "greenfield band"
    );
    // NOTE: NO --coverage. This is the field case (ISSUE-6): no coverage tool wired.
    const r = runHook(GATE, ["--fix=HEAD", `--test=${testCmd("test/band.test.mjs")}`, "--mode=govern"], dir);
    assert.match(r.out, /GREENFIELD/, r.out);
    assert.match(r.out, /mutation-bite/, r.out);
    assert.match(r.out, /killed\s+\d+\s+mutant/i, "the diff-based fallback must record a killed mutant: " + r.out);
    assert.equal(r.exit, 0, "a proven greenfield kill governs to exit 0: " + r.out);
    // INVARIANT: a routed exit 0 carries proof=killed in the JSONL audit row.
    const log = join(dir, ".autonomy-verify-shadow.log");
    assert.ok(existsSync(log), "govern writes the audit row");
  } finally { rmrf(dir); }
});

T("R3a GREENFIELD no-coverage WEAK TEST: a mutant survives -> exit 1 (no-kill bounce), NEVER 0", () => {
  const dir = newRepo();
  try {
    seed(dir);
    // the test EXECUTES band (so the assertion-liveness pre-check passes) but asserts nothing about its
    // result: a mutant on the '<=' line survives -> the gate must BOUNCE at exit 1, never pass.
    commitGreenfield(
      dir,
      "src/weak.mjs", "export function band(n) {\n  if (n <= 10) return 'low';\n  return 'high';\n}\n",
      "test/weak.test.mjs", "import test from 'node:test';\nimport assert from 'node:assert/strict';\nimport { band } from '../src/weak.mjs';\ntest('smoke', () => { band(10); assert.equal(1, 1); });\n",
      "greenfield weak"
    );
    const r = runHook(GATE, ["--fix=HEAD", `--test=${testCmd("test/weak.test.mjs")}`, "--mode=govern"], dir);
    assert.match(r.out, /GREENFIELD/, r.out);
    assert.notEqual(r.exit, 0, "a surviving mutant must NEVER pass: " + r.out);
    assert.equal(r.exit, 1, "a no-kill greenfield bounces at exit 1: " + r.out);
    assert.match(r.out, /pins nothing|survived/i, r.out);
  } finally { rmrf(dir); }
});

T("R3a NO CHANGED SOURCE + no coverage: EMPTY_FIX shape stays cannot-verify (exit 2), fail-closed", () => {
  const dir = newRepo();
  try {
    seed(dir);
    // commit an EXISTING module in a prior wave...
    write(dir, "src/foo.mjs", "export function grade(n) {\n  if (n >= 90) return 'A';\n  return 'B';\n}\n");
    commitAll(dir, "existing foo");
    // ...then a wave that adds ONLY a test importing it (no source hunk to mutate). With no --coverage we
    // have no changed source line AND no covered-line signal, so there is nothing to score -> exit 2.
    write(dir, "test/foo.test.mjs", "import test from 'node:test';\nimport assert from 'node:assert/strict';\nimport { grade } from '../src/foo.mjs';\ntest('grade', () => { assert.equal(grade(90), 'A'); assert.equal(grade(89), 'B'); });\n");
    commitAll(dir, "add foo test only");
    const r = runHook(GATE, ["--fix=HEAD", `--test=${testCmd("test/foo.test.mjs")}`, "--mode=govern"], dir);
    assert.match(r.out, /EMPTY_FIX/, r.out);
    assert.match(r.out, /mutation-bite/, r.out);
    assert.equal(r.exit, 2, "no changed source + no coverage must be cannot-verify, never a free pass: " + r.out);
  } finally { rmrf(dir); }
});

T("R3a INVARIANT: a no-coverage greenfield exit 0 ALWAYS carries a recorded killed mutant (fuzz)", () => {
  // mix strong and weak greenfield tests; assert the runner-printed proof line is present on EVERY exit 0,
  // and that no weak test ever reaches exit 0. The router downgrades a 0 without "killed N mutant" to 2.
  const N = Number(process.env.VG_FALLBACK_FUZZ_N || 8);
  let zeros = 0, violations = 0;
  const cases = [
    { src: "  if (n <= 10) return 'low';\n  return 'high';", strong: "assert.equal(band(10),'low'); assert.equal(band(11),'high');", weak: "band(10); assert.equal(1,1);" },
    { src: "  if (n === 0) return 'zero';\n  return 'nonzero';", strong: "assert.equal(band(0),'zero'); assert.equal(band(1),'nonzero');", weak: "band(0); assert.equal(1,1);" },
    { src: "  return n + 1;", strong: "assert.equal(band(2),3);", weak: "band(2); assert.equal(1,1);" },
  ];
  for (let i = 0; i < N; i++) {
    const dir = newRepo();
    try {
      seed(dir);
      const c = cases[i % cases.length];
      const strong = (i % 2) === 0;
      const body = strong ? c.strong : c.weak;
      commitGreenfield(
        dir,
        "src/fz.mjs", "export function band(n) {\n" + c.src + "\n}\n",
        "test/fz.test.mjs", "import test from 'node:test';\nimport assert from 'node:assert/strict';\nimport { band } from '../src/fz.mjs';\ntest('t', () => { " + body + " });\n",
        "gf " + i
      );
      const r = runHook(GATE, ["--fix=HEAD", `--test=${testCmd("test/fz.test.mjs")}`, "--mode=govern"], dir);
      if (r.exit === 0) {
        zeros++;
        if (!/killed\s+\d+\s+mutant/i.test(r.out)) { violations++; console.error("VIOLATION (exit 0, no kill):\n" + r.out); }
        if (!strong) { violations++; console.error("VIOLATION (weak test reached exit 0):\n" + r.out); }
      }
    } finally { rmrf(dir); }
  }
  console.log(`  fallback-fuzz: exit0=${zeros} violations=${violations}`);
  assert.equal(violations, 0, "no-coverage greenfield must never exit 0 without a recorded kill, and a weak test must never reach 0");
});

// ===================== R3b: resolveMode rigor-on default =====================

T("R3b resolveMode DEFAULT is govern (no --mode, no config)", () => {
  const dir = newRepo();
  try {
    // no autonomy.config.json present and no --mode flag -> rigor-on default.
    assert.equal(resolveMode({}, dir), "govern");
    assert.ok(!existsSync(join(dir, "autonomy.config.json")), "no config present for this assertion");
  } finally { rmrf(dir); }
});

T("R3b explicit --mode=off still wins (opt-out path)", () => {
  assert.equal(resolveMode({ mode: "off" }, null), "off");
  assert.equal(resolveMode({ mode: "OFF" }, null), "off", "case-insensitive");
  assert.equal(resolveMode({ mode: "shadow" }, null), "shadow", "shadow is also an explicit opt-out");
});

T("R3b config gate.verifyGate=off still wins when there is no --mode (opt-out path)", () => {
  const dir = newRepo();
  try {
    writeFileSync(join(dir, "autonomy.config.json"), JSON.stringify({ gate: { verifyGate: "off" } }));
    assert.equal(resolveMode({}, dir), "off", "an explicit config opt-out beats the govern default");
    // an explicit --mode beats even the config.
    assert.equal(resolveMode({ mode: "govern" }, dir), "govern", "an explicit --mode wins over the config");
  } finally { rmrf(dir); }
});

T("R3b an unreadable/garbage config falls through to the govern default (fail-closed)", () => {
  const dir = newRepo();
  try {
    writeFileSync(join(dir, "autonomy.config.json"), "{ not valid json ");
    assert.equal(resolveMode({}, dir), "govern", "a broken config must not silently disable the router");
    // a config that omits gate.verifyGate also falls through to govern.
    writeFileSync(join(dir, "autonomy.config.json"), JSON.stringify({ gate: {} }));
    assert.equal(resolveMode({}, dir), "govern");
  } finally { rmrf(dir); }
});

// ===================== R3b: govern is the EFFECTIVE default end-to-end =====================

T("R3b end-to-end: no --mode + no config -> the ROUTER governs a greenfield wave (proven kill, exit 0)", () => {
  const dir = newRepo();
  try {
    seed(dir);
    commitGreenfield(
      dir,
      "src/dflt.mjs", "export function band(n) {\n  if (n <= 10) return 'low';\n  return 'high';\n}\n",
      "test/dflt.test.mjs", "import test from 'node:test';\nimport assert from 'node:assert/strict';\nimport { band } from '../src/dflt.mjs';\ntest('boundary', () => { assert.equal(band(10), 'low'); assert.equal(band(11), 'high'); });\n",
      "greenfield default-govern"
    );
    assert.ok(!existsSync(join(dir, "autonomy.config.json")), "no config present");
    // NO --mode: the default is govern, so the router runs and a greenfield that the golden bite could not
    // prove now gets a real mutation-kill verdict and exits 0 with proof.
    const r = runHook(GATE, ["--fix=HEAD", `--test=${testCmd("test/dflt.test.mjs")}`], dir);
    assert.match(r.out, /GOVERN/, "the default must run the router in govern: " + r.out);
    assert.match(r.out, /GREENFIELD/, r.out);
    assert.equal(r.exit, 0, "the routed kill governs by default: " + r.out);
    assert.ok(existsSync(join(dir, ".autonomy-verify-shadow.log")), "govern (the default) writes the audit row");
  } finally { rmrf(dir); }
});
