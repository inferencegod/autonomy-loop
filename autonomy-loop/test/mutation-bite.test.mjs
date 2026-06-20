import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { decideMutationBite } from "../hooks/mutation-bite.mjs";

test("a covered, viable, killed mutant -> exit 0 and the kill is recorded", () => {
  const r = decideMutationBite({ mutantResults: [{ lineNo: 42, op: ">=->>", covered: true, viable: true, killedByTest: true }] });
  assert.equal(r.exit, 0);
  assert.equal(r.killed.length, 1);
});

test("all viable+covered mutants survive -> exit 1 (the test pins nothing)", () => {
  assert.equal(decideMutationBite({ mutantResults: [{ covered: true, viable: true, killedByTest: false }] }).exit, 1);
});

test("zero viable+covered -> exit 2 cannot-verify; no results -> exit 2", () => {
  assert.equal(decideMutationBite({ mutantResults: [{ viable: false }, { covered: false }] }).exit, 2);
  assert.equal(decideMutationBite({}).exit, 2);
});

test("a timeout counts as a kill; a test with no live assertion -> exit 1 before mutation", () => {
  assert.equal(decideMutationBite({ mutantResults: [{ covered: true, viable: true, timedOut: true }] }).exit, 0);
  assert.equal(decideMutationBite({ assertionLiveness: false, mutantResults: [{ covered: true, viable: true, killedByTest: true }] }).exit, 1);
});

test("GLOBAL fail-closed invariant: never exit 0 without a recorded killed mutant (4000-iteration fuzz)", () => {
  let bad = 0;
  for (let i = 0; i < 4000; i++) {
    const n = Math.floor(Math.random() * 5);
    const mr = Array.from({ length: n }, () => ({ lineNo: (Math.random() * 100) | 0, covered: Math.random() < 0.7, viable: Math.random() < 0.7, killedByTest: Math.random() < 0.5, timedOut: Math.random() < 0.2, buildError: Math.random() < 0.3 }));
    const r = decideMutationBite({ mutantResults: mr });
    if (r.exit === 0 && r.killed.length === 0) bad++;
  }
  assert.equal(bad, 0);
});

// ===================== R3a (ISSUE-6): diff-based fallback, decision-core shapes =====================
// The diff-based path mutates the wave's CHANGED SOURCE lines with no coverage intersection. The records
// it feeds the core are exactly the same record shape the coverage path uses (every mutated line is run by
// the test, so covered:true), and an UNexecuted changed line yields a SURVIVING (covered, not-killed)
// mutant. These pin the verdicts the runner relies on for the three field outcomes.

test("R3a diff-based shape: a killed mutant on a changed line -> exit 0 with a recorded kill", () => {
  const r = decideMutationBite({ mutantResults: [{ lineNo: 2, op: "<=->>", covered: true, viable: true, killedByTest: true }] });
  assert.equal(r.exit, 0);
  assert.equal(r.killed.length, 1);
});

test("R3a diff-based shape: a weak test (every changed-line mutant survives) -> exit 1, NEVER 0", () => {
  // two changed source lines mutated, neither assertion-killed: the no-kill bounce.
  const r = decideMutationBite({ mutantResults: [
    { lineNo: 2, covered: true, viable: true, killedByTest: false },
    { lineNo: 3, covered: true, viable: true, killedByTest: false },
  ] });
  assert.equal(r.exit, 1);
  assert.equal(r.killed.length, 0);
});

test("R3a diff-based shape: no changed source + no coverage -> empty results -> exit 2 (fail-closed)", () => {
  // the runner emits decideMutationBite({ mutantResults: [] }) when there is nothing to mutate; that is a
  // cannot-verify, never a free pass.
  assert.equal(decideMutationBite({ mutantResults: [] }).exit, 2);
});

