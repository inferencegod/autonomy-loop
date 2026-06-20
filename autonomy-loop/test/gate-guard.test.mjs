import test from "node:test";
import assert from "node:assert/strict";
import { decide, executedResidue } from "../hooks/decide.mjs";

const cfg = { prodBranch: "main", protectedPaths: ["test/golden/", "test/__snapshots__/"] };
const bash = (command) => decide("Bash", { command }, cfg);
const denied = (r) => r.action === "deny";

test("blocks prod-branch pushes incl. refspec / HEAD / gh forms", () => {
  for (const c of [
    "git push origin main",
    "git push origin agent-loop:main",
    "git push origin HEAD:main",
    "git push origin HEAD:refs/heads/main",
    "git push origin agent-loop:refs/heads/main",
  ]) assert.ok(denied(bash(c)), "should block: " + c);
});

test("blocks prod push from ANY remote, branch deletion, and ref destruction (v0.6 hardening)", () => {
  for (const c of [
    "git push upstream main",               // non-origin remote: the headline bypass
    "git push main",                        // default remote, prod branch
    "git push --set-upstream upstream main",
    "git push 'main'",                      // quoted ref
    "git push origin --delete main",        // delete prod
    "git push origin --delete agent-loop",  // delete any remote branch
    "git push -d origin agent-loop",
    "git update-ref -d refs/heads/main",
    "git branch -D main",
    "git reflog expire --expire=now --all",
    "git checkout --orphan wipe",
  ]) assert.ok(denied(bash(c)), "should block: " + c);
});

test("allows work-branch pushes + ordinary work", () => {
  assert.equal(bash("git push origin agent-loop").action, "allow");
  assert.equal(bash("npm test").action, "allow");
  assert.equal(decide("Edit", { file_path: "src/index.js" }, cfg).action, "allow");
});

test("does NOT over-block safe pushes or reads (no false positives)", () => {
  for (const c of [
    "git push origin agent-loop",
    "git push origin main:feature",          // push local main -> remote feature (safe)
    "git push origin feature-main-x",        // 'main' as a substring
    "git push origin maintenance",           // 'main' as a prefix
    "git commit -m 'fix the main bug'",      // 'main' in a message
    "rm src/index.js",                       // non-protected path
    "node build.js && cat test/golden/x.json", // reading a protected path
  ]) assert.equal(bash(c).action, "allow", "should allow: " + c);
});

test("R7 (reviewer-seat): a control-plane READ via git show + a non-prod HEAD:branch push are not false-positives", () => {
  // 0.8.1 field report: `git show HEAD:autonomy.config.json` (a read) and `git push origin HEAD:overlay-foldin`
  // (a normal non-prod push) were over-blocked by a broad substring scan. The current decide.mjs fires no rule
  // on either (no write verb / redirect / interpreter near the protected file; no +refspec and no -d/-f flag
  // token on the push). These cases pin that they stay ALLOW so the regression cannot return.
  const c2 = { prodBranch: "main", protectedPaths: ["autonomy.config.json", "autonomy-loop/hooks/"] };
  const b2 = (command) => decide("Bash", { command }, c2);
  for (const c of [
    "git show HEAD:autonomy.config.json",            // reading a protected file via git show (not a write)
    "git show :autonomy.config.json",                // index read of the same
    "git push origin HEAD:overlay-foldin",           // push HEAD to a NON-prod branch (no +refspec, no -d/-f)
    "git push origin HEAD:refs/heads/overlay-foldin",
    "cat autonomy.config.json",                      // a plain read of the protected config
  ]) assert.equal(b2(c).action, "allow", "should allow (read / non-prod push): " + c);
});

test("blocks force-push (incl. bundled flags), history rewrite, hard reset, mirror", () => {
  for (const c of [
    "git push --force origin agent-loop", "git push -f origin agent-loop",
    "git push -uf origin agent-loop", "git push -fu origin agent-loop",
    "git push --force-with-lease origin agent-loop", "git filter-repo --invert-paths",
    "git reset --hard HEAD~3", "git push --mirror origin",
  ]) assert.ok(denied(bash(c)), "should block: " + c);
});

