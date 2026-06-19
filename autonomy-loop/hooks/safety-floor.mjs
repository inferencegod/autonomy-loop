// autonomy-loop: safety-floor. Pure decision core enforcing the irreducible safety invariant:
//   Every commit treated as shippable MUST pass independent re-verification by a process that
//   did not produce it.
// A lone builder grading its own work loses adversarial independence (self-preference bias;
// unaided self-correction is net-negative). That property cannot be mechanized INSIDE the builder;
// it requires a separate verifier role. This module decides FULL / REDUCED / REFUSED from the live
// roster + config, fail-closed. No I/O, no deps. (Spec A3.)

import { composePipeline } from "./role-registry.mjs";

// evaluate: the trust decision.
//   roster: array of live role ids (from presence.roster()).
//   config: { roles: {<role>: "auto"|"off"|"required"}, safety: { reducedTrustOptIn: bool }, seed?: bool }
// Returns { trust, allowPromotion, mustLabel, refuse, reason }.
// FAIL-CLOSED: any uncomputable/contradictory input -> refuse.
export function evaluate(roster, config) {
  const cfg = config && typeof config === "object" ? config : null;
  if (!cfg) return refuse("no-config");

  const rolesCfg = cfg.roles && typeof cfg.roles === "object" ? cfg.roles : {};
  const reducedOptIn = !!(cfg.safety && cfg.safety.reducedTrustOptIn === true);
  const live = Array.isArray(roster) ? [...new Set(roster)] : null;
  if (live === null) return refuse("uncomputable-roster");

  // 1) Enforce "required" pins: any role marked required MUST be live.
  for (const [role, mode] of Object.entries(rolesCfg)) {
    if (mode === "required" && !live.includes(role)) {
      return refuse(`required-role-absent:${role}`);
    }
  }

  // 2) Enforce "off" vetoes: a vetoed role must NOT be live (operator said no).
  for (const [role, mode] of Object.entries(rolesCfg)) {
    if (mode === "off" && live.includes(role)) {
      return refuse(`vetoed-role-present:${role}`);
    }
  }

  // 3) Compose the pipeline and check validity (no starved consumers).
  let pipe;
  try {
    pipe = composePipeline(live, { seed: !!cfg.seed });
  } catch {
    return refuse("compose-threw");
  }
  if (!pipe.valid) return refuse(pipe.reason);

  // 4) The core invariant: is there a live INDEPENDENT verifier re-checking another role's output?
  const hasVerifier = pipe.hasIndependentVerifier;

  if (hasVerifier) {
    return { trust: "full", allowPromotion: true, mustLabel: false, refuse: false, reason: "independent-verifier-present" };
  }

  // No independent verifier. Allowed ONLY behind an explicit opt-in, and then promotion is blocked.
  if (reducedOptIn) {
    return { trust: "reduced", allowPromotion: false, mustLabel: true, refuse: false, reason: "no-verifier-reduced-trust-optin" };
  }

  // No verifier and no opt-in -> refuse (fail-closed). This is the lone-builder default.
  return refuse("no-independent-verifier");
}

function refuse(reason) {
  return { trust: "refused", allowPromotion: false, mustLabel: false, refuse: true, reason };
}

// promotionBlockedReason: a convenience for the gate-guard integration. Returns a string if
// promotion must be hard-blocked in the current trust state, else null.
export function promotionBlockedReason(decision) {
  if (!decision || decision.allowPromotion === true) return null;
  if (decision.refuse) return `promotion blocked: ${decision.reason}`;
  if (decision.trust === "reduced") return "promotion blocked: reduced-trust (no independent verification)";
  return "promotion blocked";
}
