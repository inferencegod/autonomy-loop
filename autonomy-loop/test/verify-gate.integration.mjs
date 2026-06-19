// autonomy-loop: verify-gate INTEGRATION harness. Builds tiny THROWAWAY git repos in the OS tmp dir and
// runs the REAL runners (mutation-bite.mjs) and the REAL router (verify-gate.mjs) end to end against them.
// The pure cores are already unit-tested elsewhere; this exercises the I/O runners + the router + the
// shadow/govern wiring + the global fail-closed invariant. Naming: KG-* must exit 0, KB-* must exit
// non-zero for the named reason. Run: node --test test/verify-gate.integration.mjs
//
// Coverage for the mutation path uses the zero-dep fixture shim test/fixtures/verify-gate/v8cov.mjs (real
// installs use c8). Tests run SEQUENTIALLY (concurrency 1) so the per-fixture git worktrees never race.
// No external deps. No em dashes anywhere.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const HOOKS = join(HERE, "..", "hooks");
const MUT = join(HOOKS, "mutation-bite.mjs");
const GATE = join(HOOKS, "verify-gate.mjs");
const V8COV = join(HERE, "fixtures", "verify-gate", "v8cov.mjs");
const NODE = process.execPath;

function git(cwd, args) { return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }); }
function newRepo() {
  const dir = mkdtempSync(join(tmpdir(), "vg-fix-"));
  git(dir, ["init", "-q", "-b", "main"]);
  git(dir, ["config", "user.email", "t@t.t"]);
  git(dir, ["config", "user.name", "t"]);
  git(dir, ["config", "commit.gpgsign", "false"]);
  git(dir, ["config", "core.autocrlf", "false"]);
  return dir;
}
// a no-op SEED commit so the wave-under-test always has a parent (HEAD~1 resolves). A real greenfield
// wave lands on top of existing history; only a brand-new repo's first commit lacks a parent, which is
// not the situation the reviewer gate runs in. The seed reproduces "this commit has a parent".
function seed(dir) { writeFileSync(join(dir, ".seed"), "seed\n"); git(dir, ["add", "-A"]); git(dir, ["commit", "-q", "-m", "seed"]); }
function write(dir, rel, content) { const abs = join(dir, rel); mkdirSync(dirname(abs), { recursive: true }); writeFileSync(abs, content); }
function commitAll(dir, msg) { git(dir, ["add", "-A"]); git(dir, ["commit", "-q", "-m", msg]); return git(dir, ["rev-parse", "HEAD"]).trim(); }
function rmrf(dir) { try { rmSync(dir, { recursive: true, force: true }); } catch {} }

// spawn with a SANITIZED env: this harness runs under `node --test`, so NODE_TEST_CONTEXT /
// NODE_V8_COVERAGE would leak into the runners' nested test + coverage subprocesses and corrupt them.
function cleanEnv() { const e = { ...process.env }; delete e.NODE_TEST_CONTEXT; delete e.NODE_V8_COVERAGE; delete e.NODE_OPTIONS; return e; }
function runHook(file, args, cwd) {
  const r = spawnSync(NODE, [file, ...args], { cwd, encoding: "utf8", maxBuffer: 64 * 1024 * 1024, env: cleanEnv() });
  return { exit: typeof r.status === "number" ? r.status : (r.signal ? 137 : 2), out: (r.stdout || "") + (r.stderr || "") };
}
function quote(s) { return /\s/.test(s) ? `"${s}"` : s; }
function covCmd(srcRel, testRel) { return `${quote(NODE)} ${quote(V8COV)} --src=${srcRel} --test=${testRel} --out=coverage/coverage-final.json`; }
function testCmd(testRel) { return `${quote(NODE)} --test ${testRel}`; }
function runMutation(dir, srcRel, testRel, extra = []) {
  return runHook(MUT, ["--fix=HEAD", `--test=${testCmd(testRel)}`, `--coverage=${covCmd(srcRel, testRel)}`, ...extra], dir);
}
const T = (name, fn) => test(name, { concurrency: 1 }, fn); // sequential