test("blocks gh-CLI shipping + destructive gh", () => {
  for (const c of ["gh pr merge 42 --squash", "gh release create v1.0", "gh release delete v1.0 -y"]) assert.ok(denied(bash(c)), c);
});

test("blocks SHELL writes/deletes to protected paths, incl. broadened verbs + escapes", () => {
  for (const c of [
    "rm test/golden/foo.json", "rm -rf test/golden/", "mv x test/golden/y", "cp a test/golden/b",
    "sed -i 's/a/b/' test/golden/snap.txt", "echo x > test/golden/snap.json",
    "cat a >> test/__snapshots__/s.snap",
    "dd if=/dev/null of=test/golden/x.json", // broadened verb
    "install -m644 /dev/null test/golden/x",
    "ln -sf /tmp/evil test/golden/x",
    "rm test/gol''den/x.json",               // quote-split path
    "echo x 1> test/golden/snap.json",       // numbered fd redirect
  ]) assert.ok(denied(bash(c)), "should block: " + c);
});

test("blocks control-plane writes from another cwd / via interpreters (red-team P0-1)", () => {
  // the gate's own files are protected by BASENAME so a cd-then-write or an interpreter cannot disable it
  for (const c of [
    "cd hooks && cat > decide.mjs <<'X'",                    // cd defeats the path-prefix match; basename catches it
    "cd autonomy-loop/hooks && echo x > gate-guard.mjs",
    "python3 -c \"open('hooks/decide.mjs','w').write('x')\"", // interpreter write
    "node -e \"require('fs').writeFileSync('hooks/decide.mjs','x')\"",
  ]) assert.ok(denied(bash(c)), "should block: " + c);
  const c2 = { prodBranch: "main", protectedPaths: ["autonomy.config.json", ".autonomy-coverage.json", "autonomy-loop/hooks/"] };
  assert.ok(denied(decide("Bash", { command: "cd /tmp && echo {} > autonomy.config.json" }, c2))); // config basename
  // not over-blocked: READING or RUNNING a control-plane file is fine
  assert.equal(bash("cat hooks/decide.mjs").action, "allow");
  assert.equal(bash("node --test test/gate-guard.test.mjs").action, "allow");
});

test("DOCUMENTED LIMITS: the regex cannot catch these; branch protection / read-only files are the barrier", () => {
  // a branch name held in a shell variable carries no literal token; a tracking push by HEAD never contains it.
  // These are NOT regex bugs to "fix" (doing so over-blocks legit HEAD pushes); SECURITY.md names the real rail.
  assert.equal(bash("B=main; git push origin $B").action, "allow");
  assert.equal(bash("git push origin HEAD").action, "allow");
});

test("blocks Edit/Write to protected paths", () => {
  assert.ok(denied(decide("Edit", { file_path: "C:/r/test/golden/x.json" }, cfg)));
  assert.ok(denied(decide("Write", { file_path: "test/__snapshots__/s.snap" }, cfg)));
});

test("no config: universal git guards still fire; protectedPaths NOT enforced (documented fail-open)", () => {
  assert.equal(decide("Bash", { command: "rm test/golden/x" }, {}).action, "allow");
  assert.ok(denied(decide("Bash", { command: "git push --force origin x" }, {})));
  assert.ok(denied(decide("Bash", { command: "git push origin main" }, {})));
});

// ---- P1-3 FIX: "parse, don't blind-substring-match" --------------------------------------------------
// A destructive-git verb / prod-push literal / protected-path token that appears ONLY inside a quoted log
// note, a commit message, or a heredoc body written to a NON-protected file is DESCRIPTIVE TEXT, not an
// executed command, and must no longer be blocked. The genuinely-executed dangerous command must STILL block.

