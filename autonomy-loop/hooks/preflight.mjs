// hooks/preflight.mjs - pure core decidePreflight (v0.8 "provision or refuse"). Computes the ACTUAL
// assurance tier of the setup from measured probes and REFUSES the unattended / auto-promote path when
// the assurance is absent, instead of warning and continuing. The forge rail (server-side required
// review + no-bypass prod protection) is the only unattended-grade independence; local mechanisms only
// raise the bar. No I/O, no deps, fail-closed: only an explicit safe value counts, anything missing or
// ambiguous denies. The impure SessionStart runner gathers the probes and acts on the decision.
export const REFUSALS = {
  controlPlaneWritable: "REFUSING: the gate's own config/hooks/leases are writable by the agent, so a bypassed gate can disable itself. Fix: run /autonomy-harden to lock them read-only under a non-agent owner, or pass --i-accept-reduced-assurance for an attended local run (auto-promotion stays off).",
  prodUnprotected: "REFUSING auto-promotion: the prod branch has no no-bypass push protection, so the agent credential can reach it directly. Fix: run /autonomy-init to provision the ruleset, or set gate.requireProdProtection=false to accept the risk on an attended run.",
  reviewerNotSeparated: "REFUSING unattended promotion: the reviewer shares the builder's principal (same uid), so its independence cannot be verified locally. Fix: run the reviewer as a separate OS user or container, or rely on server-side required PR review (the forge tier).",
  reviewerNotLive: "BLOCKING promotion: no reviewer process is alive (the lease is a stale file). Fix: start the reviewer terminal, or set turn: human.",
  sandboxNotLive: "REFUSING unattended run: the agent is not in a live sandbox, so writes outside the workspace are not OS-contained. Fix: launch via launch-sandboxed (srt) or the devcontainer, or pass --i-accept-reduced-assurance for an attended run.",
};

// decidePreflight(probe, cfg) -> { tier, allowStart, allowUnattended, refusals:[key], banner }
//   probe.controlPlaneWritable : did a write-probe of any protected path succeed as the agent uid?
//   probe.prodProtected        : does prodBranch have a no-bypass push ruleset the agent token cannot bypass?
//   probe.sandboxLive          : is the agent running in a live sandbox (writes OS-contained)?
//   probe.reviewer             : { live:boolean, separated:boolean } from verifyRoster
//   cfg.requireProdProtection  : default true   cfg.acceptReducedAssurance : attended-only escape hatch
export function decidePreflight(probe = {}, cfg = {}) {
  const cpWritable = probe.controlPlaneWritable === true;
  const prodProtected = probe.prodProtected === true;
  const sandboxLive = probe.sandboxLive === true;
  const rv = probe.reviewer && typeof probe.reviewer === "object" ? probe.reviewer : {};
  const rvLive = rv.live === true;
  const rvSeparated = rv.separated === true;
  const requireProd = cfg.requireProdProtection !== false; // default true
  const escape = cfg.acceptReducedAssurance === true;       // attended-only escape hatch

  const refusals = [];
  if (cpWritable) refusals.push("controlPlaneWritable");
  if (requireProd && !prodProtected) refusals.push("prodUnprotected");
  if (!rvLive) refusals.push("reviewerNotLive");
  if (!rvSeparated && !prodProtected) refusals.push("reviewerNotSeparated"); // local separation only matters when the forge is not providing independence
  if (!sandboxLive) refusals.push("sandboxNotLive");

  let tier = "T0-ATTESTED";
  if (!cpWritable && rvLive) {
    if (prodProtected && sandboxLive) tier = "T3-HARDENED";
    else if (rvSeparated) tier = "T2-SEPARATED";
    else tier = "T1-LIVENESS";
  }

  // A writable control plane means the gate can disable itself: refuse to START unless the user explicitly
  // accepts reduced assurance for an attended run. The escape hatch NEVER enables the unattended path.
  const allowStart = !cpWritable || escape;
  const allowUnattended = !cpWritable && prodProtected && rvLive && sandboxLive; // hardened tier only
  const banner = `[autonomy-loop] trust tier: ${tier}. auto-promotion ${allowUnattended ? "ALLOWED" : "REFUSED" + (refusals.length ? " (" + refusals.join(", ") + ")" : "")}.`;
  return { tier, allowStart, allowUnattended, refusals, banner };
}