// ===================== KNOWN-GOOD =====================

T("KG-regression-caught: REGRESSION -> golden-revert -> exit 0 (caught)", () => {
  const dir = newRepo();
  try {
    seed(dir);
    write(dir, "src/calc.mjs", "export function add(a, b) {\n  return a - b;\n}\n");
    write(dir, "test/calc.test.mjs", "import test from 'node:test';\nimport assert from 'node:assert/strict';\nimport { add } from '../src/calc.mjs';\ntest('zero case', () => { assert.equal(add(0, 0), 0); });\n");
    commitAll(dir, "baseline buggy");
    write(dir, "src/calc.mjs", "export function add(a, b) {\n  return a + b;\n}\n");
    write(dir, "test/calc.test.mjs", "import test from 'node:test';\nimport assert from 'node:assert/strict';\nimport { add } from '../src/calc.mjs';\ntest('adds', () => { assert.equal(add(2, 3), 5); });\n");
    commitAll(dir, "fix add");
    const r = runHook(GATE, ["--fix=HEAD", `--test=${testCmd("test/calc.test.mjs")}`, "--mode=govern", "--runs=2"], dir);
    console.log("  cmd: node hooks/verify-gate.mjs --fix=HEAD --test='node --test test/calc.test.mjs' --mode=govern --runs=2");
    assert.match(r.out, /REGRESSION/, r.out);
    assert.match(r.out, /golden-revert/, r.out);
    assert.equal(r.exit, 0, r.out);
  } finally { rmrf(dir); }
});

T("KG-greenfield-killed: GREENFIELD -> mutation-bite -> exit 0 with killed>=1", () => {
  const dir = newRepo();
  try {
    seed(dir);
    write(dir, "src/parse.mjs", "export function band(n) {\n  if (n <= 10) return 'low';\n  return 'high';\n}\n");
    write(dir, "test/parse.test.mjs", "import test from 'node:test';\nimport assert from 'node:assert/strict';\nimport { band } from '../src/parse.mjs';\ntest('boundary', () => { assert.equal(band(10), 'low'); assert.equal(band(11), 'high'); });\n");
    commitAll(dir, "greenfield parse");
    const r = runMutation(dir, "src/parse.mjs", "test/parse.test.mjs");
    console.log("  cmd: node hooks/mutation-bite.mjs --fix=HEAD --test='node --test test/parse.test.mjs' --coverage='node v8cov.mjs --src=src/parse.mjs ...'");
    assert.match(r.out, /killed\s+\d+\s+mutant/i, r.out);
    assert.equal(r.exit, 0, r.out);
    const rg = runHook(GATE, ["--fix=HEAD", `--test=${testCmd("test/parse.test.mjs")}`, `--coverage=${covCmd("src/parse.mjs", "test/parse.test.mjs")}`, "--mode=govern"], dir);
    assert.match(rg.out, /GREENFIELD/, rg.out);
    assert.match(rg.out, /mutation-bite/, rg.out);
    assert.equal(rg.exit, 0, rg.out);
  } finally { rmrf(dir); }
});

T("KG-empty-fix-killed: EMPTY_FIX -> mutation-bite (imported-source covered lines) -> exit 0", () => {
  const dir = newRepo();
  try {
    seed(dir);
    write(dir, "src/foo.mjs", "export function grade(n) {\n  if (n >= 90) return 'A';\n  return 'B';\n}\n");
    commitAll(dir, "existing foo");
    write(dir, "test/foo.test.mjs", "import test from 'node:test';\nimport assert from 'node:assert/strict';\nimport { grade } from '../src/foo.mjs';\ntest('grade', () => { assert.equal(grade(90), 'A'); assert.equal(grade(89), 'B'); });\n");
    commitAll(dir, "add foo test");
    const r = runMutation(dir, "src/foo.mjs", "test/foo.test.mjs");
    console.log("  cmd: node hooks/mutation-bite.mjs --fix=HEAD --test='node --test test/foo.test.mjs' --coverage='... v8cov src/foo.mjs ...'");
    assert.match(r.out, /killed\s+\d+\s+mutant/i, r.out);
    assert.equal(r.exit, 0, r.out);
    const rg = runHook(GATE, ["--fix=HEAD", `--test=${testCmd("test/foo.test.mjs")}`, `--coverage=${covCmd("src/foo.mjs", "test/foo.test.mjs")}`, "--mode=govern"], dir);
    assert.match(rg.out, /EMPTY_FIX/, rg.out);
    assert.match(rg.out, /mutation-bite/, rg.out);
    assert.equal(rg.exit, 0, rg.out);
  } finally { rmrf(dir); }
});

