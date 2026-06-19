#!/usr/bin/env node
// autonomy-loop: promotion-guard (Spec A3, Build-brief Task 4).
// THE SAFETY FLOOR FOR A LA CARTE. This is the layer that makes the role market safe to advertise:
// no matter how the operator slices the roster, a commit cannot be PROMOTED (merged, or pushed to the
// prod branch) unless a live INDEPENDENT reviewer is present to re-verify it. A lone builder grading
// its own work has no adversarial independence; that property cannot be mechanized inside the builder,
// so the floor is enforced here, fail-closed, EVEN in reduced-trust mode.
//
// House convention: a PURE decidePromotionGuard(input) you unit-test, plus a tiny PreToolUse runner.
// This module COMPOSES three already-built + tested pure cores and duplicates none of them:
//   - decide.mjs                (existing gate-guard: prod-branch push, force-push, history rewrite,
//                                 protected-path writes). Reused verbatim so the universal git
//                                 barriers still fire and the denylist is never re-implemented here.
//   - safety-floor.mjs          (evaluate -> trust FULL/REDUCED/REFUSED from roster + config).
//   - gate-guard-promotion.mjs  (isPromotionCommand + decideGuard: the promotion predicate + the
//                                 safety-floor promotion block, exit 2 on block).
// No I/O in the decision core. No external deps. Fail-closed. (Spec A3.)

import { decide } from "./decide.mjs";
import { evaluate } from "./safety-floor.mjs";
import { decideGuard, isPromotionCommand } from "./gate-guard-promotion.mjs";

// Exit-code convention (matches gate-guard-promotion + the project bite/gate fail-closed contract):
//   0 = allow / start.   2 = block / refuse, with a reason fed back to the agent.
const EXIT_ALLOW = 0;
const EXIT_BLOCK = 2;

const allow = (reason) => ({ action: "allow", block: false, exitCode: EXIT_ALLOW, reason });
const start = (reason) => ({ action: "start", block: false, exitCode: EXIT_ALLOW, reason });
const block = (reason) => ({ action: "deny", block: true, exitCode: EXIT_BLOCK, reason });
const refuse = (reason) => ({ action: "refuse", block: true, exitCode: EXIT_BLOCK, reason });

// decidePromotionGuard: the single pure entry point. Fail-closed on any malformed input.
//   input.phase:   "startup" (gate the loop booting) or "pretooluse" (gate one candidate command).
//   input.command: the shell command the agent is about to run (pretooluse phase).
//   input.roster:  array of live role ids, shape from presence.roster() (e.g. ["builder","reviewer"]).
//   input.config:  autonomy.config.json contents ({ roles, safety, prodBranch, protectedPaths, ... }).
// Returns { action, block, exitCode, reason }.
export function decidePromotionGuard(input) {
  const inp = input && typeof input === "object" ? input : null;
  if (!inp) return refuse("no-input");

  const cfg = inp.config && typeof inp.config === "object" ? inp.config : null;
  if (!cfg) return refuse("no-config");

  const roster = Array.isArray(inp.roster) ? inp.roster : null;
  if (roster === null) return refuse("uncomputable-roster");

  const phase = inp.phase === "startup" ? "startup" : "pretooluse";

  // ---- STARTUP GATE -------------------------------------------------------------------------
  // Refuse to boot when the safety floor itself refuses. This is where reviewer:"required" + a
  // lone-builder roster is caught: safety-floor returns refuse "required-role-absent:reviewer".
  // A "reduced" verdict is allowed to start (it runs labelled); promotion is still blocked below.
  if (phase === "startup") {
    const decision = evaluate(roster, cfg);
    if (decision.refuse) return refuse(`startup refused: ${decision.reason}`);
    return start(`startup ok: trust=${decision.trust}`);
  }

  // ---- PRETOOLUSE GATE (one candidate command) ----------------------------------------------
  const cmd = typeof inp.command === "string" ? inp.command : "";

  // Gate 1: the EXISTING universal gate-guard core, reused verbatim, so prod-branch push, force-push,
  // history rewrite and protected-path writes still deny exactly as before. We do not duplicate it.
  let baseDecision;
  try {
    baseDecision = decide("Bash", { command: cmd }, cfg);
  } catch {
    return block("gate-guard core threw (fail-closed)");
  }
  if (baseDecision && baseDecision.action === "deny") {
    return block(`gate-guard: ${baseDecision.reason}`);
  }

  // Gate 2: the safety-floor promotion block. For a promotion command (git merge, git push to prod,
  // gh pr merge, push --tags), require FULL trust = a live independent reviewer. This fires EVEN in
  // reduced-trust mode, which is the whole point of the floor.
  let guard;
  try {
    guard = decideGuard(cmd, roster, cfg);
  } catch {
    // Fail-closed: if the floor cannot be computed but this looks like a promotion, block it.
    return isPromotionCommand(cmd)
      ? block("safety-floor core threw on a promotion command (fail-closed)")
      : allow("safety-floor core threw on a non-promotion command");
  }
  if (guard.block) return block(`safety-floor ${guard.reason}`);

  // Neither gate objected.
  return isPromotionCommand(cmd)
    ? allow("promotion allowed: full trust (independent reviewer live)")
    : allow("not a promotion");
}

