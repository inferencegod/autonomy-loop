// autonomy-loop: coordination-mode (single-CLI shape, doc 06). PURE CORE. No I/O, no deps, no clock,
// no randomness. Decides which coordination SHAPE the loop runs in and what trust tier to advertise.
//   multi-process : roles as separate OS processes, coordinating only through committed git state
//                   (LOOP-STATE.md baton). Full process independence. The default, unchanged.
//   single-cli    : roles as SUBAGENTS in one Claude Code session. REDUCED INDEPENDENCE: the reviewer
//                   subagent gets a fresh isolated context, a read-only toolset, and worktree isolation,
//                   so its VERIFICATION (the deterministic gate, re-run in the worktree) stays
//                   independent, but its JUDGMENT (the 5-lens LLM critique) shares a model + parent and
//                   is therefore ADVISORY, never binding.
// THE LICENSE FOR single-cli IS THE DETERMINISTIC GATE: a deterministic oracle returns the same verdict
// no matter who invokes it, so it survives the loss of process independence; an LLM opinion does not. So
// if the gate is enabled AND binds the verdict -> single-cli is defensible (critique advisory, labeled).
// If the gate is disabled or non-binding -> nothing independent remains -> REFUSE. Fail-closed: any
// malformed input, unknown mode, or non-true gate flag under single-cli returns { refuse:true }.
// decideCoordination(input) -> { mode, trustTier, advisoryCritique, refuse, reason, mustLabel }
export function decideCoordination(input) {
  const i = input && typeof input === "object" ? input : null;
  if (!i) return REFUSE("no-input");
  const coord = i.coordination && typeof i.coordination === "object" ? i.coordination : {};
  const gate = i.gate && typeof i.gate === "object" ? i.gate : {};
  const safety = i.safety && typeof i.safety === "object" ? i.safety : {};
  const sub = i.subagent && typeof i.subagent === "object" ? i.subagent : {};
  const modeRaw = coord.mode === undefined ? "multi-process" : coord.mode;
  if (modeRaw !== "multi-process" && modeRaw !== "single-cli") return REFUSE("unknown-coordination-mode:" + String(modeRaw));
  if (modeRaw === "multi-process")
    return { mode: "multi-process", trustTier: "full-independence", advisoryCritique: false, mustLabel: false, refuse: false, reason: "multi-process-default" };
  if (gate.deterministicEnabled !== true) return REFUSE("single-cli-requires-deterministic-gate");
  if (gate.bindsVerdict !== true) return REFUSE("single-cli-requires-gate-to-bind-verdict");
  if (safety.reducedTrustOptIn !== true) return REFUSE("single-cli-requires-reduced-trust-opt-in");
  if (sub.reviewerIsolated !== true) return REFUSE("single-cli-requires-isolated-reviewer-subagent");
  return { mode: "single-cli", trustTier: "reduced-independence", advisoryCritique: true, mustLabel: true, refuse: false, reason: "single-cli-gate-binds-critique-advisory" };
}
function REFUSE(reason) { return { mode: null, trustTier: null, advisoryCritique: false, mustLabel: true, refuse: true, reason }; }
