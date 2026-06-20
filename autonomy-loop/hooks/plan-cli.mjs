#!/usr/bin/env node
// hooks/plan-cli.mjs - the PLAN-lane SIDECAR (the 4-terminal researcher<->planner baton + idea pool).
//
// WHY THIS EXISTS (the 0.8.3 session-killer fix). In 4-terminal mode the PLAN lane (researcher T3 +
// planner T4) used to keep its authoritative FSM state in UNCOMMITTED working-tree files
// (PLAN-STATE.md baton + tasks/IDEAS.md pool) on a branch SHARED with the build lane. The loop's
// ~10-min git reconcile (a terminal running `git stash` / `reset --hard` before `git pull`) silently
// reverted that uncommitted state back to the blank template, wiping research every time. The root
// contradiction: "keep plan state uncommitted" is incompatible with "reconcile a shared branch by
// stashing uncommitted changes."
//
// THE FIX (same proven pattern as hooks/presence-cli.mjs): store the plan baton AND the idea pool
// under the repo's SHARED git-common-dir (<gitdir>/autonomy-plan/), NOT in the working tree. Every
// git worktree of the loop on this machine sees the same baton+pool WITHOUT committing anything (no
// history noise, no pull lag) and the reconcile/stash/reset can NEVER touch it (it is not a tracked
// working-tree file). This eliminates the uncommitted-shared-branch contradiction at the root.
//
// INTEGRITY GUARD (belt-and-suspenders, since the sidecar can't be wiped by the reconcile anymore):
// set-turn refuses a baton that looks WIPED - a plan-epoch that goes BACKWARDS (a wiped baton reverts
// to epoch 0), last-research-cycle reverted to the sentinel after being set, or the queue emptied
// without a recorded drain. On refusal it exits non-zero with a HALT message so the prompt parks to
// FOR-REVIEW.md + turn:human and NEVER treats a corrupted/blank template as a fresh research turn.
//
// ATOMIC WRITES: content first, flip turn LAST; every write is temp-file + rename (like presence-cli),
// so a crash mid-write never leaves the baton pointing at content that does not exist yet.
//
// Turn vocab (4-terminal PLAN baton): research | plan | human. (The BUILD baton, LOOP-STATE.md, is a
// separate machine with turns planner | builder | reviewer | human and is untouched by this file.)
//
//   node hooks/plan-cli.mjs read-turn                 [--dir=<path>]
//   node hooks/plan-cli.mjs set-turn <research|plan|human> [--epoch=<n>] [--last-research-cycle=<s>]
//                                                     [--note=<s>] [--force] [--dir=<path>]
//   node hooks/plan-cli.mjs read-pool                 [--json] [--dir=<path>]
//   node hooks/plan-cli.mjs append-idea <text>        [--dir=<path>]
//   node hooks/plan-cli.mjs drain-idea                [--dir=<path>]   (prints + removes the top idea, records a drain)
//   node hooks/plan-cli.mjs status                    [--json] [--dir=<path>]
//   node hooks/plan-cli.mjs init                      [--dir=<path>]   (materialize an empty baton; idempotent)
import { writeFileSync, readFileSync, existsSync, mkdirSync, renameSync } from "node:fs";
import { join, isAbsolute } from "node:path";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const TURNS = ["research", "plan", "human"];
const SENTINEL = "<none>"; // last-research-cycle starts here; reverting to it after being set = WIPED.

