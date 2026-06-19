// autonomy-loop: gate-guard promotion-block (Spec A3 integration).
// This extends the EXISTING gate-guard PreToolUse hook with the safety-floor's verdict, so a
// reduced-trust or refused configuration cannot promote/merge out of the harness branch even if
// every mechanized gate is green. PURE decision core here; the existing gate-guard wraps it with
// the actual PreToolUse plumbing (reading the tool call, exit codes).
//
// The existing gate-guard already blocks: prod-branch push, force-push, history rewrite, and
// writes to protectedPaths. This ADDS: block promotion when the safety floor is not FULL.

import { evaluate, promotionBlockedReason } from "./safety-floor.mjs";

// Tool calls that constitute a "promotion" (leaving the harness branch / merging to prod).
// These are matched by the existing gate-guard's command inspection; we centralize the predicate.
const PROMOTION_PATTERNS = [
  /\bgit\s+push\b.*\b(origin\s+)?(main|master|prod|production|release)\b/i,
  /\bgit\s+merge\b/i,
  /\bgh\s+pr\s+merge\b/i,
  /\bgit\s+push\b.*--tags\b/i,
];

// isPromotionCommand: does this shell command attempt a promotion?
export function isPromotionCommand(cmd) {
  if (typeof cmd !== "string") return false;
  return PROMOTION_PATTERNS.some((re) => re.test(cmd));
}

// decideGuard: the combined decision for a candidate command.
//   cmd: the shell command the agent is about to run.
//   roster, config: current live roster + config (for the safety floor).
// Returns { block: bool, exitCode, reason }. exitCode 2 = block (matches the project's bite/gate
// fail-closed convention where exit 2 blocks and feeds the reason back to the agent).
export function decideGuard(cmd, roster, config) {
  // Only the safety-floor dimension here; the existing gate-guard handles prod-push/force/etc.
  if (!isPromotionCommand(cmd)) return { block: false, exitCode: 0, reason: "not-a-promotion" };

  const decision = evaluate(roster, config);
  const blockedReason = promotionBlockedReason(decision);
  if (blockedReason) {
    return { block: true, exitCode: 2, reason: blockedReason };
  }
  return { block: false, exitCode: 0, reason: "promotion-allowed-full-trust" };
}

export const _internal = { PROMOTION_PATTERNS };