// ===================== KNOWN-BAD =====================

T("KB-greenfield-survivor (LOAD-BEARING): covered new line, test asserts nothing -> exit 1, NOT 0", () => {
  const dir = newRepo();
  try {
    seed(dir);
    write(dir, "src/weak.mjs", "export function band(n) {\n  if (n <= 10) return 'low';\n  return 'high';\n}\n");
    write(dir, "test/weak.test.mjs", "import test from 'node:test';\nimport assert from 'node:assert/strict';\nimport { band } from '../src/weak.mjs';\ntest('smoke', () => { band(10); assert.equal(1, 1); });\n");
    commitAll(dir, "greenfield weak");
    const r = runMutation(dir, "src/weak.mjs", "test/weak.test.mjs");
    console.log("  cmd: node hooks/mutation-bite.mjs --fix=HEAD --test='node --test test/weak.test.mjs' --coverage='... v8cov src/weak.mjs ...'");
    assert.notEqual(r.exit, 0, "a survivor must NOT pass: " + r.out);
    assert.equal(r.exit, 1, r.out);
    assert.match(r.out, /pins nothing|survived/i, r.out);
  } finally { rmrf(dir); }
});

T("KB-no-assertion: test file with ZERO assertions -> exit 1, no-live-assertion, zero mutation runs", () => {
  const dir = newRepo();
  try {
    seed(dir);
    write(dir, "src/na.mjs", "export function band(n) {\n  if (n <= 10) return 'low';\n  return 'high';\n}\n");
    write(dir, "test/na.test.mjs", "import test from 'node:test';\nimport { band } from '../src/na.mjs';\ntest('runs', () => { band(10); band(11); });\n");
    commitAll(dir, "greenfield no-assert");
    const r = runMutation(dir, "src/na.mjs", "test/na.test.mjs");
    console.log("  cmd: node hooks/mutation-bite.mjs --fix=HEAD --test='node --test test/na.test.mjs' --coverage='... v8cov src/na.mjs ...'");
    assert.equal(r.exit, 1, r.out);
    assert.match(r.out, /no-live-assertion/i, r.out);
  } finally { rmrf(dir); }
});

T("KB-uncovered-only: the only mutable changed line is NOT executed -> exit 2 no-viable-covered-mutants", () => {
  const dir = newRepo();
  try {
    seed(dir);
    // the only mutable line (a >= guard) lives in a function the test never calls -> uncovered changed line.
    write(dir, "src/uncs.mjs", "export function used() {\n  return 'ok';\n}\nexport function unused(n) {\n  if (n >= 5) return 'big';\n  return 'small';\n}\n");
    write(dir, "test/uncs.test.mjs", "import test from 'node:test';\nimport assert from 'node:assert/strict';\nimport { used } from '../src/uncs.mjs';\ntest('used', () => { assert.equal(used(), 'ok'); });\n");
    commitAll(dir, "greenfield uncovered");
    const r = runMutation(dir, "src/uncs.mjs", "test/uncs.test.mjs");
    console.log("  cmd: node hooks/mutation-bite.mjs --fix=HEAD --test='node --test test/uncs.test.mjs' --coverage='... v8cov src/uncs.mjs ...'");
    assert.equal(r.exit, 2, r.out);
    assert.match(r.out, /no-viable-covered-mutants/i, r.out);
  } finally { rmrf(dir); }
});

