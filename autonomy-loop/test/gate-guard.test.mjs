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

test("allows work-branch pushes + ordinary work", () => {
  assert.equal(bash("git push origin agent-loop").action, "allow");
  assert.equal(bash("npm test").action, "allow");
  assert.equal(decide("Edit", { file_path: "src/index.js" }, cfg).action, "allow");
});

test("blocks force-push, history rewrite, hard reset, mirror", () => {
  for (const c of [
    "git push --force origin agent-loop", "git push -f origin agent-loop",
    "git push --force-with-lease origin agent-loop", "git filter-repo --invert-paths",
    "git reset --hard HEAD~3", "git push --mirror origin",
  ]) assert.ok(denied(bash(c)), "should block: " + c);
});

test("blocks gh-CLI shipping", () => {
  for (const c of ["gh pr merge 42 --squash", "gh release create v1.0"]) assert.ok(denied(bash(c)), c);
});

test("blocks SHELL writes/deletes to protected paths (the Edit-tool bypass)", () => {
  for (const c of [
    "rm test/golden/foo.json", "rm -rf test/golden/", "mv x test/golden/y", "cp a test/golden/b",
    "sed -i 's/a/b/' test/golden/snap.txt", "echo x > test/golden/snap.json",
    "cat a >> test/__snapshots__/s.snap",
  ]) assert.ok(denied(bash(c)), "should block: " + c);
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
