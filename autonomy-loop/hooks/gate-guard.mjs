#!/usr/bin/env node
// autonomy-loop gate-guard (PreToolUse). DEFENSE-IN-DEPTH TRIPWIRE - not a sandbox.
// Emits the JSON deny protocol (exit 0 + permissionDecision) so the model gets a structured
// "denied + reason" it can escalate - instead of exit 2, which makes Claude go idle.
// LIMITATIONS: a regex can't stop every shell trick (novel tools, exotic git refs) and PreToolUse
// is not reliably enforced for subagent tool calls. Real backstops = remote branch protection +
// read-only file perms + a container. See README "Safety model & limitations".
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { decide } from "./decide.mjs";

let evt = {};
try { evt = JSON.parse(readFileSync(0, "utf8") || "{}"); } catch { process.exit(0); }
let cfg = {};
try { cfg = JSON.parse(readFileSync(join(process.cwd(), "autonomy.config.json"), "utf8")); }
catch { process.stderr.write("[gate-guard] WARNING: autonomy.config.json missing/unparseable - universal git guards only; protectedPaths NOT enforced.\n"); }

const r = decide(evt.tool_name || evt.toolName || "", evt.tool_input || evt.toolInput || {}, cfg);
if (r.action === "deny") {
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason: "GATE: " + r.reason + " - escalate: write FOR-REVIEW.md and set turn: human. [autonomy-loop]"
    }
  }));
}
process.exit(0);
