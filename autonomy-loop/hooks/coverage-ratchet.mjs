#!/usr/bin/env node
// autonomy-loop: coverage-ratchet (the THIRD gate, the drift guard).
//
// WHY: the builder writes a RED-before-green test for each new change, and the reviewer
// runs the per-fix "bite" (revert the change, confirm its test goes RED). That proves each
// NEW test catches its own bug. It says nothing about the rest of the tree slowly losing
// coverage over hundreds of waves. This gate closes that gap: total coverage can never fall
// below a stored baseline, and the baseline only ever ratchets UP. So coverage holes cannot
// quietly accumulate wave after wave.
//
// HONESTY: line coverage measures EXECUTION, not assertions. A suite with every assert
// deleted still scores 100%. So this ratchet is NEVER a quality claim on its own. It is the
// drift layer; the bite is the assertion layer. Ship them together or not at all.
//
// PURE CORE: decideRatchet() does no I/O and is unit-tested. The runner reads an Istanbul
// coverage-summary.json (c8, nyc, and jest all emit it via the json-summary reporter) plus a
// baseline file, then exits 0 (pass) or 1 (regression). On a genuine improvement it rewrites
// the baseline. Wire it as one more gate command alongside test, build, and lint.

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const PCT = (v) => {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 && n <= 100 ? n : null;
};
const NUM = (v, d) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
};

// PURE decision core. measured/baseline = { lines, branches }. No clock, no I/O, deterministic.
export function decideRatchet(measured = {}, baseline = null, opts = {}) {
  const epsilon = NUM(opts.epsilon ?? baseline?.epsilon, 0.2); // noise band, percentage points
  const m = PCT(measured.lines);
  if (m === null) {
    return { ok: false, action: "error", reason: "no measured line coverage (did the coverage command run?)" };
  }
  const mBranches = PCT(measured.branches);
  const floor = baseline == null ? null : PCT(baseline.lines);

  if (floor === null) {
    // first run: seed the floor, never block
    return {
      ok: true,
      action: "seed",
      reason: `no baseline yet; seeding the floor at ${m}% lines`,
      newBaseline: { lines: m, branches: mBranches ?? 0, epsilon },
    };
  }
  if (m < floor - epsilon) {
    return {
      ok: false,
      action: "regression",
      reason: `line coverage fell to ${m}% from the ${floor}% floor (epsilon ${epsilon}pp). Add a test for the new code, or justify and re-baseline with owner sign-off.`,
    };
  }
  if (m > floor) {
    const newBranches = Math.max(PCT(baseline.branches) ?? 0, mBranches ?? 0);
    return {
      ok: true,
      action: "ratchet",
      reason: `line coverage rose ${floor}% to ${m}%; raising the floor so it can never slide back`,
      newBaseline: { lines: m, branches: newBranches, epsilon },
    };
  }
  return { ok: true, action: "hold", reason: `line coverage ${m}% holds at or above the ${floor}% floor` };
}

// ---- thin runner (only when invoked directly) ----
function readJson(p) {
  try { return JSON.parse(readFileSync(p, "utf8")); } catch { return null; }
}

// Istanbul coverage-summary.json shape: { total: { lines: { pct }, branches: { pct } } }
function extractTotals(summary) {
  const t = summary?.total;
  if (!t) return {};
  return { lines: t.lines?.pct, branches: t.branches?.pct };
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
  const measured = extractTotals(summary);
  const baseline = readJson(baselinePath);
  const r = decideRatchet(measured, baseline, {});

  console.log(`[coverage-ratchet] ${r.action.toUpperCase()}: ${r.reason}`);
  if (r.newBaseline && !args["dry-run"]) {
    writeFileSync(baselinePath, JSON.stringify({ ...r.newBaseline, updatedAt: new Date().toISOString() }, null, 2) + "\n");
    console.log(`[coverage-ratchet] baseline written to ${baselinePath}`);
  }
  process.exit(r.ok ? 0 : 1);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main(process.argv);
