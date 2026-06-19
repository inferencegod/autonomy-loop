// autonomy-loop: classify-bite (Greenfield-Bite Router, doc 08). Pure decision core. The golden-revert
// bite REQUIRES a pre-existing baseline (revert the fix -> the test must go RED). A brand-new module+test
// in one commit has nothing to revert to (reverting deletes the unit the test imports -> collect error).
// This deterministically routes each commit to the gate that can actually prove it and SURFACES which one
// ran. Pure git+diff only (a symbol is net-new iff its file is ADDED this commit); no language semantics.
// Fail-closed: UNCLASSIFIABLE -> exit 2.
const TEST_RX = [/\.test\./, /\.spec\./, /(^|\/)tests?\//, /(^|\/)__tests__\//];
const isTest = (p) => TEST_RX.some((r) => r.test(String(p || "").toLowerCase()));
const looksCode = (p) => !/\.(md|markdown|txt|json|ya?ml|lock|toml|ini|cfg|csv|svg|png|jpe?g|gif|webp)$/i.test(String(p || ""));
const up = (s) => String(s || "").trim().toUpperCase().slice(0, 1);
const norm = (p) => String(p || "").replace(/\\/g, "/").replace(/^\.?\//, "").replace(/^[ab]\//, "");

// classifyBite(input) -> { case, gate, exit, reason }
//   case: REGRESSION | GREENFIELD | EMPTY_FIX | REFACTOR_SUSPECT | UNCLASSIFIABLE
//   gate: "golden-revert" | "mutation-bite" | null      exit: 0 (route) | 2 (cannot route, fail-closed)
//   input.changedFiles: [{ path, status }]  status in A|M|D|R (added/modified/deleted/renamed)
//   input.testImports: [paths]  source files the new/changed test imports (to find the unit under test)
export function classifyBite(input = {}) {
  const files = Array.isArray(input.changedFiles) ? input.changedFiles : [];
  const imports = (Array.isArray(input.testImports) ? input.testImports : []).map(norm);
  const src = files.filter((f) => f && !isTest(f.path));
  const tests = files.filter((f) => f && isTest(f.path));
  const srcAdded = src.filter((f) => up(f.status) === "A");
  const srcModified = src.filter((f) => ["M", "R"].includes(up(f.status)));
  const testAdded = tests.some((f) => up(f.status) === "A");
  const testTouched = testAdded || tests.some((f) => up(f.status) === "M");
  const addedPaths = new Set(src.filter((f) => up(f.status) === "A").map((f) => norm(f.path)));
  const importsNetNew = imports.some((p) => addedPaths.has(p));
  const importsExisting = imports.some((p) => !addedPaths.has(p));

  // REGRESSION takes PRIORITY (red-team P1-4 fix): ANY modified source with a test routes to golden-revert.
  // A modified file can carry a regression the mutation path never checks, so it must not be routed to the
  // weaker mutation gate just because the test ALSO imports a net-new file. If the same commit also adds a
  // file, golden-revert that cannot reintroduce it returns cannot-verify (a safe bounce), never a weak pass.
  if (srcModified.length && testTouched)
    return r("REGRESSION", "golden-revert", 0, "existing code changed with a new/updated test; revert-to-RED applies");
  // GREENFIELD only when there is NO modified source: a pure net-new module the revert cannot reintroduce.
  if (srcAdded.length && !srcModified.length && testTouched && importsNetNew && !importsExisting)
    return r("GREENFIELD", "mutation-bite", 0, "unit under test is net-new; revert has nothing to reintroduce");
  if (!src.length && testAdded)
    return r("EMPTY_FIX", "mutation-bite", 0, "new test, no source hunk to revert; verify by mutating covered code");
  if (srcModified.filter((f) => looksCode(f.path)).length && !testTouched)
    return r("REFACTOR_SUSPECT", "mutation-bite", 0, "source changed with no test delta; revert may not flip, mutate instead");
  return r("UNCLASSIFIABLE", null, 2, "no test constrains the change (or no usable code diff); cannot prove, fail closed");
}
function r(c, gate, exit, reason) { return { case: c, gate, exit, reason }; }
