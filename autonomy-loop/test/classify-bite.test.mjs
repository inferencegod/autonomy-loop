import test from "node:test";
import assert from "node:assert/strict";
import { classifyBite } from "../hooks/classify-bite.mjs";

test("(a/b) existing code changed + a new/updated test -> REGRESSION / golden-revert", () => {
  assert.equal(classifyBite({ changedFiles: [{ path: "src/foo.js", status: "M" }, { path: "test/foo.test.js", status: "A" }] }).case, "REGRESSION");
});

test("(c) net-new module + its test -> GREENFIELD / mutation-bite", () => {
  const r = classifyBite({ changedFiles: [{ path: "src/new.js", status: "A" }, { path: "test/new.test.js", status: "A" }], testImports: ["src/new.js"] });
  assert.equal(r.case, "GREENFIELD");
  assert.equal(r.gate, "mutation-bite");
});

test("(d) a new test for untouched existing code -> EMPTY_FIX / mutation-bite", () => {
  assert.equal(classifyBite({ changedFiles: [{ path: "test/foo.test.js", status: "A" }] }).case, "EMPTY_FIX");
});

test("(e) source changed with no test delta -> REFACTOR_SUSPECT / mutation-bite", () => {
  assert.equal(classifyBite({ changedFiles: [{ path: "src/foo.js", status: "M" }] }).case, "REFACTOR_SUSPECT");
});

test("fail-closed: empty diff, a pure deletion, and a docs-only change all -> UNCLASSIFIABLE exit 2", () => {
  assert.equal(classifyBite({ changedFiles: [] }).exit, 2);
  assert.equal(classifyBite({ changedFiles: [{ path: "src/x.js", status: "D" }] }).exit, 2);
  assert.equal(classifyBite({ changedFiles: [{ path: "README.md", status: "M" }] }).exit, 2);
});

test("red-team P1-4: a mixed diff (modified source + added file, test imports only the new file) routes to REGRESSION, not GREENFIELD", () => {
  // an attacker shaping the diff so a regression in a MODIFIED file rides into the weaker mutation gate must fail.
  // REGRESSION takes priority on any modified source: the strong golden-revert governs (or cannot-verify, never a weak pass).
  const r = classifyBite({ changedFiles: [
    { path: "src/foo.js", status: "M" },   // the regression would hide here
    { path: "src/new.js", status: "A" },   // a net-new file the test imports
    { path: "test/t.test.js", status: "A" },
  ], testImports: ["src/new.js"] });
  assert.equal(r.case, "REGRESSION");
  assert.equal(r.gate, "golden-revert");
  // a PURE greenfield (no modified source) still routes to mutation as designed
  assert.equal(classifyBite({ changedFiles: [{ path: "src/new.js", status: "A" }, { path: "test/new.test.js", status: "A" }], testImports: ["src/new.js"] }).case, "GREENFIELD");
});
