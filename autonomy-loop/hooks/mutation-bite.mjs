// autonomy-loop: mutation-bite (Greenfield Mutation-Kill Gate, doc 08). Pure decision core. The
// complement to the golden-revert bite for the case the revert cannot handle (brand-new module+test,
// empty-fix, behavior-preserving refactor): there is no prior fault to reintroduce, so instead ask "do
// the test's assertions actually constrain THIS code?" Answer = mutation kill. Mutate the changed source
// lines (reusing the project mutate engine), rerun ONLY the new test, require >=1 kill. Global
// fail-closed invariant: NEVER exit 0 without a recorded killed mutant. No deps.
// exit: 0 killed (proof), 1 no-kill (test pins nothing), 2 cannot-verify (no viable+scored mutant).
//
// TWO ways the runner picks which lines to mutate (R3a, ISSUE-6):
//   - WITH --coverage: mutate only the COVERED changed lines (coverage-driven; the precise path, unchanged).
//   - WITHOUT --coverage / --cov-file: a DIFF-BASED FALLBACK. A typical greenfield wave commits the new
//     module AND its test together, and most installs have no coverage tool wired, so the coverage path
//     was cannot-verify forever (the field report: the reviewer hand-did mutation on nearly every wave).
//     With no coverage we mutate ALL the wave's CHANGED SOURCE lines (the non-test source hunk of the
//     fix, the same set classify-bite calls net-new) and still require the new test to KILL >=1 mutant.
//     This is strictly fail-closed: a changed line the test never exercises survives its mutant -> exit 1,
//     and if there are NO changed source lines and NO coverage there is nothing to score -> exit 2. The
//     EMPTY_FIX shape (no source hunk, only a new test importing existing code) has no changed source line
//     to mutate, so without coverage it stays cannot-verify (exit 2): never a free pass.

// decideMutationBite(input) -> { exit, reason, killed:[{lineNo,op}], viable, covered }
//   input.mutantResults: [{ lineNo, op, covered, viable, killedByTest, timedOut, buildError }]
//     viable=false: equivalent/non-compiling -> EXCLUDED. covered=false: not run by the test -> EXCLUDED.
//     killedByTest: the new test failed with an ASSERTION when this mutant was live. timedOut counts as a kill.
//   input.assertionLiveness: optional pre-check; false = the new test has no live assertion -> exit 1.
export function decideMutationBite(input = {}) {
  const mr = Array.isArray(input.mutantResults) ? input.mutantResults : null;
  if (mr === null) return out(2, "no-mutant-results", [], 0, 0);
  if (input.assertionLiveness === false) return out(1, "no-live-assertion-in-test", [], 0, 0); // cheap pre-check
  const considered = mr.filter((m) => m && m.viable !== false && m.covered !== false); // exclude equivalent + uncovered
  const covered = considered.length;
  if (covered === 0) return out(2, "no-viable-covered-mutants", [], 0, 0);
  if (considered.every((m) => m.buildError && !m.timedOut && !m.killedByTest)) return out(2, "all-mutants-inconclusive", [], 0, covered);
  const killed = considered.filter((m) => m.killedByTest || m.timedOut).map((m) => ({ lineNo: m.lineNo, op: m.op || null })); // timeout = kill
  if (killed.length >= 1) return out(0, `killed ${killed.length} mutant(s) on covered changed lines`, killed, considered.length, covered);
  return out(1, "all viable covered mutants survived: the test pins nothing", [], considered.length, covered);
}
function out(exit, reason, killed, viable, covered) { return { exit, reason, killed, viable, covered }; }

// ---- thin runner (reviewer-side mutation-bite; only when invoked directly) ----
// Reuses the bite's THROWAWAY detached worktree (never the live tree), mutate.mjs's operators, and
// classifyOutcome as the assertion-vs-build/timeout discriminator. Coverage pre-filter (mutate only
// COVERED changed lines) + assertion-liveness pre-check. Restore-safe on SIGINT/SIGTERM. No deps.
// CLI: node hooks/mutation-bite.mjs --fix=<sha> --test="<cmd that runs ONLY the new test>"
//      --coverage="<cmd that emits an Istanbul coverage-final.json for that test>"
//      [--cov-file=coverage/coverage-final.json] [--assert-regex=<re>] [--per-file=10] [--max=30] [--timeout-mult=3]
import { execSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseDiff, coverageFromIstanbul } from "./patch-coverage.mjs";
import { mutantsForLine } from "./mutate.mjs";
import { classifyOutcome } from "./bite.mjs";