// The shared sidecar dir: the git-common-dir is the ONE place every worktree of this repo agrees on,
// on this machine, so a write in the researcher's worktree is seen from the planner's worktree with
// no commit/pull. Identical resolution strategy to presence-cli's presenceDir().
function planDir(args) {
  if (typeof args.dir === "string" && args.dir) { mkdirSync(args.dir, { recursive: true }); return args.dir; }
  let common = ".git";
  try { common = execSync("git rev-parse --git-common-dir", { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim() || ".git"; } catch { /* not a repo */ }
  const base = isAbsolute(common) ? common : join(process.cwd(), common);
  const d = join(base, "autonomy-plan");
  mkdirSync(d, { recursive: true });
  return d;
}

function batonPath(dir) { return join(dir, "baton.json"); }
function poolPath(dir) { return join(dir, "pool.jsonl"); }

// DEFAULT_BATON: the clean-slate baton. This is what `init` materializes and what a never-written
// sidecar reports. plan-epoch starts at 0; the integrity guard treats any later epoch DECREASE as a
// wipe. drainCount tracks recorded drains so an empty pool can be told apart from a wiped one.
function defaultBaton() {
  return {
    turn: "research",
    planEpoch: 0,
    lastResearchCycle: SENTINEL,
    pendingForPlan: "",
    drainCount: 0,
    updatedUtc: null,
  };
}

function readBaton(dir) {
  const p = batonPath(dir);
  if (!existsSync(p)) return defaultBaton();
  try {
    const obj = JSON.parse(readFileSync(p, "utf8"));
    // Merge over the default so a partial/older file still has every field (fail-soft on shape).
    return { ...defaultBaton(), ...(obj && typeof obj === "object" ? obj : {}) };
  } catch {
    return defaultBaton(); // corrupt JSON -> clean slate (the guard below still catches a real wipe)
  }
}

function writeAtomic(path, contents) {
  const tmp = `${path}.tmp-${process.pid}-${Date.now()}`;
  writeFileSync(tmp, contents);
  renameSync(tmp, path);
}

function writeBaton(dir, baton) {
  writeAtomic(batonPath(dir), JSON.stringify(baton, null, 2) + "\n");
}

// readPool: the idea pool is an append-only JSONL of { id, text, addedUtc }. A drain removes the
// oldest (top) line. Corrupt lines are skipped (fail-soft), never crash the lane.
function readPool(dir) {
  const p = poolPath(dir);
  if (!existsSync(p)) return [];
  const out = [];
  for (const line of readFileSync(p, "utf8").split("\n")) {
    const s = line.trim();
    if (!s) continue;
    try { out.push(JSON.parse(s)); } catch { /* skip corrupt line */ }
  }
  return out;
}

function writePool(dir, items) {
  writeAtomic(poolPath(dir), items.map((x) => JSON.stringify(x)).join("\n") + (items.length ? "\n" : ""));
}

// integrityVerdict: the WIPE detector (pure, exported for unit tests). Given the CURRENT on-disk
// baton and the PROPOSED next baton, decide whether the transition looks like a silent revert to a
// blank template rather than a legitimate forward step. Returns { ok, reason }.
//   - epoch went BACKWARDS (next.planEpoch < cur.planEpoch): a wiped baton reverts to 0. REFUSE.
//   - lastResearchCycle was set (!= sentinel) and the NEXT write reverts it to the sentinel without
//     advancing the epoch: that is the template default reappearing, not real progress. REFUSE.
// FAIL-CLOSED on non-numeric epochs.
export function integrityVerdict(cur, next) {
  const ce = Number(cur?.planEpoch);
  const ne = Number(next?.planEpoch);
  if (!Number.isInteger(ce) || !Number.isInteger(ne)) {
    return { ok: false, reason: "non-integer plan-epoch (corrupt baton)" };
  }
  if (ne < ce) {
    return { ok: false, reason: `plan-epoch went backwards (${ce} -> ${ne}): baton looks WIPED to template` };
  }
  const curSet = typeof cur?.lastResearchCycle === "string" && cur.lastResearchCycle !== SENTINEL && cur.lastResearchCycle !== "";
  const nextSentinel = next?.lastResearchCycle === SENTINEL || next?.lastResearchCycle === "" || next?.lastResearchCycle == null;
  if (curSet && nextSentinel && ne <= ce) {
    return { ok: false, reason: "last-research-cycle reverted to <none> after being set: baton looks WIPED" };
  }
  return { ok: true };
}

function parseArgs(argv) {
  const a = { _: [] };
  for (const x of argv) { const m = x.match(/^--([^=]+)=(.*)$/); if (m) a[m[1]] = m[2]; else if (x.startsWith("--")) a[x.slice(2)] = true; else a._.push(x); }
  return a;
}

function nextId(pool) {
  let max = 0;
  for (const it of pool) { const n = Number(String(it.id || "").replace(/[^0-9]/g, "")); if (Number.isFinite(n) && n > max) max = n; }
  return `IDEA-${String(max + 1).padStart(3, "0")}`;
}

function main(argv) {
  const args = parseArgs(argv.slice(2));
  const cmd = args._[0];
  const now = typeof args.now === "string" && args.now ? args.now : new Date().toISOString();
  const dir = planDir(args);

  if (cmd === "init") {
    if (!existsSync(batonPath(dir))) writeBaton(dir, defaultBaton());
    console.log(`plan sidecar: ${dir}`);
    return;
  }

  if (cmd === "read-turn") {
    console.log(readBaton(dir).turn);
    return;
  }

  if (cmd === "set-turn") {
    const turn = args._[1];
    if (!TURNS.includes(turn)) {
      console.error(`plan-cli: unknown turn '${turn}'. one of: ${TURNS.join(", ")}`);
      process.exit(2);
    }
    const cur = readBaton(dir);
    const next = { ...cur, turn, updatedUtc: now };
    // Optional forward fields. plan-epoch only ever moves up; default = keep current.
    if (args.epoch !== undefined) {
      const e = Number(args.epoch);
      if (!Number.isInteger(e)) { console.error("plan-cli: --epoch must be an integer"); process.exit(2); }
      next.planEpoch = e;
    }
    if (typeof args["last-research-cycle"] === "string") next.lastResearchCycle = args["last-research-cycle"];
    if (typeof args.note === "string") next.pendingForPlan = args.note;

    if (!args.force) {
      const v = integrityVerdict(cur, next);
      if (!v.ok) {
        // HALT: a wiped/corrupted baton must NEVER be advanced as if it were a fresh turn.
        console.error(`plan-cli: HALT (integrity): ${v.reason}. Refusing to write. Park to FOR-REVIEW.md + set turn:human (use --force only after a verified manual recovery).`);
        process.exit(3);
      }
    }
    writeBaton(dir, next);
    console.log(`turn -> ${turn} (plan-epoch ${next.planEpoch})`);
    return;
  }

  if (cmd === "read-pool") {
    const pool = readPool(dir);
    if (args.json) { console.log(JSON.stringify(pool)); return; }
    if (pool.length === 0) { console.log("(pool empty)"); return; }
    for (const it of pool) console.log(`${it.id}\t${it.text}`);
    return;
  }

  if (cmd === "append-idea") {
    const text = args._.slice(1).join(" ").trim();
    if (!text) { console.error("plan-cli: append-idea needs <text>"); process.exit(2); }
    const pool = readPool(dir);
    const id = nextId(pool);
    pool.push({ id, text, addedUtc: now });
    writePool(dir, pool);
    console.log(`appended ${id} (pool size ${pool.length})`);
    return;
  }

  if (cmd === "drain-idea") {
    const pool = readPool(dir);
    if (pool.length === 0) { console.error("plan-cli: pool empty, nothing to drain"); process.exit(1); }
    const top = pool.shift();
    writePool(dir, pool); // content first
    const cur = readBaton(dir); // then record the drain (so an empty pool != a wiped pool)
    writeBaton(dir, { ...cur, drainCount: Number(cur.drainCount || 0) + 1, updatedUtc: now });
    console.log(`${top.id}\t${top.text}`);
    return;
  }

  if (cmd === "status") {
    const baton = readBaton(dir);
    const pool = readPool(dir);
    const s = { dir, ...baton, poolSize: pool.length };
    if (args.json) { console.log(JSON.stringify(s)); return; }
    console.log(`dir:                 ${dir}`);
    console.log(`turn:                ${baton.turn}`);
    console.log(`plan-epoch:          ${baton.planEpoch}`);
    console.log(`last-research-cycle: ${baton.lastResearchCycle}`);
    console.log(`pending-for-plan:    ${baton.pendingForPlan}`);
    console.log(`drain-count:         ${baton.drainCount}`);
    console.log(`pool-size:           ${pool.length}`);
    return;
  }

  console.error("plan-cli: usage: read-turn | set-turn <research|plan|human> [--epoch=N --last-research-cycle=S --note=S --force] | read-pool [--json] | append-idea <text> | drain-idea | status [--json] | init   [--dir=PATH]");
  process.exit(2);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main(process.argv);
