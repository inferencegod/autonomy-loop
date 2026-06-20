// autonomy-loop: migrate-roles. Pure core for the Release A config migration (Spec A-migration).
// Moves the v0.6 boolean roles flags (source of truth) to the à la carte override/pin model
// ("auto"|"off"|"required"), and tops up the lease + safety blocks. Idempotent: never overwrites
// a value already in the new shape, never resets the baton. Mirrors the existing migrate-config
// convention (top up missing keys only). The PURE core below has no I/O; a thin RUNNER at the bottom does the
// fs read/write so /autonomy-upgrade can call this as a TRUSTED HOOK (`node hooks/migrate-roles.mjs`). That path
// is gate-allowed; an inline `node -e "...autonomy.config.json..."` write is blocked by the v0.8 read-only
// control plane (Ring 1), which is why the inline upgrade step used to fail.
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const NEW_ROLE_DEFAULTS = { builder: "auto", reviewer: "required", planner: "auto", researcher: "auto" };
const LEASE_DEFAULTS = { ttlSeconds: 90, renewEverySeconds: 30 };
const SAFETY_DEFAULTS = { reducedTrustOptIn: false };
// Rigor gates default ON (best-output philosophy). Speed/cost is a terminal opt-OUT.
const RIGOR_DEFAULTS = { selfMutate: true, acceptanceStrength: true, weakAssertion: true, checkedCoverage: true };
const VALID_MODES = new Set(["auto", "off", "required"]);

// migrateRoles(cfg) -> { cfg, added } ; pure, returns a NEW object, does not mutate input.
export function migrateRoles(input) {
  const cfg = input && typeof input === "object" ? JSON.parse(JSON.stringify(input)) : {};
  const added = [];

  // 1) Normalize the roles block.
  const legacy = cfg.roles && typeof cfg.roles === "object" ? cfg.roles : {};
  const roles = {};

  // Map legacy booleans: true -> "auto" (detected when launched), false -> "off" (preserve a
  // deliberate disable). Already-string values in the new shape are preserved as-is.
  for (const key of ["planner", "researcher"]) {
    // accept the historical "research" key as an alias for researcher
    const legacyVal = key === "researcher" ? (legacy.researcher ?? legacy.research) : legacy[key];
    if (typeof legacyVal === "string" && VALID_MODES.has(legacyVal)) {
      roles[key] = legacyVal; // already migrated, keep
    } else if (legacyVal === true) {
      roles[key] = "auto"; added.push(`roles.${key}:auto(from true)`);
    } else if (legacyVal === false) {
      roles[key] = "off"; added.push(`roles.${key}:off(from false)`);
    } else {
      roles[key] = NEW_ROLE_DEFAULTS[key]; added.push(`roles.${key}:${NEW_ROLE_DEFAULTS[key]}(default)`);
    }
  }

  // builder + reviewer get the mandatory-core defaults if not already a valid mode.
  for (const key of ["builder", "reviewer"]) {
    const v = legacy[key];
    if (typeof v === "string" && VALID_MODES.has(v)) roles[key] = v;
    else { roles[key] = NEW_ROLE_DEFAULTS[key]; added.push(`roles.${key}:${NEW_ROLE_DEFAULTS[key]}(default)`); }
  }

  cfg.roles = roles;

  // 2) lease block (top up missing subkeys only).
  if (!cfg.lease || typeof cfg.lease !== "object") { cfg.lease = { ...LEASE_DEFAULTS }; added.push("lease"); }
  else for (const [k, v] of Object.entries(LEASE_DEFAULTS)) if (cfg.lease[k] === undefined) { cfg.lease[k] = v; added.push(`lease.${k}`); }

  // 3) safety block (top up missing subkeys only).
  if (!cfg.safety || typeof cfg.safety !== "object") { cfg.safety = { ...SAFETY_DEFAULTS }; added.push("safety"); }
  else for (const [k, v] of Object.entries(SAFETY_DEFAULTS)) if (cfg.safety[k] === undefined) { cfg.safety[k] = v; added.push(`safety.${k}`); }

  // rigor gates: default ON (top up missing subkeys only; never overwrite a set value)
  if (!cfg.gate || typeof cfg.gate !== 'object') { cfg.gate = { ...RIGOR_DEFAULTS }; added.push('gate'); }
  else for (const [k, v] of Object.entries(RIGOR_DEFAULTS)) if (cfg.gate[k] === undefined) { cfg.gate[k] = v; added.push(`gate.${k}`); }
  return { cfg, added };
}