T("KB-unviable-only: every mutant on the covered changed line fails to BUILD -> exit 2 all-mutants-inconclusive", () => {
  const dir = newRepo();
  try {
    seed(dir);
    // A covered changed line whose first applicable operator yields a NON-PARSING mutant. The off-by-one
    // operator turns a number into number+1; to break parse we make the mutated token unbalance the file.
    // Use a numeric literal that is part of a regex flag count is hard; instead force unviability with a
    // line where flipping '&&' to '||' is fine, so we use a deliberately fragile construct: an array hole.
    // Reliable approach: a line `export const x = [1,2][0 <= 1 ? 0 : 1];` mutate '<=' -> '<' stays valid.
    // Guaranteed-unviable: mutate a digit adjacent to a label that becomes a duplicate. Simplest robust:
    // put the mutable operator inside a TEMPLATE that, when changed, leaves an unterminated token. We use
    // the off-by-one on the LENGTH of a fixed-size tuple destructure so the mutant references an undefined
    // binding at MODULE EVAL (a ReferenceError = classifyOutcome 'error' = unviable, EXCLUDED).
    write(dir, "src/unv.mjs", "const [a0, a1] = ['x', 'y'];\nexport const pick = () => {\n  return a1;\n};\n");
    // mutate 'a1' is not an operator; we need an OPERATOR on a covered line. Put a number on the covered
    // return line that, incremented, indexes out of a 2-tuple into undefined -> a runtime error at call.
    write(dir, "src/unv.mjs", "const TUP = ['x', 'y'];\nexport const pick = () => {\n  return TUP[1].toUpperCase();\n};\n");
    write(dir, "test/unv.test.mjs", "import test from 'node:test';\nimport assert from 'node:assert/strict';\nimport { pick } from '../src/unv.mjs';\ntest('pick', () => { assert.equal(pick(), 'Y'); });\n");
    commitAll(dir, "greenfield unviable");
    const r = runMutation(dir, "src/unv.mjs", "test/unv.test.mjs");
    console.log("  cmd: node hooks/mutation-bite.mjs --fix=HEAD --test='node --test test/unv.test.mjs' --coverage='... v8cov src/unv.mjs ...'");
    // off-by-one on the '1' index -> TUP[2] is undefined -> .toUpperCase() throws TypeError -> classifyOutcome
    // 'error' -> viable:false (EXCLUDED). With only that mutant, every record is unviable -> exit 2.
    assert.equal(r.exit, 2, r.out);
    assert.match(r.out, /all-mutants-inconclusive|no-viable-covered-mutants/i, r.out);
  } finally { rmrf(dir); }
});

T("KB-unclassifiable: docs-only wave -> router UNCLASSIFIABLE -> exit 2, no runner invoked", () => {
  const dir = newRepo();
  try {
    seed(dir);
    write(dir, "README.md", "# hi\n");
    commitAll(dir, "seed docs");
    write(dir, "README.md", "# hi\n\nmore docs\n");
    commitAll(dir, "docs only");
    const r = runHook(GATE, ["--fix=HEAD", `--test=${testCmd("test/none.test.mjs")}`, "--mode=govern"], dir);
    console.log("  cmd: node hooks/verify-gate.mjs --fix=HEAD --test='node --test test/none.test.mjs' --mode=govern");
    assert.match(r.out, /UNCLASSIFIABLE/, r.out);
    assert.equal(r.exit, 2, r.out);
  } finally { rmrf(dir); }
});

