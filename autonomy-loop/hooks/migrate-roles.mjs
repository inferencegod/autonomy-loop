// autonomy-loop: migrate-roles. Pure core for the Release A config migration (Spec A-migration).
// Moves the v0.6 boolean roles flags (source of truth) to the à la carte override/pin model
// ("auto"|"off"|"required"), and tops up the lease + safety blocks. Idempotent: never overwrites
// a value already in the new shape, never resets the baton. Mirrors the existing migrate-config
// convention (top up missing keys only). No I/O, no deps.

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
