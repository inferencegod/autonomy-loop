#!/usr/bin/env node
// autonomy-loop: coverage-ratchet (the THIRD gate, the drift guard). Hardened after an adversarial
// red-team: a corrupt baseline can no longer silently re-seed at a lower floor, epsilon is clamped to
// a sane band, and a missing/garbage measurement is an honest error, not a fake 0 percent.
//
// WHY: the per-fix bite proves each NEW test catches its bug. This stops the REST of the tree from
// quietly losing coverage over hundreds of waves: total line coverage can never fall below a stored
// baseline, and the baseline only ratchets UP. Pairs with the bite; coverage measures execution, not
// assertions, so the ratchet is the drift layer, never a quality claim on its own.
//
// PURE CORE: decideRatchet() does no I/O and is unit-tested. The runner reads an Istanbul
// coverage-summary.json (c8 / nyc / jest emit it via json-summary) plus a baseline file, then exits
// 0 (pass) / 1 (regression) / 2 (cannot verify).

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

const EPS_MAX = 5; // a noise band wider than 5 percentage points is not noise, it is a hole
const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
const NUM = (v, d) => { const n = Number(v); return Number.isFinite(n) ? n : d; };
const PCT = (v) => {
  if (v === null || v === undefined || typeof v === "boolean" || typeof v === "object") return null;
  if (typeof v === "string" && v.trim() === "") return null;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 && n <= 100 ? n : null;
};

// PURE decision core. measured/baseline = { lines, branches }. No clock, no I/O, deterministic.
export function decideRatchet(measured = {}, baseline = null, opts = {}) {
  const epsilon = clamp(NUM(opts.epsilon ?? (baseline ? baseline.epsilon : undefined), 0.2), 0, EPS_MAX);
  const m = PCT(measured.lines);
  if (m === null) {
    return { ok: false, action: "error", reason: "no usable measured line coverage (did the coverage command run and emit coverage-summary.json?)" };
  }
  const mBranches = PCT(measured.branches);

  if (baseline === null || baseline === undefined) {
    return { ok: true, action: "seed", reason: `no baseline yet; seeding the floor at ${m}% lines / ${mBranches == null ? 0 : mBranches}% branches`, newBaseline: { lines: m, branches: mBranches == null ? 0 : mBranches, epsilon } };
  }
  const floor = PCT(baseline.lines);
  if (floor === null) {
    return { ok: false, action: "error", reason: "a baseline is present but its 'lines' value is invalid. Refusing to silently re-seed over it. Fix or delete .autonomy-coverage.json." };
  }
  // branch floor: tracked AND gated, symmetric with lines. Closes the gap where branch coverage
  // rots under a flat line number because branches were never in the lines denominator.
  const baseBr = PCT(baseline.branches);
  if (baseline.branches !== undefined && baseline.branches !== null && baseBr === null) {
    return { ok: false, action: "error", reason: "a baseline is present but its 'branches' value is invalid. Refusing to silently re-seed over it. Fix or delete .autonomy-coverage.json." };
  }
  const branchFloor = baseBr == null ? 0 : baseBr;
  // a real branch floor with no branch measurement this run cannot be verified (fail closed, like lines)
  if (branchFloor > 0 && mBranches === null) {
    return { ok: false, action: "error", reason: `branch coverage is missing this run but the baseline floor is ${branchFloor}% branches. Emit branch coverage (e.g. c8/nyc with branch reporting) so drift can be verified.` };
  }

  // regression on EITHER metric
  if (m < floor - epsilon) {
    return { ok: false, action: "regression", reason: `line coverage fell to ${m}% from the ${floor}% floor (epsilon ${epsilon}pp). Add a test for the new code, or justify and re-baseline with owner sign-off.` };
  }
  if (mBranches !== null && mBranches < branchFloor - epsilon) {
    return { ok: false, action: "regression", reason: `branch coverage fell to ${mBranches}% from the ${branchFloor}% floor (epsilon ${epsilon}pp). A path was added or changed without testing both sides. Add a test, or justify and re-baseline with owner sign-off.` };
  }

  // ratchet: raise whichever floor rose. Lines and branches move independently, and only UP.
  const lineRose = m > floor;
  const branchRose = mBranches !== null && mBranches > branchFloor;
  if (lineRose || branchRose) {
    const newLines = Math.max(floor, m);
    const newBranches = Math.max(branchFloor, mBranches == null ? branchFloor : mBranches);
    const parts = [];
    if (lineRose) parts.push(`lines ${floor}% to ${m}%`);
    if (branchRose) parts.push(`branches ${branchFloor}% to ${mBranches}%`);
    return { ok: true, action: "ratchet", reason: `coverage rose (${parts.join(", ")}); raising the floor so it can never slide back`, newBaseline: { lines: newLines, branches: newBranches, epsilon } };
  }
  // Honest HOLD message: a value WITHIN the epsilon band is below the floor but not a regression, so do
  // NOT claim "at or above" when it is actually a within-tolerance hold (the old message read 74.39% as
  // "at or above the 74.41% floor", which is self-contradictory). State exact numbers + which side.
  const rel = (val, fl) => (val >= fl ? `at/above the ${fl}% floor` : `within the ${epsilon}pp tolerance below the ${fl}% floor`);
  const brStr = mBranches == null ? "branches n/a" : `branches ${mBranches}% ${rel(mBranches, branchFloor)}`;
  return { ok: true, action: "hold", reason: `lines ${m}% ${rel(m, floor)}; ${brStr} (epsilon ${epsilon}pp; no regression, no ratchet)` };
}

// ---- thin runner (only when invoked directly) ----
function readJson(p) {
  try { return JSON.parse(readFileSync(p, "utf8")); } catch { return null; }
}
function extractTotals(summary) {
  const t = summary && summary.total;
  if (!t) return {};
  return { lines: t.lines && t.lines.pct, branches: t.branches && t.branches.pct };
}
function main(argv) {
  const args = Object.fromEntries(
    argv.slice(2).map((a) => {
      const m = a.match(/^--([^=]+)=(.*)$/);
      return m ? [m[1], m[2]] : [a.replace(/^--/, ""), true];
    })
  );
  const summaryPath = args.summary || "coverage/coverage-summary.json";
  const baselinePath = args.baseline || ".autonomy-coverage.json";

  const summary = readJson(summaryPath);
  if (!summary) {
    console.error(`[coverage-ratchet] no coverage summary at ${summaryPath}. Run coverage first, e.g.: c8 --reporter=json-summary <your test command>`);
    process.exit(2);
  }
  // a baseline FILE that exists but will not parse must NOT be silently re-seeded over
  if (existsSync(baselinePath) && readJson(baselinePath) === null) {
    console.error(`[coverage-ratchet] baseline file ${baselinePath} exists but is unreadable. Refusing to seed over it. Fix or delete it.`);
    process.exit(2);
  }
  const measured = extractTotals(summary);
  const baseline = readJson(baselinePath);
  const r = decideRatchet(measured, baseline, {});

  console.log(`[coverage-ratchet] ${r.action.toUpperCase()}: ${r.reason}`);
  if (r.newBaseline && !args["dry-run"]) {
    mkdirSync(dirname(baselinePath), { recursive: true });
    writeFileSync(baselinePath, JSON.stringify({ ...r.newBaseline, updatedAt: new Date().toISOString() }, null, 2) + "\n");
    console.log(`[coverage-ratchet] baseline written to ${baselinePath}`);
  }
  process.exit(r.ok ? 0 : 1);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main(process.argv);