T("KB-regression-noop: REGRESSION but the test STILL PASSES when the fix is reverted -> exit 1", () => {
  const dir = newRepo();
  try {
    seed(dir);
    write(dir, "src/np.mjs", "export function add(a, b) {\n  return a - b;\n}\n");
    write(dir, "test/np.test.mjs", "import test from 'node:test';\nimport assert from 'node:assert/strict';\nimport { add } from '../src/np.mjs';\ntest('weak', () => { assert.equal(typeof add(1, 1), 'number'); });\n");
    commitAll(dir, "baseline");
    write(dir, "src/np.mjs", "export function add(a, b) {\n  return a + b;\n}\n");
    write(dir, "test/np.test.mjs", "import test from 'node:test';\nimport assert from 'node:assert/strict';\nimport { add } from '../src/np.mjs';\ntest('weak2', () => { assert.equal(typeof add(1, 1), 'number'); });\n");
    commitAll(dir, "fix np");
    const r = runHook(GATE, ["--fix=HEAD", `--test=${testCmd("test/np.test.mjs")}`, "--mode=govern", "--runs=2"], dir);
    console.log("  cmd: node hooks/verify-gate.mjs --fix=HEAD --test='node --test test/np.test.mjs' --mode=govern --runs=2");
    assert.match(r.out, /REGRESSION/, r.out);
    assert.equal(r.exit, 1, r.out);
  } finally { rmrf(dir); }
});

T("KB-build-error-not-red (router-level): reverted fix does not compile -> exit 2 (unviable), NOT a fake caught", () => {
  const dir = newRepo();
  try {
    seed(dir);
    write(dir, "src/be.mjs", "export function add(a, b) {\n  return a + ;\n}\n"); // broken on purpose
    write(dir, "test/be.test.mjs", "import test from 'node:test';\nimport assert from 'node:assert/strict';\nimport { add } from '../src/be.mjs';\ntest('adds', () => { assert.equal(add(2, 3), 5); });\n");
    git(dir, ["add", "-A"]); git(dir, ["commit", "-q", "-m", "baseline broken"]);
    write(dir, "src/be.mjs", "export function add(a, b) {\n  return a + b;\n}\n");
    write(dir, "test/be.test.mjs", "import test from 'node:test';\nimport assert from 'node:assert/strict';\nimport { add } from '../src/be.mjs';\ntest('adds now', () => { assert.equal(add(2, 3), 5); });\n");
    commitAll(dir, "fix be");
    const r = runHook(GATE, ["--fix=HEAD", `--test=${testCmd("test/be.test.mjs")}`, "--mode=govern", "--runs=2"], dir);
    console.log("  cmd: node hooks/verify-gate.mjs --fix=HEAD --test='node --test test/be.test.mjs' --mode=govern --runs=2");
    assert.match(r.out, /REGRESSION/, r.out);
    assert.equal(r.exit, 2, "a build error on revert must be cannot-verify, not a fake caught: " + r.out);
  } finally { rmrf(dir); }
});

// ===================== SHADOW does NOT govern =====================

T("SHADOW does not change the governing verdict (defers to the existing bite) + writes JSONL", () => {
  const dir = newRepo();
  try {
    seed(dir);
    write(dir, "src/sh.mjs", "export function band(n) {\n  if (n <= 10) return 'low';\n  return 'high';\n}\n");
    write(dir, "test/sh.test.mjs", "import test from 'node:test';\nimport assert from 'node:assert/strict';\nimport { band } from '../src/sh.mjs';\ntest('b', () => { assert.equal(band(10), 'low'); assert.equal(band(11), 'high'); });\n");
    commitAll(dir, "greenfield shadow");
    const shadow = runHook(GATE, ["--fix=HEAD", `--test=${testCmd("test/sh.test.mjs")}`, `--coverage=${covCmd("src/sh.mjs", "test/sh.test.mjs")}`, "--mode=shadow"], dir);
    console.log("  cmd: node hooks/verify-gate.mjs --fix=HEAD --test='node --test test/sh.test.mjs' --coverage='... v8cov ...' --mode=shadow");
    assert.notEqual(shadow.exit, 0, "shadow must defer to the existing bite, which cannot prove greenfield: " + shadow.out);
    assert.match(shadow.out, /SHADOW/, shadow.out);
    const log = join(dir, ".autonomy-verify-shadow.log");
    assert.ok(existsSync(log), "shadow log must be written");
    const rec = JSON.parse(readFileSync(log, "utf8").trim().split("\n").pop());
    assert.equal(rec.wouldRoute, "GREENFIELD");
    assert.equal(rec.wouldDecide, 0, "router WOULD have killed and exited 0");
    assert.notEqual(rec.currentExit, 0, "the governing (current bite) exit is non-zero");
    assert.equal(rec.mode, "shadow");
    const govern = runHook(GATE, ["--fix=HEAD", `--test=${testCmd("test/sh.test.mjs")}`, `--coverage=${covCmd("src/sh.mjs", "test/sh.test.mjs")}`, "--mode=govern"], dir);
    assert.equal(govern.exit, 0, "govern lets the routed kill pass: " + govern.out);
    assert.notEqual(shadow.exit, govern.exit, "shadow's governing exit differs from govern's routed exit -> shadow did not govern");
  } finally { rmrf(dir); }
});