// strip env vars that corrupt NESTED node:test / coverage runs. If this runner is itself invoked from
// within a `node --test` process, NODE_TEST_CONTEXT + NODE_V8_COVERAGE leak into the test and coverage
// subprocesses and break their TAP / coverage emission. We always spawn with a sanitized env.
function _cleanEnv() { const e = { ...process.env }; delete e.NODE_TEST_CONTEXT; delete e.NODE_V8_COVERAGE; delete e.NODE_OPTIONS; return e; }
const _NUM = (v, d) => { const n = Number(v); return Number.isFinite(n) ? n : d; };
const _clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
// the same TEST_RX classify-bite.mjs uses, to DROP test files from the mutate set (we mutate source only).
const _TEST_RX = [/\.test\./, /\.spec\./, /(^|\/)tests?\//, /(^|\/)__tests__\//];
const _isTest = (p) => _TEST_RX.some((r) => r.test(String(p || "").toLowerCase()));
const _looksCode = (p) => !/\.(md|markdown|txt|json|ya?ml|lock|toml|ini|cfg|csv|svg|png|jpe?g|gif|webp)$/i.test(String(p || ""));
// conservative live-assertion matcher (Section 3): only short-circuit on a CLEARLY assertion-free file.
const _ASSERT_RX = /\bassert\b|\bassert\s*\.|\bexpect\s*\(|\.to\.|\.should\b|\bshould\s*\(|\bt\.(is|deepEqual|equal|truthy|falsy|throws|notThrows|regex)\b/;

function _sh(cmd, cwd) { return execSync(cmd, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 64 * 1024 * 1024, env: _cleanEnv() }); }
function _run(cmd, cwd, timeoutMs) {
  try { const o = execSync(cmd, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 64 * 1024 * 1024, timeout: timeoutMs || undefined, env: _cleanEnv() }); return { code: 0, text: o }; }
  catch (e) {
    if (e && (e.signal === "SIGTERM" || e.killed === true || e.code === "ETIMEDOUT")) return { code: 124, text: "timed out" };
    return { code: (e && e.status) || 1, text: ((e && e.stdout) || "") + "\n" + ((e && e.stderr) || "") };
  }
}
function _readJson(p) { try { return JSON.parse(readFileSync(p, "utf8")); } catch { return null; } }
// Resolve a relative import specifier from a test file to a repo-relative path (best-effort, static).
// Used ONLY for the EMPTY_FIX fallback (no source diff -> mutate the imported source's covered lines).
function _resolveImport(spec, testRel) {
  if (!spec || /^[a-z][a-z0-9+.-]*:/i.test(spec)) return null;
  if (!spec.startsWith(".") && !spec.startsWith("/")) return null; // bare dependency
  const baseDir = testRel.includes("/") ? testRel.slice(0, testRel.lastIndexOf("/")) : "";
  let p = spec.startsWith("/") ? spec.replace(/^\/+/, "") : (baseDir ? baseDir + "/" + spec : spec);
  const segs = []; for (const s of p.split("/")) { if (s === "." || s === "") continue; if (s === "..") segs.pop(); else segs.push(s); }
  return segs.join("/");
}
function _importsOfTest(absTestPath, testRel) {
  let src; try { src = readFileSync(absTestPath, "utf8"); } catch { return []; }
  const specs = new Set(); let m;
  const rxes = [/import\s+[^'"]*?from\s*['"]([^'"]+)['"]/g, /import\s*['"]([^'"]+)['"]/g, /import\s*\(\s*['"]([^'"]+)['"]\s*\)/g, /require\s*\(\s*['"]([^'"]+)['"]\s*\)/g];
  for (const rx of rxes) { while ((m = rx.exec(src))) specs.add(m[1]); }
  const out = [];
  for (const s of specs) { const r = _resolveImport(s, testRel); if (r && _looksCode(r) && !_isTest(r)) out.push(r); }
  return [...new Set(out)];
}
// map one classifyOutcome result to the RECORD shape decideMutationBite consumes (spec Section 2.2 table).
function _recordFromOutcome(cls, lineNo, op) {
  if (cls === "assert-fail") return { lineNo, op, covered: true, viable: true, killedByTest: true };
  if (cls === "timeout") return { lineNo, op, covered: true, viable: true, timedOut: true };
  if (cls === "error") return { lineNo, op, covered: true, viable: false, buildError: true };
  return { lineNo, op, covered: true, viable: true, killedByTest: false };
}
let _activeCleanup = null; // set to the worktree teardown while a worktree is live
function _emit(r) { try { if (_activeCleanup) _activeCleanup(); } catch {} console.log(`[mutation-bite] exit ${r.exit}: ${r.reason}`); process.exit(r.exit); }

