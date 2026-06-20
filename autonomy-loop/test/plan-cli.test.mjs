import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync, execSync } from "node:child_process";
import { mkdtempSync, rmSync, existsSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { integrityVerdict } from "../hooks/plan-cli.mjs";

// plan-cli is the PLAN-lane SIDECAR (4-terminal researcher<->planner baton + idea pool). These assert
// the 0.8.3 invariant the whole fix rests on: the plan state lives under the SHARED git-common-dir
// (never the working tree), so (a) both lanes see it with no commit/pull, and (b) the every-~10-min
// git reconcile (stash / reset --hard before pull) can NEVER revert it to a blank template. Plus the
// integrity guard (refuse a wiped baton) and atomic, vocab-correct turns.
const CLI = fileURLToPath(new URL("../hooks/plan-cli.mjs", import.meta.url));
const dirNew = () => mkdtempSync(join(tmpdir(), "plancli-"));
const run = (dir, args) => execFileSync(process.execPath, [CLI, ...args, `--dir=${dir}`], { encoding: "utf8" }).trim();
// runRaw returns {status, stdout, stderr} without throwing, for the non-zero-exit (HALT) cases.
function runRaw(dir, args) {
  try {
    const stdout = execFileSync(process.execPath, [CLI, ...args, `--dir=${dir}`], { encoding: "utf8" });
    return { status: 0, stdout, stderr: "" };
  } catch (e) {
    return { status: e.status ?? 1, stdout: e.stdout?.toString() ?? "", stderr: e.stderr?.toString() ?? "" };
  }
}

// --- baton: default + turn vocab ---
test("a fresh sidecar reports the clean-slate baton (turn: research, plan-epoch 0)", () => {
  const dir = dirNew();
  try {
    assert.equal(run(dir, ["read-turn"]), "research");
    const s = JSON.parse(run(dir, ["status", "--json"]));
    assert.equal(s.turn, "research");
    assert.equal(s.planEpoch, 0);
    assert.equal(s.lastResearchCycle, "<none>");
    assert.equal(s.poolSize, 0);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("set-turn accepts only the plan vocab research|plan|human, rejects 'planner'", () => {
  const dir = dirNew();
  try {
    run(dir, ["set-turn", "plan", "--epoch=1"]);
    assert.equal(run(dir, ["read-turn"]), "plan");
    run(dir, ["set-turn", "research", "--epoch=1"]);
    assert.equal(run(dir, ["read-turn"]), "research");
    const bad = runRaw(dir, ["set-turn", "planner"]); // the OLD wrong token must be refused
    assert.equal(bad.status, 2);
    assert.match(bad.stderr, /unknown turn 'planner'/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// --- the idea pool: append / read / drain (single writer = the plan lane) ---
test("append-idea then read-pool then drain-idea is FIFO and records a drain", () => {
  const dir = dirNew();
  try {
    run(dir, ["append-idea", "first idea"]);
    run(dir, ["append-idea", "second idea"]);
    const pool = JSON.parse(run(dir, ["read-pool", "--json"]));
    assert.equal(pool.length, 2);
    assert.equal(pool[0].text, "first idea");
    const drained = run(dir, ["drain-idea"]);
    assert.match(drained, /first idea/); // FIFO: oldest first
    assert.equal(JSON.parse(run(dir, ["read-pool", "--json"])).length, 1);
    assert.equal(JSON.parse(run(dir, ["status", "--json"])).drainCount, 1); // drain recorded
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// --- INTEGRITY GUARD: refuse a wiped baton (the session-killer) ---
test("integrityVerdict: epoch going backwards is a WIPE (refused)", () => {
  assert.equal(integrityVerdict({ planEpoch: 3 }, { planEpoch: 0 }).ok, false);
  assert.equal(integrityVerdict({ planEpoch: 3 }, { planEpoch: 4 }).ok, true);
  assert.equal(integrityVerdict({ planEpoch: 3 }, { planEpoch: 3 }).ok, true); // same epoch (a note update) is fine
  assert.equal(integrityVerdict({ planEpoch: "x" }, { planEpoch: 1 }).ok, false); // fail-closed
});

test("integrityVerdict: last-research-cycle reverting to <none> after being set is a WIPE", () => {
  const cur = { planEpoch: 2, lastResearchCycle: "R-11" };
  assert.equal(integrityVerdict(cur, { planEpoch: 2, lastResearchCycle: "<none>" }).ok, false);
  // but a real forward step that advances the epoch and sets a new cycle is fine
  assert.equal(integrityVerdict(cur, { planEpoch: 3, lastResearchCycle: "R-12" }).ok, true);
});

test("set-turn HALTS (exit 3) when the on-disk baton is advanced then a wiped template tries to roll it back", () => {
  const dir = dirNew();
  try {
    run(dir, ["set-turn", "plan", "--epoch=5", "--last-research-cycle=R-11"]);
    // A wiped template would try to set turn:research with epoch 0 again. That must be refused.
    const halt = runRaw(dir, ["set-turn", "research", "--epoch=0"]);
    assert.equal(halt.status, 3, "a backwards plan-epoch must HALT, not silently re-research");
    assert.match(halt.stderr, /HALT \(integrity\)/);
    assert.match(halt.stderr, /turn:human/);
    // the on-disk baton is untouched by the refused write
    assert.equal(JSON.parse(run(dir, ["status", "--json"])).planEpoch, 5);
    // --force is the documented manual-recovery override
    const forced = runRaw(dir, ["set-turn", "research", "--epoch=0", "--force"]);
    assert.equal(forced.status, 0);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// --- ATOMIC: content first, turn last (drain writes the pool before recording the drain) ---
test("a drain leaves a consistent baton+pool (no torn write)", () => {
  const dir = dirNew();
  try {
    run(dir, ["append-idea", "only idea"]);
    run(dir, ["drain-idea"]);
    assert.equal(JSON.parse(run(dir, ["read-pool", "--json"])).length, 0);
    assert.equal(JSON.parse(run(dir, ["status", "--json"])).drainCount, 1);
    const empty = runRaw(dir, ["drain-idea"]); // draining an empty pool is a clean exit 1, not a crash
    assert.equal(empty.status, 1);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// --- THE CORE FIX: the sidecar lives in the shared git dir, so a reconcile/reset can't wipe it,
//     and another worktree sees it with no commit. This is the bug the report documents. ---
test("SIDECAR DURABILITY: a git reset --hard / stash on the working tree does NOT touch the baton", () => {
  const git = (cwd, a) => execSync(`git ${a}`, { cwd, stdio: ["ignore", "pipe", "pipe"], encoding: "utf8" });
  const runIn = (cwd, args) => execFileSync(process.execPath, [CLI, ...args], { cwd, encoding: "utf8" }).trim();
  const repo = mkdtempSync(join(tmpdir(), "plan-repo-"));
  try {
    git(repo, "init -q"); git(repo, "config user.email t@a.b"); git(repo, "config user.name t");
    writeFileSync(join(repo, "README"), "x\n"); git(repo, "add -A"); git(repo, "commit -q -m root");
    // Plan lane writes its baton + pool through the sidecar (NO commit), from inside the repo.
    runIn(repo, ["set-turn", "plan", "--epoch=4", "--last-research-cycle=R-11"]);
    runIn(repo, ["append-idea", "a hard-won research idea"]);
    // The build lane does the every-10-min reconcile: a dirty working file, then reset --hard + stash.
    writeFileSync(join(repo, "scratch.txt"), "uncommitted build-lane edit\n");
    git(repo, "stash -u || true"); // the report's `git stash`
    git(repo, "reset --hard HEAD"); // the report's catastrophic `reset --hard`
    // The baton + pool survive verbatim - they live in <git-common-dir>/autonomy-plan/, not the tree.
    assert.equal(runIn(repo, ["read-turn"]), "plan", "reset --hard must NOT revert the sidecar baton");
    assert.equal(JSON.parse(runIn(repo, ["status", "--json"])).planEpoch, 4);
    assert.equal(JSON.parse(runIn(repo, ["read-pool", "--json"]))[0].text, "a hard-won research idea");
    // And it is NOT in the working tree (so it can never appear in git status / be stashed).
    assert.ok(!existsSync(join(repo, "PLAN-STATE.md")));
    assert.ok(!existsSync(join(repo, "tasks", "IDEAS.md")));
  } finally { rmSync(repo, { recursive: true, force: true }); }
});

test("cross-worktree: a baton/pool write in one worktree is visible from another (shared git dir, no commit)", () => {
  const git = (cwd, a) => execSync(`git ${a}`, { cwd, stdio: ["ignore", "pipe", "pipe"] });
  const runIn = (cwd, args) => execFileSync(process.execPath, [CLI, ...args], { cwd, encoding: "utf8" }).trim();
  const main = mkdtempSync(join(tmpdir(), "plan-wt-"));
  const wt = main + "-wt";
  try {
    git(main, "init -q"); git(main, "config user.email t@a.b"); git(main, "config user.name t");
    writeFileSync(join(main, "README"), "x\n"); git(main, "add -A"); git(main, "commit -q -m root");
    git(main, `worktree add -q --detach "${wt}"`);
    // Researcher (in main) fills the pool + hands the turn to the planner.
    runIn(main, ["append-idea", "shared idea"]);
    runIn(main, ["set-turn", "plan", "--epoch=1", "--note=pool has 1 fresh idea"]);
    // Planner (in the other worktree) sees both with NO commit/pull.
    assert.equal(runIn(wt, ["read-turn"]), "plan");
    const pool = JSON.parse(runIn(wt, ["read-pool", "--json"]));
    assert.equal(pool[0].text, "shared idea");
    git(main, `worktree remove --force "${wt}"`);
  } finally { rmSync(main, { recursive: true, force: true }); try { rmSync(wt, { recursive: true, force: true }); } catch {} }
});

test("init is idempotent and never clobbers an advanced baton", () => {
  const dir = dirNew();
  try {
    run(dir, ["set-turn", "plan", "--epoch=2"]);
    run(dir, ["init"]); // must NOT reset the baton back to epoch 0
    assert.equal(JSON.parse(run(dir, ["status", "--json"])).planEpoch, 2);
    assert.equal(run(dir, ["read-turn"]), "plan");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
