import { test } from "node:test";
import assert from "node:assert/strict";
import { decidePatch, parseDiff, coverageFromIstanbul } from "../hooks/patch-coverage.mjs";

// decidePatch ---------------------------------------------------------------
test("all changed lines covered -> pass at 100%", () => {
  const r = decidePatch({ "a.js": [1, 2, 3] }, { "a.js": { coverable: [1, 2, 3], covered: [1, 2, 3] } });
  assert.equal(r.ok, true);
  assert.equal(r.action, "pass");
  assert.equal(r.patchPct, 100);
});

test("THE HOLE: covered lines + one bare line PASSES the global ratchet but patch coverage SEES it", () => {
  // 9 of 10 changed lines covered = 90%. At the default 80 bar it passes, but the bare line is reported.
  const changed = { "a.js": [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] };
  const cov = { "a.js": { coverable: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10], covered: [1, 2, 3, 4, 5, 6, 7, 8, 9] } };
  const r = decidePatch(changed, cov, { threshold: 80 });
  assert.equal(r.ok, true);
  assert.equal(r.patchPct, 90);
  assert.deepEqual(r.uncovered, ["a.js:10"]);
});

test("at a 100% bar the SAME single bare line is BLOCKED (the strict setting Matt's case needs)", () => {
  const changed = { "a.js": [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] };
  const cov = { "a.js": { coverable: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10], covered: [1, 2, 3, 4, 5, 6, 7, 8, 9] } };
  const r = decidePatch(changed, cov, { threshold: 100 });
  assert.equal(r.ok, false);
  assert.equal(r.action, "under-covered");
  assert.deepEqual(r.uncovered, ["a.js:10"]);
});

test("below the bar blocks (3 of 4 = 75% < 80)", () => {
  const r = decidePatch({ "a.js": [1, 2, 3, 4] }, { "a.js": { coverable: [1, 2, 3, 4], covered: [1, 2, 3] } }, { threshold: 80 });
  assert.equal(r.ok, false);
  assert.equal(r.patchPct, 75);
});

test("non-coverable changed lines (comments/blank) are not counted", () => {
  // lines 1 and 3 are comments (not in coverable), only line 2 is real and it is covered
  const r = decidePatch({ "a.js": [1, 2, 3] }, { "a.js": { coverable: [2], covered: [2] } });
  assert.equal(r.ok, true);
  assert.equal(r.total, 1);
  assert.equal(r.patchPct, 100);
});

test("a changed file absent from the coverage report is skipped (docs/config)", () => {
  const r = decidePatch({ "README.md": [1, 2] }, {});
  assert.equal(r.ok, true);
  assert.equal(r.action, "no-op");
});

test("a wave with no executable changes is a no-op pass", () => {
  const r = decidePatch({}, {});
  assert.equal(r.ok, true);
  assert.equal(r.action, "no-op");
});

test("threshold is clamped to [0,100]", () => {
  assert.equal(decidePatch({ "a.js": [1] }, { "a.js": { coverable: [1], covered: [1] } }, { threshold: 500 }).threshold, 100);
  assert.equal(decidePatch({ "a.js": [1] }, { "a.js": { coverable: [1], covered: [1] } }, { threshold: -9 }).threshold, 0);
});

test("deterministic: identical inputs yield a byte-identical decision", () => {
  const a = decidePatch({ "a.js": [1, 2] }, { "a.js": { coverable: [1, 2], covered: [1] } }, { threshold: 80 });
  const b = decidePatch({ "a.js": [1, 2] }, { "a.js": { coverable: [1, 2], covered: [1] } }, { threshold: 80 });
  assert.deepEqual(a, b);
});

// parseDiff -----------------------------------------------------------------
test("parseDiff: added lines map to new-file line numbers", () => {
  const diff = [
    "diff --git a/lib/foo.js b/lib/foo.js",
    "index 1111111..2222222 100644",
    "--- a/lib/foo.js",
    "+++ b/lib/foo.js",
    "@@ -10,0 +11,2 @@",
    "+const x = 1;",
    "+const y = 2;",
  ].join("\n");
  assert.deepEqual(parseDiff(diff), { "lib/foo.js": [11, 12] });
});

test("parseDiff: a brand-new file numbers from line 1", () => {
  const diff = ["--- /dev/null", "+++ b/src/new.js", "@@ -0,0 +1,3 @@", "+a", "+b", "+c"].join("\n");
  assert.deepEqual(parseDiff(diff), { "src/new.js": [1, 2, 3] });
});

test("parseDiff: deletions do not count, and a deleted file is skipped", () => {
  const diff = ["--- a/x.js", "+++ /dev/null", "@@ -1,2 +0,0 @@", "-gone1", "-gone2"].join("\n");
  assert.deepEqual(parseDiff(diff), {});
});

// coverageFromIstanbul ------------------------------------------------------
test("coverageFromIstanbul: a line with an unhit statement is coverable but not covered", () => {
  const final = { "/repo/lib/a.js": { statementMap: { 0: { start: { line: 5 } }, 1: { start: { line: 6 } } }, s: { 0: 3, 1: 0 } } };
  const out = coverageFromIstanbul(final, "/repo");
  assert.deepEqual(out["lib/a.js"].coverable.sort(), [5, 6]);
  assert.deepEqual(out["lib/a.js"].covered, [5]);
});

test("coverageFromIstanbul: a line is covered if ANY statement on it ran", () => {
  const final = { "/repo/lib/a.js": { statementMap: { 0: { start: { line: 5 } }, 1: { start: { line: 5 } } }, s: { 0: 0, 1: 2 } } };
  const out = coverageFromIstanbul(final, "/repo");
  assert.deepEqual(out["lib/a.js"].covered, [5]);
});
