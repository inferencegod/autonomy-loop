import test from "node:test";
import assert from "node:assert/strict";
import { decide } from "../hooks/decide.mjs";

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