// ============================================================================================
// Thin PreToolUse runner. All I/O lives here; the decision above stays pure.
// Reads the hook event on stdin, loads autonomy.config.json + the live roster from presence leases,
// calls decidePromotionGuard, and on a block writes the reason to stderr and exits 2 (fail-closed:
// an unreadable config or roster degrades to a refuse). Importing this module does NOT run main().
// ============================================================================================
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);

// readLeases: best-effort read of presence/<role>.lease.json. Fail-closed to [] (an empty roster has
// no reviewer, so the floor blocks promotion). Synchronous, used only by the runner.
function readLeases(cwd) {
  try {
    const fs = require("node:fs");
    const path = require("node:path");
    const dir = path.join(cwd, "presence");
    let names;
    try { names = fs.readdirSync(dir); } catch { return []; }
    const leases = [];
    for (const n of names) {
      if (!n.endsWith(".lease.json")) continue;
      try { leases.push(JSON.parse(fs.readFileSync(path.join(dir, n), "utf8"))); } catch { /* skip */ }
    }
    return leases;
  } catch {
    return [];
  }
}

async function main() {
  const fs = require("node:fs");
  const path = require("node:path");
  const { roster: presenceRoster } = await import("./presence.mjs");

  let evt = {};
  try { evt = JSON.parse(fs.readFileSync(0, "utf8") || "{}"); } catch { process.exit(EXIT_ALLOW); }

  // Only Bash tool calls can be promotions; other tools are out of scope for this guard.
  const tool = evt.tool_name || evt.toolName || "";
  if (tool !== "Bash") process.exit(EXIT_ALLOW);
  const command = (evt.tool_input || evt.toolInput || {}).command || "";

  const cwd = process.cwd();

  let config = null;
  try { config = JSON.parse(fs.readFileSync(path.join(cwd, "autonomy.config.json"), "utf8")); }
  catch { config = null; } // null config -> decidePromotionGuard refuses (fail-closed)

  let live = [];
  try { live = presenceRoster(readLeases(cwd), new Date().toISOString()); } catch { live = []; }

  const result = decidePromotionGuard({ phase: "pretooluse", command, roster: live, config });

  if (result.block) {
    process.stderr.write(
      "GATE: " + result.reason +
      " - a promotion needs a live independent reviewer. Escalate: write FOR-REVIEW.md and set turn: human. [autonomy-loop]\n"
    );
    process.exit(EXIT_BLOCK);
  }
  process.exit(EXIT_ALLOW);
}

// Run main() only when executed directly (node hooks/promotion-guard.mjs), never on import.
const __invokedPath = (process.argv[1] || "").replace(/\\/g, "/");
const __thisPath = decodeURIComponent(new URL(import.meta.url).pathname).replace(/^\/([A-Za-z]:)/, "$1");
if (__invokedPath && (__thisPath.endsWith(__invokedPath) || __invokedPath.endsWith(__thisPath))) {
  main().catch((e) => { process.stderr.write("[promotion-guard] " + (e && e.message) + "\n"); process.exit(EXIT_BLOCK); });
}

export const _internal = { EXIT_ALLOW, EXIT_BLOCK, readLeases };
