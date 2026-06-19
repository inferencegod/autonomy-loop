import test from "node:test";
import assert from "node:assert/strict";
import {
  isSymbolicHeadRef, parsePushDest, substituteDest, decideWithHeadResolution,
} from "../hooks/gate-guard-runner.mjs";

const cfg = { prodBranch: "main", protectedPaths: ["test/golden/", "test/__snapshots__/"] };
// Injected fake git runners (no real process). onProd: HEAD resolves to the prod branch. onWork: a feature.
const onProd = (args) => {
  if (args.includes("--abbrev-ref")) return "main\n";
  if (args.includes("--symbolic-full-name")) return "refs/remotes/origin/main\n";
  throw new Error("unexpected git " + args.join(" "));
};
const onWork = (args) => {
  if (args.includes("--abbrev-ref")) return "agent-loop\n";
  if (args.includes("--symbolic-full-name")) return "refs/remotes/origin/agent-loop\n";
  throw new Error("unexpected git " + args.join(" "));
};
const detached = (args) => {
  if (args.includes("--abbrev-ref")) return "HEAD\n"; // detached: abbrev-ref returns literal HEAD
  throw new Error("no upstream");
};
const bash = (command, runGit) => decideWithHeadResolution("Bash", { command }, cfg, runGit);

test("isSymbolicHeadRef: HEAD-family symbolic refs vs literal branch names", () => {
  for (const r of ["HEAD", "@", "HEAD~2", "HEAD^", "@~1", "@{push}", "@{upstream}", "@{u}", "'HEAD'"])
    assert.equal(isSymbolicHeadRef(r), true, "symbolic: " + r);
  for (const r of ["main", "agent-loop", "refs/heads/main", "feature-HEAD", "HEADER", "", null, 7])
    assert.equal(isSymbolicHeadRef(r), false, "literal/invalid: " + r);
});

test("parsePushDest: extracts destination ref for bare + refspec forms; null on non-push / shell-meta", () => {
  assert.equal(parsePushDest("git push origin HEAD").destRef, "HEAD");
  assert.equal(parsePushDest("git push origin HEAD:main").destRef, "main");
  assert.equal(parsePushDest("git push --force origin HEAD").destRef, "HEAD"); // flag skipped
  assert.equal(parsePushDest("git push origin agent-loop").destRef, "agent-loop");
  assert.equal(parsePushDest("git status"), null);
  assert.equal(parsePushDest("git push"), null);                 // no positional ref
  assert.equal(parsePushDest("B=main; git push origin $B"), null); // shell var -> not our job
  assert.equal(parsePushDest("git push origin $(echo main)"), null); // cmd subst -> not our job
});

test("substituteDest: swaps the destination ref with the resolved branch, leaves the rest", () => {
  const p1 = parsePushDest("git push origin HEAD");
  assert.equal(substituteDest("git push origin HEAD", p1, "main"), "git push origin main");
  const p2 = parsePushDest("git push origin HEAD:refs/heads/x"); // dest is 'refs/heads/x' (not symbolic; just checks substitution mechanics)
  assert.equal(p2.destRef, "refs/heads/x");
});

// ---- ACCEPTANCE CRITERIA --------------------------------------------------------------------------

test("AC1: `git push origin HEAD` while checked out on prod -> DENY", () => {
  const r = bash("git push origin HEAD", onProd);
  assert.equal(r.action, "deny", "must deny HEAD push on prod");
  assert.match(r.reason, /main/);            // reason names the resolved prod branch
  assert.match(r.reason, /resolved 'HEAD'/); // reason documents the resolution
});

test("AC1b: `git push origin HEAD` on a WORK branch -> ALLOW", () => {
  assert.equal(bash("git push origin HEAD", onWork).action, "allow");
});

test("AC1c: `git push origin HEAD:main` on a work branch still denies (literal dest already caught)", () => {
  // dest 'main' is literal, not symbolic -> base decide() denies regardless of HEAD position.
  assert.equal(bash("git push origin HEAD:main", onWork).action, "deny");
});

test("AC2: `B=main; git push origin $B` -> ALLOW (documents the limit; server ruleset is the barrier)", () => {
  // The $B is a shell variable; the runner refuses to expand it and decide() sees no literal 'main'.
  assert.equal(bash("B=main; git push origin $B", onProd).action, "allow");
});

test("fail-closed: HEAD push but resolution THROWS -> DENY", () => {
  const r = bash("git push origin HEAD", detached); // detached HEAD
  assert.equal(r.action, "deny");
  assert.match(r.reason, /could not be resolved|fail-closed/);
});

test("fail-closed: HEAD push but NO git runner provided -> DENY", () => {
  const r = bash("git push origin HEAD", null);
  assert.equal(r.action, "deny");
});

test("@{push} tracking ref resolving to prod -> DENY", () => {
  const r = bash("git push origin @{push}", onProd);
  assert.equal(r.action, "deny");
  assert.match(r.reason, /main/);
});

test("non-push and non-Bash commands defer to plain decide() unchanged", () => {
  assert.equal(bash("npm test", onProd).action, "allow");
  assert.equal(bash("git push origin agent-loop", onProd).action, "allow"); // literal work branch, no resolution
  assert.equal(decideWithHeadResolution("Edit", { file_path: "src/x.js" }, cfg, onProd).action, "allow");
});

test("literal prod push still denied without any resolution (regression: base rule intact)", () => {
  assert.equal(bash("git push origin main", onProd).action, "deny");
});