T("verifyGate DEFAULTS to off (no --mode, no config) -> defers to the golden bite (today's behavior)", () => {
  const dir = newRepo();
  try {
    seed(dir);
    write(dir, "src/df.mjs", "export function add(a, b) {\n  return a - b;\n}\n");
    write(dir, "test/df.test.mjs", "import test from 'node:test';\nimport assert from 'node:assert/strict';\nimport { add } from '../src/df.mjs';\ntest('z', () => { assert.equal(add(0, 0), 0); });\n");
    commitAll(dir, "baseline");
    write(dir, "src/df.mjs", "export function add(a, b) {\n  return a + b;\n}\n");
    write(dir, "test/df.test.mjs", "import test from 'node:test';\nimport assert from 'node:assert/strict';\nimport { add } from '../src/df.mjs';\ntest('adds', () => { assert.equal(add(2, 3), 5); });\n");
    commitAll(dir, "fix");
    assert.ok(!existsSync(join(dir, "autonomy.config.json")), "no config present");
    const r = runHook(GATE, ["--fix=HEAD", `--test=${testCmd("test/df.test.mjs")}`, "--runs=2"], dir);
    console.log("  cmd: node hooks/verify-gate.mjs --fix=HEAD --test='node --test test/df.test.mjs' --runs=2  (no --mode -> default off)");
    assert.ok(!/SHADOW|GOVERN/.test(r.out), "off mode must not run the router banner: " + r.out);
    assert.ok(!existsSync(join(dir, ".autonomy-verify-shadow.log")), "off mode must not write the shadow log");
    assert.equal(r.exit, 0, "the golden bite still governs and catches this regression: " + r.out);
  } finally { rmrf(dir); }
});

T("config gate.verifyGate=off is honored even when present (still today's behavior, no log)", () => {
  const dir = newRepo();
  try {
    seed(dir);
    write(dir, "autonomy.config.json", JSON.stringify({ gate: { verifyGate: "off" } }));
    write(dir, "src/cf.mjs", "export function add(a, b) {\n  return a + b;\n}\n");
    write(dir, "test/cf.test.mjs", "import test from 'node:test';\nimport assert from 'node:assert/strict';\nimport { add } from '../src/cf.mjs';\ntest('adds', () => { assert.equal(add(2, 3), 5); });\n");
    commitAll(dir, "seed src");
    write(dir, "src/cf.mjs", "export function add(a, b) {\n  return b + a;\n}\n");
    write(dir, "test/cf.test.mjs", "import test from 'node:test';\nimport assert from 'node:assert/strict';\nimport { add } from '../src/cf.mjs';\ntest('adds2', () => { assert.equal(add(2, 3), 5); });\n");
    commitAll(dir, "fix");
    const r = runHook(GATE, ["--fix=HEAD", `--test=${testCmd("test/cf.test.mjs")}`, "--runs=2"], dir);
    assert.ok(!/SHADOW|GOVERN/.test(r.out), r.out);
    assert.ok(!existsSync(join(dir, ".autonomy-verify-shadow.log")), "off (via config) must not write the shadow log");
  } finally { rmrf(dir); }
});

// ===================== worktree hygiene =====================