// isMigrated(cfg): true if the config is already in the new shape (idempotency check).
export function isMigrated(cfg) {
  if (!cfg || typeof cfg.roles !== "object") return false;
  const r = cfg.roles;
  const rolesOk = ["builder", "reviewer", "planner", "researcher"].every((k) => typeof r[k] === "string" && VALID_MODES.has(r[k]));
  const leaseOk = cfg.lease && typeof cfg.lease.ttlSeconds === "number";
  const safetyOk = cfg.safety && typeof cfg.safety.reducedTrustOptIn === "boolean";
  return !!(rolesOk && leaseOk && safetyOk);
}

export const _internal = { NEW_ROLE_DEFAULTS, LEASE_DEFAULTS, SAFETY_DEFAULTS, VALID_MODES };

// The v0.7.0 config blocks /autonomy-upgrade tops up after the roles migration, at the same
// behavior-preserving defaults the example config ships (so an upgraded config matches a fresh install).
const V07_DEFAULTS = {
  coordination: { mode: "multi-process" },
  subagent: { reviewerIsolated: true },
  convergence: { maxAttemptsPerTask: 5, oscillationK: 2 },
  scope: { maxFiles: 0, maxLines: 0, maxNewPublicSymbols: 0 },
  speed: { optOut: false, scope: "additive-only" },
};
// PURE: top up the v0.7.0 blocks + the rigor gate routers, ONLY when missing (never overwrite a set value).
export function topUpV07(cfg, added = []) {
  for (const [block, def] of Object.entries(V07_DEFAULTS)) {
    if (cfg[block] === undefined || typeof cfg[block] !== "object") { cfg[block] = { ...def }; added.push(block); }
    else for (const [k, v] of Object.entries(def)) if (cfg[block][k] === undefined) { cfg[block][k] = v; added.push(`${block}.${k}`); }
  }
  if (!cfg.gate || typeof cfg.gate !== "object") cfg.gate = {};
  // rigor ON, matching the example config: the verify-gate router GOVERNS (fail-closed; can only block, never
  // silently pass). Flip to "off" for pre-0.7 golden-revert-only behavior, or "shadow" to watch it first.
  if (cfg.gate.verifyGate === undefined) { cfg.gate.verifyGate = "govern"; added.push("gate.verifyGate"); }
  if (cfg.gate.requireProdProtection === undefined) { cfg.gate.requireProdProtection = true; added.push("gate.requireProdProtection"); }
  return added;
}

// ---- thin runner (impure: reads/writes autonomy.config.json) ----
// /autonomy-upgrade runs THIS as a trusted hook instead of an inline `node -e`, so the write to the locked
// control plane is gate-allowed (the command string carries no protected path). Idempotent; never resets the baton.
//   node hooks/migrate-roles.mjs [--config=<path>] [--repoRoot=<path>]
function migrateRolesMain(argv) {
  const args = Object.fromEntries(argv.slice(2).map((a) => { const m = a.match(/^--([^=]+)=(.*)$/); return m ? [m[1], m[2]] : [a.replace(/^--/, ""), true]; }));
  let base = typeof args.repoRoot === "string" ? args.repoRoot : "";
  if (!base) { try { base = execSync("git rev-parse --show-toplevel", { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim(); } catch { base = process.cwd(); } }
  const p = typeof args.config === "string" ? args.config : join(base, "autonomy.config.json");
  let cfg;
  try { cfg = JSON.parse(readFileSync(p, "utf8")); }
  catch (e) { console.error(`[migrate-roles] cannot read/parse ${p}: ${e && e.message}. Fix the JSON first; nothing was changed.`); process.exit(2); }
  let added = [];
  if (!isMigrated(cfg)) { const r = migrateRoles(cfg); cfg = r.cfg; added = r.added; }
  topUpV07(cfg, added);
  if (added.length === 0) { console.log("[migrate-roles] config already current; nothing changed."); return; }
  writeFileSync(p, JSON.stringify(cfg, null, 2) + "\n");
  console.log("[migrate-roles] added: " + added.join(", "));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) migrateRolesMain(process.argv);
