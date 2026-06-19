import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync, execSync } from "node:child_process";
import { mkdtempSync, rmSync, existsSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

// presence-cli is the "sign-in clipboard" (presence-to-trigger): a launched terminal signs in; the router reads
// who is live. These assert the DEADLOCK-SAFE invariant the prompts rely on (a role is in the roster only if its
// terminal signed in recently) AND the cross-worktree invariant (the builder and reviewer run in separate
// worktrees, so a sign-in in one must be seen from the other through the shared git dir, with no commit).
const CLI = fileURLToPath(new URL("../hooks/presence-cli.mjs", import.meta.url));
const NOW = "2026-06-19T12:00:00Z";
const plus = (s) => new Date(Date.parse(NOW) + s * 1000).toISOString();
const dirNew = () => mkdtempSync(join(tmpdir(), "pcli-"));
const run = (dir, args) => execFileSync(process.execPath, [CLI, ...args, `--dir=${dir}`], { encoding: "utf8" }).trim();
const live = (dir, now) => run(dir, ["roster", `--now=${now}`]).split("\n").filter(Boolean);

test("signin writes a lease and roster reflects it, rank-ordered", () => {
  const dir = dirNew();
  try {
    run(dir, ["signin", "builder", "--ttl=1800", `--now=${NOW}`]);
    run(dir, ["signin", "reviewer", "--ttl=1800", `--now=${NOW}`]);
    assert.ok(existsSync(join(dir, "builder.lease.json")));
    assert.deepEqual(live(dir, plus(60)), ["builder", "reviewer"]);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("DEADLOCK GUARD: only builder+reviewer signed in -> planner NOT live (reviewer falls back to builder)", () => {
  const dir = dirNew();
  try {
    run(dir, ["signin", "builder", "--ttl=1800", `--now=${NOW}`]);
    run(dir, ["signin", "reviewer", "--ttl=1800", `--now=${NOW}`]);
    assert.ok(!live(dir, plus(60)).includes("planner"));
    let planner = true;
    try { execFileSync(process.execPath, [CLI, "is-live", "planner", `--dir=${dir}`, `--now=${plus(60)}`]); } catch { planner = false; }
    assert.equal(planner, false, "is-live planner must exit non-zero so the prompt routes to the builder");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("launching the planner (signin) puts it in the roster", () => {
  const dir = dirNew();
  try {
    run(dir, ["signin", "builder", "--ttl=1800", `--now=${NOW}`]);
    run(dir, ["signin", "reviewer", "--ttl=1800", `--now=${NOW}`]);
    run(dir, ["signin", "planner", "--ttl=1800", `--now=${NOW}`]);
    assert.deepEqual(live(dir, plus(60)), ["planner", "builder", "reviewer"]);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("a lease past its TTL drops out (a stale terminal looks gone)", () => {
  const dir = dirNew();
  try { run(dir, ["signin", "planner", "--ttl=1800", `--now=${NOW}`]); assert.ok(!live(dir, plus(1860)).includes("planner")); }
  finally { rmSync(dir, { recursive: true, force: true }); }
});

test("TTL tuned to 3x the loop interval keeps a terminal live across one 10-min tick", () => {
  const dir = dirNew();
  try { run(dir, ["signin", "planner", "--ttl=1800", `--now=${NOW}`]); assert.ok(live(dir, plus(600)).includes("planner")); }
  finally { rmSync(dir, { recursive: true, force: true }); }
});

test("cross-worktree: a signin in one worktree is visible from another (shared git dir, no commit)", () => {
  const git = (cwd, a) => execSync(`git ${a}`, { cwd, stdio: ["ignore", "pipe", "pipe"] });
  const runIn = (cwd, args) => execFileSync(process.execPath, [CLI, ...args], { cwd, encoding: "utf8" }).trim();
  const main = mkdtempSync(join(tmpdir(), "pw-"));
  const wt = main + "-wt";
  try {
    git(main, "init -q"); git(main, "config user.email t@a.b"); git(main, "config user.name t");
    writeFileSync(join(main, "README"), "x\n"); git(main, "add -A"); git(main, "commit -q -m root");
    git(main, `worktree add -q --detach "${wt}"`);
    runIn(main, ["signin", "builder", "--ttl=1800", `--now=${NOW}`]);
    runIn(main, ["signin", "planner", "--ttl=1800", `--now=${NOW}`]);
    const seen = runIn(wt, ["roster", `--now=${plus(60)}`]).split("\n").filter(Boolean);
    assert.deepEqual(seen, ["planner", "builder"], "the other worktree must see the same roster, no commit/pull");
    execFileSync(process.execPath, [CLI, "is-live", "planner", `--now=${plus(60)}`], { cwd: wt }); // exit 0 or throws
    git(main, `worktree remove --force "${wt}"`);
  } finally { rmSync(main, { recursive: true, force: true }); try { rmSync(wt, { recursive: true, force: true }); } catch {} }
});