T("WORKTREE HYGIENE: after a mutation run the live tree is clean + no temp worktree remains", () => {
  const dir = newRepo();
  try {
    seed(dir);
    write(dir, "src/hy.mjs", "export function band(n) {\n  if (n <= 10) return 'low';\n  return 'high';\n}\n");
    write(dir, "test/hy.test.mjs", "import test from 'node:test';\nimport assert from 'node:assert/strict';\nimport { band } from '../src/hy.mjs';\ntest('b', () => { assert.equal(band(10), 'low'); assert.equal(band(11), 'high'); });\n");
    commitAll(dir, "greenfield hy");
    const r = runMutation(dir, "src/hy.mjs", "test/hy.test.mjs");
    assert.equal(r.exit, 0, r.out);
    const porc = git(dir, ["status", "--porcelain"]).trim();
    assert.equal(porc, "", "live tree must be byte-identical (clean) after the run: " + porc);
    const wl = git(dir, ["worktree", "list"]).trim().split("\n");
    assert.equal(wl.length, 1, "no temp worktree may remain registered: " + wl.join(" | "));
  } finally { rmrf(dir); }
});

T("WORKTREE HYGIENE under SIGTERM: a mutation run killed mid-flight leaves the live tree clean", () => {
  const dir = newRepo();
  try {
    seed(dir);
    write(dir, "src/sg.mjs", "export function band(n) {\n  if (n <= 10) return 'low';\n  return 'high';\n}\n");
    // a SLOW test so the runner is mid-mutation when we SIGTERM it.
    write(dir, "test/sg.test.mjs", "import test from 'node:test';\nimport assert from 'node:assert/strict';\nimport { band } from '../src/sg.mjs';\ntest('slow', async () => { await new Promise(r => setTimeout(r, 4000)); assert.equal(band(10), 'low'); });\n");
    commitAll(dir, "greenfield slow");
    const child = spawnSync(NODE, [MUT, "--fix=HEAD", `--test=${testCmd("test/sg.test.mjs")}`, `--coverage=${covCmd("src/sg.mjs", "test/sg.test.mjs")}`], { cwd: dir, encoding: "utf8", timeout: 2500, killSignal: "SIGTERM", env: cleanEnv() });
    // the timeout fires SIGTERM mid-run. Assert the LIVE tree is still clean + no worktree leaked.
    const porc = git(dir, ["status", "--porcelain"]).trim();
    assert.equal(porc, "", "live tree must remain clean after a SIGTERM mid-run: " + porc);
    const wl = git(dir, ["worktree", "list"]).trim().split("\n");
    // best-effort: the cleanup handler removes the worktree on SIGTERM; allow up to one stale entry only if
    // git itself could not unregister in time, but the LIVE tree cleanliness above is the load-bearing check.
    assert.ok(wl.length <= 2, "no more than the main worktree should remain: " + wl.join(" | "));
    console.log("  SIGTERM hygiene: porcelain clean, worktrees=" + wl.length);
  } finally { rmrf(dir); }
});

// ===================== RUNNER-LEVEL invariant fuzz =====================

T("INVARIANT FUZZ (runner level): never exit 0 without a recorded killed mutant", () => {
  const N = Number(process.env.VG_FUZZ_N || 24);
  let violations = 0, ran = 0, zeros = 0;
  const ops = [
    { src: "  if (n <= 10) return 'low';\n  return 'high';", good: "assert.equal(band(10),'low'); assert.equal(band(11),'high');", boundary: 10 },
    { src: "  if (n < 10) return 'low';\n  return 'high';", good: "assert.equal(band(9),'low'); assert.equal(band(10),'high');", boundary: 9 },
    { src: "  if (n === 0) return 'zero';\n  return 'nonzero';", good: "assert.equal(band(0),'zero'); assert.equal(band(1),'nonzero');", boundary: 0 },
    { src: "  return n + 1;", good: "assert.equal(band(2),3);", boundary: 2 },
  ];
  const strengths = ["good", "weak", "none", "noassert"];
  for (let i = 0; i < N; i++) {
    const dir = newRepo();
    try {
      seed(dir);
      const o = ops[(Math.random() * ops.length) | 0];
      const strength = strengths[(Math.random() * strengths.length) | 0];
      write(dir, "src/fz.mjs", "export function band(n) {\n" + o.src + "\n}\n");
      let body;
      if (strength === "good") body = o.good;
      else if (strength === "weak") body = "assert.equal(typeof band(" + o.boundary + "), 'string');";
      else if (strength === "none") body = "band(" + o.boundary + "); assert.equal(1,1);";
      else body = "band(" + o.boundary + "); band(" + (o.boundary + 1) + ");";
      const imp = "import test from 'node:test';\nimport assert from 'node:assert/strict';\nimport { band } from '../src/fz.mjs';\n";
      write(dir, "test/fz.test.mjs", imp + "test('t', () => { " + body + " });\n");
      commitAll(dir, "fuzz " + i);
      const r = runMutation(dir, "src/fz.mjs", "test/fz.test.mjs");
      ran++;
      if (r.exit === 0) { zeros++; if (!/killed\s+\d+\s+mutant/i.test(r.out)) { violations++; console.error("VIOLATION (exit 0, no recorded kill):\n" + r.out); } }
    } finally { rmrf(dir); }
  }
  console.log(`  fuzz: ran=${ran} exit0=${zeros} violations=${violations}`);
  assert.equal(violations, 0, "the runner must never exit 0 without a recorded killed mutant");
});

