// autonomy-loop: baton-io. The IMPURE wrapper around the pure turn-scheduler core
// (turn-scheduler.mjs), driven by the live roster from presence-io. This is the only layer that
// reads/writes LOOP-STATE.md and commits it; all DECISIONS live in turn-scheduler.mjs (and
// presence.mjs) and stay unit-tested.
//
// SEPARATION OF CONCERNS (the whole point of this file):
//   - ROUTING state = the turn cursor. It is a tiny machine-owned JSON object { turn, epoch }
//     fenced inside an HTML-comment sentinel block in LOOP-STATE.md. Only this module writes it.
//   - WORK state = the baton BODY (the human/agent-authored markdown: the actual handoff notes).
//     It lives outside the sentinel block and is preserved verbatim across every routing write.
//   This keeps a reassignment of the turn from ever clobbering in-flight work, and keeps a body
//   edit from ever moving the cursor.
//
// FENCING:
//   - epoch is the monotonic fencing token. Every REASSIGNING routing write bumps it by exactly 1.
//   - Before any routing write lands, commitAccepted(writeEpoch, currentEpoch) must hold, i.e. the
//     write must carry currentEpoch+1. A zombie that wakes holding a stale epoch is rejected and
//     nothing is written. (Spec A-turn-scheduler AC3/AC4.)
//
// INTEGRATION NOTES:
//   - tick() is the loop step: read cursor -> reclaim a dead holder OR advance a live one ->
//     epoch-guarded write. It pulls the live roster from presence-io (which reflects dead leases
//     dropping out), so a stale role is skipped and a dead holder is reclaimed automatically.
//   - This file is environment-coupled (child_process git + fs); it is NOT unit-tested in the pure
//     suite. Test it with an integration harness against a scratch repo.

import { execFileSync } from "node:child_process";
import { writeFileSync, readFileSync, existsSync, renameSync } from "node:fs";
import { join } from "node:path";
import { advanceTurn, reclaim, commitAccepted } from "./turn-scheduler.mjs";
import { isLive } from "./presence.mjs";
import { liveRoster, allLeases } from "./presence-io.mjs";

const STATE_FILE = "LOOP-STATE.md";
const BEGIN = "<!-- autonomy-loop:routing BEGIN (machine-owned; do not edit by hand) -->";
const END = "<!-- autonomy-loop:routing END -->";

