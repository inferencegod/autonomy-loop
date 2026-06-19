#!/usr/bin/env node
// hooks/gate-guard-runner.mjs - thin HEAD-resolving wrapper around the PURE decide() gate-guard.
// WHY: decide()'s prod-branch rule matches a LITERAL branch token (`git push origin main`). The form
// `git push origin HEAD` carries no literal branch, so on a checkout of prod it would slip past the
// literal rule even though it pushes prod. This runner closes that one gap: BEFORE calling decide() it
// detects a `git push` whose destination ref is HEAD / @ / a symbolic-abbreviated ref, resolves it to the
// concrete branch with git, substitutes the resolved branch into the command, and runs decide() on the
// resolved form too. If EITHER the original or the resolved form denies, we deny.
//
// SCOPE + HONEST LIMIT (defense-in-depth, NOT the barrier): we resolve ONLY HEAD-family symbolic refs we
// can deterministically map with `git rev-parse`. We deliberately do NOT expand shell variables: a branch
// name held in a variable (`B=main; git push origin $B`) is a shell-eval problem, not a git-ref problem,
// and trying to emulate the shell here would be both unreliable and a new attack surface. Such forms stay
// the server ruleset's job (no-bypass prod branch protection). This wrapper raises the bar on the common
// `git push origin HEAD` case; it does not claim completeness. See README "Safety model & limitations".
//
// FAIL-CLOSED: if the command IS a push whose destination ref needs resolution and resolution FAILS for
// any reason (not a repo, detached HEAD with no branch, git error, timeout), we DENY rather than guess.
// House convention: thin runner, pure core stays pure, no external deps, emits the same JSON deny protocol
// + exit 0 as gate-guard.mjs so the model gets a structured "denied + reason" it can escalate.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { decide } from "./decide.mjs";

// ---- pure helpers (exported for unit tests; no I/O) -------------------------------------------------

