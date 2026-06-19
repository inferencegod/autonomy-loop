#!/usr/bin/env node
// autonomy-loop: migrate-config. The idempotent upgrade path for an EXISTING install. A new release adds
// config knobs (the breaker, gate.selfMutate) and LOOP-STATE fields (epoch, no-progress-epochs, last-tree-sha);
// without this, someone who updates the plugin gets the new commands but a config that silently lacks the new
// keys, and nothing tells them. This tops up ONLY the missing keys/fields with safe defaults: it never
// overwrites an existing value and never resets the baton (turn:). Safe to run any number of times.
//
// PURE CORES (no I/O, unit-tested): migrateConfig(cfg) and migrateLoopState(text). The runner reads the repo's
// autonomy.config.json and LOOP-STATE.md, applies both, writes back only what changed, and reports. No deps.
// No em dashes anywhere.

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";

// the current schema additions, with safe defaults. New release adds a knob? add it here, once.
const DEFAULT_BREAKER = { maxEpochs: 50, maxNoProgressEpochs: 3, maxBudgetUsd: 0, maxPlanEpochs: 40, maxPlanNoProgress: 3 };
const DEFAULT_ROLES = { research: false, planner: false }; // v0.6 plan lane, default off = byte-for-byte v0.5
const PLAN_MODELS = { researcher: "sonnet", planner: "opus" }; // v0.6 model knobs, only topped up if a models block exists
const REQUIRED_PROTECTED = ["autonomy.config.json", ".autonomy-coverage.json"];
const LOOP_FIELDS = [["epoch", "0"], ["no-progress-epochs", "0"], ["last-tree-sha", "<none>"]];

// PURE: top up a parsed config object. Returns { config, added: [labels] }. Never changes an existing value.
export function migrateConfig(input = {}) {
  const cfg = JSON.parse(JSON.stringify(input && typeof input === "object" ? input : {}));
  const added = [];
  // breaker: create the whole block if missing, else top up only the missing subkeys (incl. the v0.6 plan fields)
  if (cfg.breaker === undefined) { cfg.breaker = { ...DEFAULT_BREAKER }; added.push("breaker"); }
  else if (cfg.breaker && typeof cfg.breaker === "object") {
    for (const [k, v] of Object.entries(DEFAULT_BREAKER)) if (cfg.breaker[k] === undefined) { cfg.breaker[k] = v; added.push(`breaker.${k}`); }
  }
  if (cfg.gate && typeof cfg.gate === "object" && cfg.gate.selfMutate === undefined) {
    cfg.gate.selfMutate = false; added.push("gate.selfMutate");
  }
  // v0.8 provision-or-refuse: the preflight refuses auto-promotion unless prod has a no-bypass ruleset.
  // Default true is fail-closed (demand it); only an existing value (incl. a deliberate false) is preserved.
  if (cfg.gate && typeof cfg.gate === "object" && cfg.gate.requireProdProtection === undefined) {
    cfg.gate.requireProdProtection = true; added.push("gate.requireProdProtection");
  }
  // v0.6 plan lane: the roles block (default off), and the planner/researcher model knobs (only if models exists)
  if (cfg.roles === undefined) { cfg.roles = { ...DEFAULT_ROLES }; added.push("roles"); }
  else if (cfg.roles && typeof cfg.roles === "object") {
    for (const [k, v] of Object.entries(DEFAULT_ROLES)) if (cfg.roles[k] === undefined) { cfg.roles[k] = v; added.push(`roles.${k}`); }
  }
  if (cfg.models && typeof cfg.models === "object") {
    for (const [k, v] of Object.entries(PLAN_MODELS)) if (cfg.models[k] === undefined) { cfg.models[k] = v; added.push(`models.${k}`); }
  }
  const pp = Array.isArray(cfg.protectedPaths) ? cfg.protectedPaths.slice() : [];
  let ppChanged = false;
  for (const p of REQUIRED_PROTECTED) if (!pp.includes(p)) { pp.push(p); ppChanged = true; added.push(`protectedPaths += ${p}`); }
  if (ppChanged) cfg.protectedPaths = pp;
  return { config: cfg, added };
}

// PURE: add any missing LOOP-STATE fields as text lines, without touching existing lines (incl. turn:).
// Returns { text, added: [field] }. New fields go right after the `turn:` line if present, else at the top.
export function migrateLoopState(text = "") {
  const src = String(text || "");
  const lines = src.split("\n");
  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\-]/g, "\\$&");
  const has = (key) => lines.some((l) => new RegExp(`^\\s*${esc(key)}\\s*:`).test(l));
  const toAdd = LOOP_FIELDS.filter(([k]) => !has(k));
  if (toAdd.length === 0) return { text: src, added: [] };
  const newLines = toAdd.map(([k, v]) => `${k}: ${v}`);
  const idx = lines.findIndex((l) => /^\s*turn\s*:/.test(l));
  const out = idx >= 0
    ? [...lines.slice(0, idx + 1), ...newLines, ...lines.slice(idx + 1)]
    : [...newLines, ...lines];
  return { text: out.join("\n"), added: toAdd.map(([k]) => k) };
}

// ---- thin runner ----
function repoRoot() { try { return execSync("git rev-parse --show-toplevel", { encoding: "utf8" }).trim(); } catch { return process.cwd(); } }

function main(argv) {
  const args = Object.fromEntries(argv.slice(2).map((a) => { const m = a.match(/^--([^=]+)=(.*)$/); return m ? [m[1], m[2]] : [a.replace(/^--/, ""), true]; }));
  const base = repoRoot();
  const cfgPath = args.config || join(base, "autonomy.config.json");
  const statePath = args.state || join(base, "LOOP-STATE.md");
  const report = [];

  if (existsSync(cfgPath)) {
    let parsed;
    try { parsed = JSON.parse(readFileSync(cfgPath, "utf8")); }
    catch (e) { console.error(`[migrate] ${cfgPath} is not valid JSON; refusing to touch it. Fix it, then re-run. ${e && e.message}`); process.exit(2); }
    const { config, added } = migrateConfig(parsed);
    if (added.length) { writeFileSync(cfgPath, JSON.stringify(config, null, 2) + "\n"); report.push(`config: added ${added.join(", ")}`); }
    else report.push("config: already current");
  } else {
    report.push(`config: none at ${cfgPath} (run /autonomy-init to create one)`);
  }

  if (existsSync(statePath)) {
    const { text, added } = migrateLoopState(readFileSync(statePath, "utf8"));
    if (added.length) { writeFileSync(statePath, text); report.push(`LOOP-STATE: added ${added.join(", ")}`); }
    else report.push("LOOP-STATE: already current");
  } else {
    report.push(`LOOP-STATE: none at ${statePath} (run /autonomy-init to create one)`);
  }

  console.log("[migrate] " + report.join("  |  "));
  process.exit(0);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main(process.argv);