T("INVARIANT FUZZ (router/govern): a routed exit 0 always carries a recorded proof in the JSONL", () => {
  const N = Number(process.env.VG_FUZZ_ROUTER_N || 15);
  let violations = 0, zeros = 0;
  for (let i = 0; i < N; i++) {
    const dir = newRepo();
    try {
      seed(dir);
      const kind = i % 3;
      if (kind === 2) {
        write(dir, "src/rf.mjs", "export function add(a,b){\n  return a - b;\n}\n");
        write(dir, "test/rf.test.mjs", "import test from 'node:test';\nimport assert from 'node:assert/strict';\nimport { add } from '../src/rf.mjs';\ntest('z', () => { assert.equal(add(0,0),0); });\n");
        commitAll(dir, "base");
        write(dir, "src/rf.mjs", "export function add(a,b){\n  return a + b;\n}\n");
        write(dir, "test/rf.test.mjs", "import test from 'node:test';\nimport assert from 'node:assert/strict';\nimport { add } from '../src/rf.mjs';\ntest('a', () => { assert.equal(add(2,3),5); });\n");
        commitAll(dir, "fix");
        const r = runHook(GATE, ["--fix=HEAD", `--test=${testCmd("test/rf.test.mjs")}`, "--mode=govern", "--runs=2"], dir);
        if (r.exit === 0) { zeros++; const rec = JSON.parse(readFileSync(join(dir, ".autonomy-verify-shadow.log"), "utf8").trim().split("\n").pop()); if (rec.proof !== "caught" && rec.proof !== "killed") violations++; }
      } else {
        write(dir, "src/rf.mjs", "export function band(n){\n  if (n <= 10) return 'low';\n  return 'high';\n}\n");
        const body = kind === 0 ? "assert.equal(band(10),'low'); assert.equal(band(11),'high');" : "band(10); assert.equal(1,1);";
        write(dir, "test/rf.test.mjs", "import test from 'node:test';\nimport assert from 'node:assert/strict';\nimport { band } from '../src/rf.mjs';\ntest('t', () => { " + body + " });\n");
        commitAll(dir, "gf");
        const r = runHook(GATE, ["--fix=HEAD", `--test=${testCmd("test/rf.test.mjs")}`, `--coverage=${covCmd("src/rf.mjs", "test/rf.test.mjs")}`, "--mode=govern"], dir);
        if (r.exit === 0) { zeros++; const rec = JSON.parse(readFileSync(join(dir, ".autonomy-verify-shadow.log"), "utf8").trim().split("\n").pop()); if (rec.proof !== "caught" && rec.proof !== "killed") violations++; }
      }
    } finally { rmrf(dir); }
  }
  console.log(`  router-fuzz: exit0=${zeros} violations=${violations}`);
  assert.equal(violations, 0, "a routed exit 0 must always carry proof=caught or proof=killed");
});