test("P1-3 MUST NOW PASS: a git verb inside a quoted note/commit-msg/doc is descriptive, not executed", () => {
  for (const c of [
    // the three headline regressions from the field report:
    "printf 'note: reset --hard would drop it' >> tasks/ledger.jsonl",   // log note mentioning reset --hard
    "git commit -m \"fix: do not git push origin main\"",                 // commit message mentioning a prod push
    "echo 'we avoided git reset --hard' >> NOTES.md",                     // doc note mentioning reset --hard
    // additional descriptive-text forms that previously tripped the tripwire:
    "printf 'avoided reset --hard' >> tasks/ledger.jsonl",
    "git commit -m 'chore: never git push origin main again'",
    "echo \"do not run git push --force origin main\" >> README.md",      // force-push phrase in a doc
    "echo 'history: ran git filter-repo last year' >> CHANGELOG.md",      // history-rewrite phrase in a doc
    "git commit -F /tmp/msg.txt && echo done",                           // -F message file, then a safe echo
    "cat >> NOTES.md <<'EOF'\nwe considered git reset --hard HEAD~1 but didn't\nEOF", // heredoc body to a safe doc
  ]) assert.equal(bash(c).action, "allow", "should allow (descriptive only): " + c);
});

test("P1-3 MUST STILL BLOCK: the actual executed dangerous command is unchanged", () => {
  for (const c of [
    "git reset --hard HEAD~1",                                            // a real hard reset
    "git push origin main",                                              // a real prod push
    "echo x > test/golden/snap.json",                                   // a real write to a protected path
    "git commit -m 'ok' && git push origin main",                        // safe msg, but a real prod push chained after
    "printf 'reset --hard' >> test/golden/ledger",                       // quoted text redirected to a PROTECTED file
    "echo 'we avoided git reset --hard' >> NOTES.md && git reset --hard HEAD~1", // note is safe; the chained reset is real
    "git commit -m \"do not push\" && git push origin main && rm -rf x", // real prod push + rm after a safe message
    "cat >> test/golden/x <<'EOF'\nanything\nEOF",                       // heredoc written to a PROTECTED sink
    "echo 'note' >> NOTES.md; git push --force origin main",             // safe note then a real force-push (separator)
  ]) assert.ok(denied(bash(c)), "should STILL block (real danger present): " + c);
});

test("P1-3 no smuggling: a prod push 'quoted' but NOT actually a write-to-safe-file still blocks", () => {
  for (const c of [
    "git push origin 'main'",                                           // quoting the ref does not make it descriptive
    "sh -c 'git push origin main'",                                     // quoted arg to an interpreter = executed
    "bash -c \"git reset --hard HEAD~1\"",                              // executed via -c, not echoed to a file
    "echo hi && git push origin main",                                  // echo present but push is its own segment
    "printf 'log' > /dev/stdout; git push origin main",                 // echo-ish to stdout then a real push
  ]) assert.ok(denied(bash(c)), "must NOT be smuggled past the gate: " + c);
});

test("executedResidue: blanks descriptive regions but preserves executed structure (unit)", () => {
  // commit message value blanked -> no 'push' token remains in residue
  assert.ok(!/push/.test(executedResidue('git commit -m "do not git push origin main"', [])));
  // echo-to-safe-file arg blanked -> no 'reset' token remains
  assert.ok(!/reset/.test(executedResidue("echo 'reset --hard' >> NOTES.md", cfg.protectedPaths)));
  // but a redirect to a PROTECTED sink is NOT blanked -> 'reset' survives into the residue
  assert.ok(/reset/.test(executedResidue("echo 'reset --hard' >> test/golden/x", cfg.protectedPaths)));
  // a real command chained after a safe note survives verbatim
  assert.ok(/git push origin main/.test(executedResidue("echo 'x' >> NOTES.md && git push origin main", cfg.protectedPaths)));
  // a plain command with no descriptive region is returned unchanged
  assert.equal(executedResidue("git reset --hard HEAD~1", []), "git reset --hard HEAD~1");
});