// ===================== R3a end-to-end: the REAL runner with NO --coverage =====================
// Build a throwaway git repo and invoke the real mutation-bite runner WITHOUT --coverage so the diff-based
// fallback is the path under test. Sequential (concurrency 1) so the per-fixture worktrees never race.
const _HERE = dirname(fileURLToPath(import.meta.url));
const _MUT = join(_HERE, "..", "hooks", "mutation-bite.mjs");
const _NODE = process.execPath;
function _git(cwd, args) { return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }); }
function _newRepo() {
  const dir = mkdtempSync(join(tmpdir(), "mbt-"));
  _git(dir, ["init", "-q", "-b", "main"]);
  _git(dir, ["config", "user.email", "t@t.t"]);
  _git(dir, ["config", "user.name", "t"]);
  _git(dir, ["config", "commit.gpgsign", "false"]);
  _git(dir, ["config", "core.autocrlf", "false"]);
  return dir;
}
function _seed(dir) { writeFileSync(join(dir, ".seed"), "seed\n"); _git(dir, ["add", "-A"]); _git(dir, ["commit", "-q", "-m", "seed"]); }
function _write(dir, rel, content) { const abs = join(dir, rel); mkdirSync(dirname(abs), { recursive: true }); writeFileSync(abs, content); }
function _commitAll(dir, msg) { _git(dir, ["add", "-A"]); _git(dir, ["commit", "-q", "-m", msg]); }
function _rmrf(dir) { try { rmSync(dir, { recursive: true, force: true }); } catch {} }
function _cleanEnv() { const e = { ...process.env }; delete e.NODE_TEST_CONTEXT; delete e.NODE_V8_COVERAGE; delete e.NODE_OPTIONS; return e; }
function _quote(s) { return /\s/.test(s) ? `"${s}"` : s; }
function _testCmd(testRel) { return `${_quote(_NODE)} --test ${testRel}`; }
// invoke the runner with NO --coverage -> the diff-based fallback.
function _runFallback(dir, testRel) {
  const r = spawnSync(_NODE, [_MUT, "--fix=HEAD", `--test=${_testCmd(testRel)}`], { cwd: dir, encoding: "utf8", maxBuffer: 64 * 1024 * 1024, env: _cleanEnv() });
  return { exit: typeof r.status === "number" ? r.status : (r.signal ? 137 : 2), out: (r.stdout || "") + (r.stderr || "") };
}
const _T = (name, fn) => test(name, { concurrency: 1 }, fn);

_T("R3a runner (no --coverage): a real greenfield kill -> exit 0 with the proof line", () => {
  const dir = _newRepo();
  try {
    _seed(dir);
    _write(dir, "src/band.mjs", "export function band(n) {\n  if (n <= 10) return 'low';\n  return 'high';\n}\n");
    _write(dir, "test/band.test.mjs", "import test from 'node:test';\nimport assert from 'node:assert/strict';\nimport { band } from '../src/band.mjs';\ntest('boundary', () => { assert.equal(band(10), 'low'); assert.equal(band(11), 'high'); });\n");
    _commitAll(dir, "greenfield band");
    const r = _runFallback(dir, "test/band.test.mjs");
    assert.match(r.out, /killed\s+\d+\s+mutant/i, "the diff-based fallback must print the proof line: " + r.out);
    assert.equal(r.exit, 0, r.out);
  } finally { _rmrf(dir); }
});

_T("R3a runner (no --coverage): a weak greenfield test bounces at exit 1, NEVER 0", () => {
  const dir = _newRepo();
  try {
    _seed(dir);
    _write(dir, "src/weak.mjs", "export function band(n) {\n  if (n <= 10) return 'low';\n  return 'high';\n}\n");
    _write(dir, "test/weak.test.mjs", "import test from 'node:test';\nimport assert from 'node:assert/strict';\nimport { band } from '../src/weak.mjs';\ntest('smoke', () => { band(10); assert.equal(1, 1); });\n");
    _commitAll(dir, "greenfield weak");
    const r = _runFallback(dir, "test/weak.test.mjs");
    assert.notEqual(r.exit, 0, "a surviving mutant must never pass: " + r.out);
    assert.equal(r.exit, 1, r.out);
    assert.match(r.out, /pins nothing|survived/i, r.out);
  } finally { _rmrf(dir); }
});

_T("R3a runner (no --coverage): no changed source (EMPTY_FIX, imported existing file) -> exit 2", () => {
  const dir = _newRepo();
  try {
    _seed(dir);
    _write(dir, "src/foo.mjs", "export function grade(n) {\n  if (n >= 90) return 'A';\n  return 'B';\n}\n");
    _commitAll(dir, "existing foo");
    _write(dir, "test/foo.test.mjs", "import test from 'node:test';\nimport assert from 'node:assert/strict';\nimport { grade } from '../src/foo.mjs';\ntest('grade', () => { assert.equal(grade(90), 'A'); assert.equal(grade(89), 'B'); });\n");
    _commitAll(dir, "add foo test only");
    const r = _runFallback(dir, "test/foo.test.mjs");
    assert.equal(r.exit, 2, "no changed source + no coverage must be cannot-verify: " + r.out);
  } finally { _rmrf(dir); }
});