// A bare push-target ref token is "HEAD-family symbolic" when git would resolve it against the current
// checkout rather than name a branch literally. These are the forms decide()'s literal rule cannot see.
//   HEAD, @ (HEAD alias), HEAD~n / HEAD^ / @~n (still anchored on current branch), @{push}, @{upstream}/@{u}
// A normal branch name ("main", "agent-loop", "refs/heads/x") is NOT symbolic and is left untouched.
export function isSymbolicHeadRef(ref) {
  if (typeof ref !== "string") return false;
  const r = ref.trim().replace(/^['"]|['"]$/g, ""); // strip one layer of surrounding quotes
  if (r === "") return false;
  if (r === "HEAD" || r === "@") return true;
  if (/^HEAD([~^].*)?$/.test(r)) return true;     // HEAD, HEAD~2, HEAD^, HEAD^2
  if (/^@([~^].*)?$/.test(r)) return true;        // @, @~2, @^
  if (/^@\{(push|upstream|u)\}$/.test(r)) return true; // @{push} / @{upstream} / @{u}
  return false;
}

// Extract the DESTINATION ref of a `git push`. Returns { kind, destRef, srcDest, token } or null when the
// command is not a single resolvable push we should rewrite. We only act on the simple, unambiguous shape
// `git push [opts] [remote] <ref-or-refspec>` where the destination ref is symbolic. For a refspec
// `src:dst` the destination is dst; for a bare `<ref>` the destination is that ref (git pushes it to the
// same-named or tracking branch, and `HEAD` there means "current branch" = exactly the gap we cover).
// Conservative by design: anything we are unsure about returns null and falls through to plain decide().
export function parsePushDest(cmd) {
  const s = String(cmd || "");
  if (!/\bgit\b/.test(s) || !/\bpush\b/.test(s)) return null;
  // Refuse to reason about compound/obfuscated lines: a shell variable, command substitution, or chained
  // operators means the token we see may not be what the shell pushes. Fall through (decide() still runs).
  if (/[$`]/.test(s)) return null;                 // $VAR, ${VAR}, $(...), backticks: not our job, server's
  // Tokenize the FIRST git-push segment only (up to a shell separator) so we never read a later command.
  const seg = s.split(/&&|\|\||;|\||\n/)[0];
  const toks = seg.trim().split(/\s+/);
  const gi = toks.findIndex((t) => t === "git" || /\/git$/.test(t));
  if (gi < 0) return null;
  const pi = toks.indexOf("push", gi + 1);
  if (pi < 0) return null;
  // Walk positionals after `push`, skipping option flags and their inline values. Collect non-flag args.
  const positionals = [];
  for (let i = pi + 1; i < toks.length; i++) {
    const t = toks[i];
    if (t.startsWith("-")) continue;               // --force, -u, --set-upstream, --repo=...: skip (value inline or irrelevant to dest)
    positionals.push({ idx: i, val: t });
  }
  if (positionals.length === 0) return null;       // `git push` with no ref: nothing literal to rewrite
  // The destination ref is the LAST positional (remote precedes it when present). For a `src:dst` refspec,
  // the destination is the right side; for a bare ref it is the whole token.
  const last = positionals[positionals.length - 1];
  const token = last.val;
  const colon = token.indexOf(":");
  const destRef = colon >= 0 ? token.slice(colon + 1) : token;
  return { kind: colon >= 0 ? "refspec" : "bare", destRef, token, tokenIdx: last.idx, segToks: toks };
}

// Rebuild the command with the destination ref replaced by the resolved concrete branch. We replace only
// the destination side of the chosen token, leaving the rest of the line byte-for-byte, so decide() then
// sees a literal-branch push it can rule on. (Operates on the first segment's token; the remainder of a
// compound line is excluded by parsePushDest returning null on shell-metachar lines, so there is no tail.)
export function substituteDest(cmd, parsed, resolvedBranch) {
  if (!parsed || typeof resolvedBranch !== "string" || resolvedBranch === "") return cmd;
  const toks = parsed.segToks.slice();
  const oldTok = toks[parsed.tokenIdx];
  const colon = oldTok.indexOf(":");
  toks[parsed.tokenIdx] = colon >= 0 ? oldTok.slice(0, colon + 1) + resolvedBranch : resolvedBranch;
  return toks.join(" ");
}

// ---- impure resolution (git) -----------------------------------------------------------------------

// Resolve a symbolic destination ref to the concrete branch it names FROM THE CURRENT CHECKOUT.
//   @{push} / @{upstream} / @{u} -> the tracking branch's short name (strip the remote/ prefix)
//   HEAD / @ / HEAD~n / ...      -> the current branch's short name
// Returns a non-empty branch string, or throws (caller treats a throw as deny: fail-closed).
function resolveSymbolicRef(destRef, runGit) {
  const r = destRef.trim().replace(/^['"]|['"]$/g, "");
  if (/^@\{(push|upstream|u)\}$/.test(r)) {
    // symbolic-full-name of the tracking ref, e.g. refs/remotes/origin/main -> we want the branch "main".
    const full = runGit(["rev-parse", "--symbolic-full-name", r]).trim();
    if (!full) throw new Error("no tracking ref for " + r);
    // refs/remotes/<remote>/<branch...> -> <branch...>   (also tolerate refs/heads/<branch>)
    const m = full.match(/^refs\/remotes\/[^/]+\/(.+)$/) || full.match(/^refs\/heads\/(.+)$/);
    const branch = m ? m[1] : full;
    if (!branch) throw new Error("could not derive branch from " + full);
    return branch;
  }
  // HEAD-anchored forms: the concrete branch is whatever HEAD currently points at. A detached HEAD yields
  // "HEAD" from --abbrev-ref, which is NOT a branch -> throw -> deny (we cannot prove it is not prod).
  const abbrev = runGit(["rev-parse", "--abbrev-ref", "HEAD"]).trim();
  if (!abbrev || abbrev === "HEAD") throw new Error("detached HEAD or unresolved branch");
  return abbrev;
}

// Default git runner: execFileSync (no shell), cwd = repo, short timeout, throws on non-zero. Swappable
// in tests via the exported resolveForRunner so we never shell out from a unit test.
function gitRunner(cwd) {
  return (args) => execFileSync("git", args, { cwd, encoding: "utf8", timeout: 5000, stdio: ["ignore", "pipe", "pipe"] });
}

// Core decision used by both the CLI and tests. Given (tool, input, cfg, runGit), return decide()'s
// verdict, but with HEAD-family push destinations resolved + re-checked first. runGit is injected so the
// resolution path is testable without a real process; pass gitRunner(cwd) in production.
//   - not a Bash git-push-to-symbolic-ref -> decide() on the original command, unchanged.
//   - symbolic dest that resolves -> deny if EITHER original or resolved-substituted command denies.
//   - symbolic dest that FAILS to resolve -> deny (fail-closed).
export function decideWithHeadResolution(tool, input = {}, cfg = {}, runGit = null) {
  const base = decide(tool, input, cfg);
  if (tool !== "Bash") return base;
  const cmd = String(input.command || "");
  let parsed = null;
  try { parsed = parsePushDest(cmd); } catch { parsed = null; }
  if (!parsed || !isSymbolicHeadRef(parsed.destRef)) return base; // nothing to resolve -> plain decide()

  // It IS a push to a HEAD-family symbolic ref. We must resolve or fail closed.
  let resolved;
  try {
    if (typeof runGit !== "function") throw new Error("no git runner available");
    resolved = resolveSymbolicRef(parsed.destRef, runGit);
  } catch (err) {
    return { action: "deny", reason:
      `git push to a symbolic ref ('${parsed.destRef}') could not be resolved to a concrete branch (${err && err.message ? err.message : "resolution error"}); denying fail-closed` };
  }
  const rewritten = substituteDest(cmd, parsed, resolved);
  const resolvedVerdict = decide("Bash", { ...input, command: rewritten }, cfg);
  if (resolvedVerdict.action === "deny") {
    return { action: "deny", reason: `${resolvedVerdict.reason} [resolved '${parsed.destRef}' -> '${resolved}']` };
  }
  return base; // resolved form is allowed; defer to the original verdict (also allow, or its own deny reason)
}

// ---- CLI runner (impure; mirrors gate-guard.mjs I/O + protocol) -------------------------------------

function main() {
  let evt = {};
  try { evt = JSON.parse(readFileSync(0, "utf8") || "{}"); } catch { process.exit(0); }
  let cfg = {};
  try { cfg = JSON.parse(readFileSync(join(process.cwd(), "autonomy.config.json"), "utf8")); }
  catch { process.stderr.write("[gate-guard-runner] WARNING: autonomy.config.json missing/unparseable - universal git guards only; protectedPaths NOT enforced.\n"); }

  const tool = evt.tool_name || evt.toolName || "";
  const input = evt.tool_input || evt.toolInput || {};
  const r = decideWithHeadResolution(tool, input, cfg, gitRunner(process.cwd()));
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
}

// Only run the CLI when invoked directly, so tests can import the pure helpers without side effects.
if (import.meta.url === `file://${process.argv[1]}` || (process.argv[1] && process.argv[1].endsWith("gate-guard-runner.mjs"))) {
  main();
}