function mbMain(argv) {
  const args = Object.fromEntries(argv.slice(2).map((a) => { const m = a.match(/^--([^=]+)=(.*)$/); return m ? [m[1], m[2]] : [a.replace(/^--/, ""), true]; }));
  const fixSha = args.fix || args.sha || "HEAD";
  const testCmd = args.test;
  const covCmd = args.coverage;
  const covFile = args["cov-file"] || "coverage/coverage-final.json";
  const assertRe = args["assert-regex"] ? new RegExp(args["assert-regex"], "i") : null;
  const perFile = _clamp(_NUM(args["per-file"], 10), 1, 100);
  const maxMut = _clamp(_NUM(args.max, 30), 1, 500);
  const timeoutMult = _clamp(_NUM(args["timeout-mult"], 3), 1, 50);

  if (!testCmd) { console.error('[mutation-bite] need --test "<cmd that runs ONLY the new test>".'); process.exit(2); }
  if (!/^[0-9A-Za-z_./^~-]+$/.test(fixSha)) { console.error(`[mutation-bite] refusing a fix ref with unexpected characters: ${fixSha}`); process.exit(2); }

  let repoRoot, diffText;
  try {
    repoRoot = _sh("git rev-parse --show-toplevel").trim();
    _sh(`git rev-parse ${fixSha}~1`);
    const parentCount = _sh(`git rev-list --parents -n 1 ${fixSha}`).trim().split(/\s+/).length - 1;
    if (parentCount >= 2) { console.log("[mutation-bite] exit 2: the fix is a merge commit; point --fix at a single non-merge commit."); process.exit(2); }
    diffText = _sh(`git diff --unified=0 ${fixSha}~1 ${fixSha}`);
  } catch (e) { console.error(`[mutation-bite] cannot resolve the fix commit ${fixSha} or its parent: ${e && e.message}`); process.exit(2); }

  const changed = parseDiff(diffText);
  const changedSrc = {};
  for (const [f, lines] of Object.entries(changed)) { if (!_isTest(f) && _looksCode(f)) changedSrc[f] = lines; }
  let emptyFixTargets = [];
  if (Object.keys(changedSrc).length === 0) {
    const changedTests = Object.keys(changed).filter((f) => _isTest(f));
    let imported = [];
    for (const tf of changedTests) imported = imported.concat(_importsOfTest(join(repoRoot, tf), tf.replace(/\\/g, "/")));
    emptyFixTargets = [...new Set(imported)];
    if (emptyFixTargets.length === 0) { _emit(decideMutationBite({ mutantResults: [] })); return; }
  }

  const wt = mkdtempSync(join(tmpdir(), "mutation-"));
  const cleanup = () => { try { _sh(`git worktree remove --force "${wt}"`); } catch {} try { rmSync(wt, { recursive: true, force: true }); } catch {} };
  _activeCleanup = cleanup;
  const onSig = () => { cleanup(); process.exit(130); };
  process.on("SIGINT", onSig); process.on("SIGTERM", onSig);

  try {
    _sh(`git worktree add --detach "${wt}" ${fixSha}`);

    const t0 = Date.now();
    const baseline = _run(testCmd, wt);
    const baseMs = Math.max(1, Date.now() - t0);
    if (baseline.code !== 0) { _emit({ exit: 2, reason: "baseline-not-green: the new test is not GREEN on the fixed code; a kill would be meaningless. Stabilize the test first.", killed: [], viable: 0, covered: 0 }); return; }
    const perMutTimeout = Math.max(2000, Math.min(120000, timeoutMult * baseMs + 1500));

    const mutateSet = {};
    if (!covCmd) {
      // ---- R3a DIFF-BASED FALLBACK: no coverage tool wired. Mutate the wave's CHANGED SOURCE lines
      // directly (no coverage intersection). A changed line the test never runs simply yields a surviving
      // mutant -> exit 1, so this never weakens the kill requirement. EMPTY_FIX (no changed source hunk,
      // only an imported existing file) has NO changed source line to mutate without coverage, so it stays
      // cannot-verify (exit 2) rather than become a free pass.
      if (Object.keys(changedSrc).length === 0) { _emit(decideMutationBite({ mutantResults: [] })); return; }
      for (const [f, lines] of Object.entries(changedSrc)) {
        const keep = [...new Set(lines)].sort((a, b) => a - b);
        if (keep.length) mutateSet[f] = keep;
      }
    } else {
      // ---- coverage-driven path (unchanged): mutate only the COVERED lines. ----
      try { _sh(covCmd, wt); } catch (e) { console.error(`[mutation-bite] coverage command failed: ${e && e.message}`); }
      const final = _readJson(join(wt, covFile));
      if (!final) { _emit(decideMutationBite({ mutantResults: [] })); return; }
      const covByFile = coverageFromIstanbul(final, wt);
      if (emptyFixTargets.length) {
        for (const f of emptyFixTargets) {
          const cov = covByFile[f]; if (!cov) continue;
          const lines = [...new Set(cov.covered)].sort((a, b) => a - b);
          if (lines.length) mutateSet[f] = lines;
        }
      } else {
        for (const [f, lines] of Object.entries(changedSrc)) {
          const cov = covByFile[f]; if (!cov) continue;
          const coveredLines = new Set(cov.covered);
          const keep = lines.filter((ln) => coveredLines.has(ln));
          if (keep.length) mutateSet[f] = keep;
        }
      }
    }
    if (Object.keys(mutateSet).length === 0) { _emit(decideMutationBite({ mutantResults: [] })); return; }

    let assertionLiveness = null;
    try {
      const testFiles = Object.keys(parseDiff(diffText)).filter((f) => _isTest(f));
      if (testFiles.length) {
        let anyAssert = false, anyRead = false;
        for (const tf of testFiles) { try { const src = readFileSync(join(wt, tf), "utf8"); anyRead = true; if (_ASSERT_RX.test(src)) anyAssert = true; } catch {} }
        if (anyRead && !anyAssert) assertionLiveness = false;
      }
    } catch {}
    if (assertionLiveness === false) { _emit(decideMutationBite({ mutantResults: [], assertionLiveness: false })); return; }

    const records = []; let total = 0;
    outer:
    for (const [file, lines] of Object.entries(mutateSet)) {
      const abs = join(wt, file);
      let content; try { content = readFileSync(abs, "utf8").split("\n"); } catch { continue; }
      let perFileCount = 0;
      for (const ln of lines) {
        if (total >= maxMut) break outer;
        if (perFileCount >= perFile) break;
        const idx0 = ln - 1; if (idx0 < 0 || idx0 >= content.length) continue;
        const muts = mutantsForLine(content[idx0]); if (muts.length === 0) continue;
        const mut = muts[0];
        const original = content[idx0];
        try {
          content[idx0] = mut.mutated;
          writeFileSync(abs, content.join("\n"));
          const res = _run(testCmd, wt, perMutTimeout);
          const cls = classifyOutcome(res.code, res.text, assertRe ? { assertRe } : {});
          records.push(_recordFromOutcome(cls, ln, mut.op));
        } finally {
          content[idx0] = original;
          try { writeFileSync(abs, content.join("\n")); } catch (e) { console.error(`[mutation-bite] restore failed in worktree for ${abs}: ${e && e.message}`); }
        }
        total++; perFileCount++;
      }
    }

    _emit(decideMutationBite({ mutantResults: records, assertionLiveness }));
  } catch (e) {
    console.error(`[mutation-bite] worktree/mutation failed: ${e && e.message}`);
    cleanup();
    process.exit(2);
  } finally {
    cleanup();
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) mbMain(process.argv);
