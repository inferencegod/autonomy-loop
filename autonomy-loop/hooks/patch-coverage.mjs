#!/usr/bin/env node
// autonomy-loop: patch-coverage (a FOURTH gate). parseDiff + coverageFromIstanbul + decidePatch (pure),
// thin runner. Reads the Istanbul coverage-final.json c8/nyc emit. No external deps. No em dashes.
import { readFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const NUM = (v, d) => { const n = Number(v); return Number.isFinite(n) ? n : d; };
const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));

// PURE: parse `git diff --unified=0` into the added/changed line numbers per file (new-file numbering).
export function parseDiff(diffText) {
  const byFile = {};
  let cur = null, newLine = 0, prevMinusHeader = false;
  for (const raw of String(diffText || "").split("\n")) {
    if (raw.startsWith("+++ ") && prevMinusHeader) {
      const p = raw.slice(4).trim().replace(/\t.*$/, "");
      cur = (p === "/dev/null") ? null : p.replace(/^b\//, "");
      if (cur && !byFile[cur]) byFile[cur] = [];
      prevMinusHeader = false;
      continue;
    }
    if (raw.startsWith("--- ")) { prevMinusHeader = true; continue; }
    prevMinusHeader = false;
    const h = raw.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
    if (h) { newLine = parseInt(h[1], 10); continue; }
    if (cur === null) continue;
    if (raw.startsWith("+")) { byFile[cur].push(newLine); newLine++; }
    else if (raw.startsWith("-")) { /* old-file line */ }
    else if (raw.startsWith(" ")) { newLine++; }
  }
  return byFile;
}

// PURE: derive { coverable, covered } line sets per file from an Istanbul coverage-final.json object.
export function coverageFromIstanbul(final, cwd) {
  const out = {};
  for (const [abs, data] of Object.entries(final || {})) {
    const rel = relative(cwd || process.cwd(), abs).split(sep).join("/");
    const coverable = new Set(), covered = new Set();
    const sm = (data && data.statementMap) || {};
    const s = (data && data.s) || {};
    for (const [id, loc] of Object.entries(sm)) {
      const line = loc && loc.start && loc.start.line;
      if (!Number.isFinite(line)) continue;
      coverable.add(line);
      if ((s[id] || 0) > 0) covered.add(line);
    }
    out[rel] = { coverable: [...coverable], covered: [...covered] };
  }
  return out;
}

// PURE decision core.
export function decidePatch(changedByFile = {}, coverageByFile = {}, opts = {}) {
  const threshold = clamp(NUM(opts.threshold, 80), 0, 100);
  let total = 0, covered = 0;
  const uncovered = [];
  for (const [file, lines] of Object.entries(changedByFile)) {
    const cov = coverageByFile[file];
    if (!cov) continue;
    const coverable = new Set(cov.coverable);
    const cset = new Set(cov.covered);
    for (const ln of lines) {
      if (!coverable.has(ln)) continue;
      total++;
      if (cset.has(ln)) covered++;
      else uncovered.push(file + ":" + ln);
    }
  }
  if (total === 0) return { ok: true, action: "no-op", patchPct: 100, threshold, total: 0, covered: 0, uncovered: [], reason: "no executable changed lines this wave" };
  const patchPct = Math.round((covered / total) * 1000) / 10;
  if (patchPct < threshold) {
    const shown = uncovered.slice(0, 8).join(", ");
    return { ok: false, action: "under-covered", patchPct, threshold, total, covered, uncovered, reason: `patch coverage ${patchPct}% is below the ${threshold}% bar. ${uncovered.length} changed line(s) untested: ${shown}` };
  }
  return { ok: true, action: "pass", patchPct, threshold, total, covered, uncovered, reason: `patch coverage ${patchPct}% meets the ${threshold}% bar (${covered}/${total} changed lines covered)` };
}

// ---- thin runner ----
function readJson(p) { try { return JSON.parse(readFileSync(p, "utf8")); } catch { return null; } }
function main(argv) {
  const args = Object.fromEntries(argv.slice(2).map((a) => { const m = a.match(/^--([^=]+)=(.*)$/); return m ? [m[1], m[2]] : [a.replace(/^--/, ""), true]; }));
  const covPath = args.coverage || "coverage/coverage-final.json";
  const threshold = NUM(args.threshold, 80);
  const base = args.base;
  if (base && !/^[0-9A-Za-z_./^~-]+$/.test(String(base))) { console.error(`[patch-coverage] refusing a --base with unexpected characters: ${base}`); process.exit(2); }
  const final = readJson(covPath);
  if (!final) { console.error(`[patch-coverage] no detailed coverage at ${covPath}.`); process.exit(2); }
  let diffText = "";
  try { diffText = execSync(base ? `git diff --unified=0 ${base}` : "git diff --unified=0 HEAD", { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }); }
  catch (e) { console.error(`[patch-coverage] could not run git diff: ${e && e.message}`); process.exit(2); }
  const changed = parseDiff(diffText);
  const coverage = coverageFromIstanbul(final, process.cwd());
  const r = decidePatch(changed, coverage, { threshold });
  console.log(`[patch-coverage] ${r.action.toUpperCase()}: ${r.reason}`);
  process.exit(r.ok ? 0 : 1);
}
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main(process.argv);