function git(args, cwd) {
  // Capture stderr (do not inherit to the console): routing git is best-effort and wrapped by
  // gitQuiet, so an offline pull / a missing push remote degrades SILENTLY instead of spewing git
  // warnings or fatals into the loop's output. stdout is still captured and returned.
  return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

function gitQuiet(args, cwd) {
  try {
    return { ok: true, out: git(args, cwd) };
  } catch (err) {
    const msg = (err && (err.stderr || err.message)) || err;
    return { ok: false, out: String(msg).trim() };
  }
}

function statePath(repo) {
  return join(repo, STATE_FILE);
}

function writeAtomic(path, contents) {
  const tmp = `${path}.tmp-${process.pid}-${Date.now()}`;
  writeFileSync(tmp, contents);
  renameSync(tmp, path);
}

// DEFAULT_BODY: the work-state scaffold written the first time we materialize LOOP-STATE.md. The
// routing block is injected separately; everything here is the body and is never touched again.
function defaultBody() {
  return [
    "# LOOP-STATE",
    "",
    "Work state for the autonomy loop. The routing cursor below is machine-owned; write your",
    "handoff notes anywhere OUTSIDE the routing block and they will be preserved across turns.",
    "",
    "## Handoff notes",
    "",
    "(none yet)",
    "",
  ].join("\n");
}

// renderRoutingBlock: serialize the cursor as a fenced JSON object between the sentinels. The
// shape is deliberately minimal: ONLY routing state, never work state.
function renderRoutingBlock(cursor) {
  const json = JSON.stringify({ turn: cursor.turn ?? null, epoch: cursor.epoch ?? 0 }, null, 2);
  return `${BEGIN}\n\`\`\`json\n${json}\n\`\`\`\n${END}`;
}

// parseRouting: pull the { turn, epoch } cursor out of the sentinel block. FAIL-CLOSED: if the
// block is missing or malformed, report epoch 0 / turn null so the first real write (epoch 1) is
// the only thing that can advance from a clean slate.
function parseRouting(text) {
  if (typeof text !== "string") return { turn: null, epoch: 0 };
  const b = text.indexOf(BEGIN);
  const e = text.indexOf(END);
  if (b === -1 || e === -1 || e < b) return { turn: null, epoch: 0 };
  const inner = text.slice(b + BEGIN.length, e);
  const m = inner.match(/```json\s*([\s\S]*?)```/);
  if (!m) return { turn: null, epoch: 0 };
  try {
    const obj = JSON.parse(m[1].trim());
    const epoch = Number.isInteger(obj.epoch) ? obj.epoch : 0;
    const turn = typeof obj.turn === "string" ? obj.turn : null;
    return { turn, epoch };
  } catch {
    return { turn: null, epoch: 0 };
  }
}

// splitBody: return the document with the routing block removed, so we can re-inject a fresh block
// without disturbing the work-state body. If there is no block yet, the whole text is body.
function splitBody(text) {
  if (typeof text !== "string") return "";
  const b = text.indexOf(BEGIN);
  const e = text.indexOf(END);
  if (b === -1 || e === -1 || e < b) return text;
  const before = text.slice(0, b);
  const after = text.slice(e + END.length);
  return (before + after);
}

// compose: body first, routing block appended at the end with a blank-line separator. Keeping the
// block at the tail means a human appending notes to the body never has to scroll past machinery.
function compose(body, cursor) {
  const trimmed = String(body).replace(/\s*$/, "");
  return `${trimmed}\n\n${renderRoutingBlock(cursor)}\n`;
}

// readState: { body, cursor }. Materializes nothing on disk; just reports what is there (or the
// clean-slate default body + epoch 0 if the file is absent).
export function readState(repo) {
  const p = statePath(repo);
  if (!existsSync(p)) return { body: defaultBody(), cursor: { turn: null, epoch: 0 } };
  let text = "";
  try { text = readFileSync(p, "utf8"); } catch { text = ""; }
  return { body: splitBody(text), cursor: parseRouting(text) };
}

// writeCursor: the ONLY routing-mutating primitive. Epoch-guarded: the write must carry
// nextCursor.epoch === currentEpoch+1 or it is rejected and NOTHING is written (fail-closed).
// The work-state body is read fresh and preserved; only the routing block is replaced.
// Returns { ok, epoch } on success or { ok:false, reason, currentEpoch } on rejection.
export function writeCursor(repo, nextCursor, { commitMsg } = {}) {
  const p = statePath(repo);
  const current = readState(repo); // fresh read: never write against a stale in-memory epoch
  const currentEpoch = current.cursor.epoch;
  if (!commitAccepted(nextCursor.epoch, currentEpoch)) {
    return { ok: false, reason: "stale-epoch", currentEpoch, attempted: nextCursor.epoch };
  }
  const doc = compose(current.body, { turn: nextCursor.turn ?? null, epoch: nextCursor.epoch });
  writeAtomic(p, doc);
  commitState(repo, commitMsg || `baton: route turn -> ${nextCursor.turn ?? "park"} @epoch ${nextCursor.epoch}`);
  return { ok: true, epoch: nextCursor.epoch, turn: nextCursor.turn ?? null };
}

// initState: materialize LOOP-STATE.md if absent, with the default body and an epoch-0 parked
// cursor. Idempotent: if the file already exists it is left untouched. This is a NON-reassigning
// write (epoch stays 0), so it does not consume the monotonic sequence.
export function initState(repo) {
  const p = statePath(repo);
  if (existsSync(p)) return { ok: true, created: false };
  const doc = compose(defaultBody(), { turn: null, epoch: 0 });
  writeAtomic(p, doc);
  commitState(repo, "baton: init LOOP-STATE");
  return { ok: true, created: true };
}

// tick: ONE loop step. Pulls the live roster (dead leases have already dropped out in presence-io),
// then:
//   - if the current holder's lease is NOT live -> reclaim() picks the next live role (epoch+1).
//   - else advanceTurn() rotates to the next live role in rank order (epoch+1).
// Either way the result is written through the epoch-guarded writeCursor, so a concurrent stale
// writer cannot win. Returns the routing decision (and whether it landed).
//   nowUtc is injected so tests are deterministic; presence liveness is judged at that instant.
export function tick(repo, { nowUtc = new Date().toISOString() } = {}) {
  const roster = liveRoster(repo, { nowUtc });
  const { cursor } = readState(repo);

  if (roster.length === 0) {
    // No live roles: park. Parking is non-reassigning (no epoch bump, no churn).
    return { acted: false, reason: "empty-roster-park", roster, holder: cursor.turn, epoch: cursor.epoch };
  }

  // Liveness oracle bound to this instant, fed to the pure reclaim().
  const leases = allLeases(repo);
  const isLiveFn = (role) => leases.some((l) => l.role === role && isLive(l, nowUtc));

  // Decide: reclaim a dead/absent holder, else advance a live one. Both bump epoch by 1.
  let decision = reclaim(cursor, roster, isLiveFn);
  let kind = "reclaim";
  if (!decision) {
    const adv = advanceTurn(cursor.turn, roster, cursor.epoch);
    decision = { turn: adv.nextHolder, epoch: adv.newEpoch, reason: adv.reason };
    kind = "advance";
  }
  if (!decision || !decision.turn) {
    return { acted: false, reason: "no-live-target", roster, holder: cursor.turn, epoch: cursor.epoch };
  }

  const res = writeCursor(repo, { turn: decision.turn, epoch: decision.epoch }, {
    commitMsg: `baton: ${kind} turn -> ${decision.turn} @epoch ${decision.epoch}`,
  });
  return {
    acted: res.ok,
    kind,
    reason: decision.reason,
    from: cursor.turn,
    to: decision.turn,
    fromEpoch: cursor.epoch,
    toEpoch: decision.epoch,
    write: res,
    roster,
  };
}

// commitState: stage and commit ONLY LOOP-STATE.md with an explicit pathspec, so the routing
// commit never sweeps in an unrelated dirty tree (and never collides with presence/*.lease.json,
// which is committed separately by presence-io). No-op-clean is treated as success.
function commitState(repo, msg) {
  const add = gitQuiet(["add", "--", STATE_FILE], repo);
  if (!add.ok) return;
  gitQuiet(["commit", "-m", msg, "--", STATE_FILE], repo);
  gitQuiet(["push"], repo); // offline: local commit stands
}
