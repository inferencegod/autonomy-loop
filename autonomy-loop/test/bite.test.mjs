// Tests for the mechanized bite (the assertion gate). decideBite turns the outcome of reverting a
// fix and re-running the target test into pass / no-op / cannot-verify, encoding the prior-art rules:
// exit code is not a valid RED, flake needs N-in-a-row, baseline must be green, mapping must hold.
// Run: node --test test/bite.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { decideBite, classifyOutcome } from "../hooks/bite.mjs";

const fails = (n) => Array(n).fill("assert-fail");
const passes = (n) => Array(n).fill("pass");

// ---- decideBite ----

test("CAUGHT: assertion-fail on all N reverted runs is a real bite (pass, exit 0)", () => {
  const r = decideBite({ baselineGreen: true, coversChangedCode: true, revertRuns: fails(3) });
  assert.equal(r.ok, true);
  assert.equal(r.action, "caught");
  assert.equal(r.exit, 0);
});

test("NO-OP: the test still passes with the fix reverted -> the bite FAILS (exit 1)", () => {
  const r = decideBite({ baselineGreen: true, coversChangedCode: true, revertRuns: passes(3) });
  assert.equal(r.ok, false);
  assert.equal(r.action, "no-op");
  assert.equal(r.exit, 1);
});

test("UNVIABLE: an ERROR (won't build/collect) is not a valid RED (cannot-verify, exit 2)", () => {
  const r = decideBite({ baselineGreen: true, coversChangedCode: true, revertRuns: ["assert-fail", "error", "assert-fail"] });
  assert.equal(r.ok, false);
  assert.equal(r.action, "cannot-verify");
  assert.equal(r.code, "unviable");
  assert.equal(r.exit, 2);
});

test("UNVIABLE: a TIMEOUT is not a valid RED", () => {
  const r = decideBite({ baselineGreen: true, coversChangedCode: true, revertRuns: ["timeout", "timeout", "timeout"] });
  assert.equal(r.code, "unviable");
});

test("FLAKY: mixed pass/fail across the window is inconclusive, never a pass (exit 2)", () => {
  const r = decideBite({ baselineGreen: true, coversChangedCode: true, revertRuns: ["assert-fail", "pass", "assert-fail"] });
  assert.equal(r.ok, false);
  assert.equal(r.action, "cannot-verify");
  assert.equal(r.code, "flaky");
});

test("BASELINE-NOT-GREEN: a RED proves nothing if the test was not green on the fix", () => {
  const r = decideBite({ baselineGreen: false, coversChangedCode: true, revertRuns: fails(3) });
  assert.equal(r.code, "baseline-not-green");
  assert.equal(r.exit, 2);
});

test("UNMAPPED: a test that does not execute the reverted code is the wrong test (cannot-verify)", () => {
  const r = decideBite({ baselineGreen: true, coversChangedCode: false, revertRuns: fails(3) });
  assert.equal(r.code, "unmapped");
  assert.equal(r.exit, 2);
});

test("unknown mapping (null) does not block: it proceeds on the run outcomes", () => {
  const r = decideBite({ baselineGreen: true, coversChangedCode: null, revertRuns: fails(3) });
  assert.equal(r.action, "caught");
});

test("INSUFFICIENT-RUNS: fewer than the required runs cannot rule out a flake", () => {
  const r = decideBite({ baselineGreen: true, coversChangedCode: true, revertRuns: fails(2) }, { runs: 3 });
  assert.equal(r.code, "insufficient-runs");
  assert.equal(r.exit, 2);
});

test("the runs knob is honored and judges only the last N", () => {
  // one early flake, then 3 clean assertion fails with runs=3 -> caught (judged window is the last 3)
  const r = decideBite({ baselineGreen: true, coversChangedCode: true, revertRuns: ["pass", "assert-fail", "assert-fail", "assert-fail"] }, { runs: 3 });
  assert.equal(r.action, "caught");
  // runs=1 caught on a single assertion fail
  assert.equal(decideBite({ baselineGreen: true, revertRuns: ["assert-fail"] }, { runs: 1 }).action, "caught");
});

test("deterministic: identical inputs yield a byte-identical decision", () => {
  const a = decideBite({ baselineGreen: true, coversChangedCode: true, revertRuns: fails(3) });
  const b = decideBite({ baselineGreen: true, coversChangedCode: true, revertRuns: fails(3) });
  assert.deepEqual(a, b);
});

// ---- classifyOutcome ----

test("classifyOutcome: exit 0 is always a pass", () => {
  assert.equal(classifyOutcome(0, "anything"), "pass");
});

test("classifyOutcome: an assertion failure is assert-fail", () => {
  assert.equal(classifyOutcome(1, "AssertionError [ERR_ASSERTION]: expected 5 to equal 6"), "assert-fail");
});

test("classifyOutcome: a build/collect error is error, not a fake RED", () => {
  assert.equal(classifyOutcome(1, "Error: Cannot find module '../hooks/x.mjs'"), "error");
  assert.equal(classifyOutcome(1, "SyntaxError: Unexpected token }"), "error");
});

test("classifyOutcome: a timeout is timeout", () => {
  assert.equal(classifyOutcome(1, "test timed out after 2000ms"), "timeout");
});

test("classifyOutcome: an explicit --assert-regex is authoritative (non-match = error)", () => {
  assert.equal(classifyOutcome(1, "1 failing\n  AssertionError", { assertRe: /\d+ failing/ }), "assert-fail");
  assert.equal(classifyOutcome(1, "boom unrelated crash", { assertRe: /\d+ failing/ }), "error");
});

test("classifyOutcome: ambiguous non-zero fails closed to error (an exit code is not a valid RED)", () => {
  assert.equal(classifyOutcome(1, "some terse nonstandard output"), "error");
});

test("classifyOutcome: a CRASH that merely mentions 'expected'/'assert' fails CLOSED, not a fake caught bite", () => {
  // the red-team fail-open: a reverted fix that CRASHES with 'expected'/'assert' in the text must NOT be
  // read as a caught assertion (that would be a false green in the crown-jewel bite). It is now "error".
  assert.equal(classifyOutcome(1, "Error: the expected result was wrong\n    at f (x.js:1:1)"), "error");
  assert.equal(classifyOutcome(1, "TypeError: Cannot read properties of undefined (reading 'expected')"), "error");
  assert.equal(classifyOutcome(1, "ReferenceError: assert is not defined"), "error");
  // a genuine assertion is still caught (regression guard for the narrowing)
  assert.equal(classifyOutcome(1, "expect(received).toBe(expected)\nExpected: 1\nReceived: 2"), "assert-fail");
  assert.equal(classifyOutcome(1, "not ok 1 - it works"), "assert-fail");
});
