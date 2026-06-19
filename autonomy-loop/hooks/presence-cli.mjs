#!/usr/bin/env node
// hooks/presence-cli.mjs - the "sign-in clipboard" the command prompts use (presence-to-trigger).
// A launched role terminal SIGNS IN each tick; the router reads who is live. Leases live under the repo's
// SHARED git-common-dir (<gitdir>/autonomy-presence/), so every git worktree of the loop on this machine sees
// the same roster WITHOUT committing anything (no history noise, no pull lag) and WITHOUT touching the working
// tree or the read-only control plane. TTL is passed as an arg so this never references a control-plane file.
// Liveness is the unit-tested pure core in presence.mjs.
//   node hooks/presence-cli.mjs signin <role> --ttl=<seconds> [--now=<iso>] [--dir=<path>]
//   node hooks/presence-cli.mjs roster [--now=<iso>] [--dir=<path>]
//   node hooks/presence-cli.mjs is-live <role> [--now=<iso>] [--dir=<path>]
import { writeFileSync, readFileSync, readdirSync, existsSync, mkdirSync, renameSync } from "node:fs";
import { join, isAbsolute } from "node:path";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { roster as liveRoster } from "./presence.mjs";

const KNOWN = ["builder", "reviewer", "planner", "researcher"];

// The shared lease dir: the git-common-dir is the ONE place every worktree of this repo agrees on, on this
// machine, so a sign-in in the builder's worktree is seen from the reviewer's worktree with no commit/pull.
function presenceDir(args) {
  if (typeof args.dir === "string" && args.dir) { mkdirSync(args.dir, { recursive: true }); return args.dir; }
  let common = ".git";
  try { common = execSync("git rev-parse --git-common-dir", { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim() || ".git"; } catch { /* not a repo */ }
  const base = isAbsolute(common) ? common : join(process.cwd(), common);
  const d = join(base, "autonomy-presence");
  mkdirSync(d, { recursive: true });
  return d;
}
function readLeases(dir) {
  if (!existsSync(dir)) return [];
  const out = [];
  for (const f of readdirSync(dir)) {
    if (!f.endsWith(".lease.json")) continue;
    try { out.push(JSON.parse(readFileSync(join(dir, f), "utf8"))); } catch { /* skip corrupt */ }
  }
  return out;
}
function parseArgs(argv) {
  const a = { _: [] };
  for (const x of argv) { const m = x.match(/^--([^=]+)=(.*)$/); if (m) a[m[1]] = m[2]; else if (x.startsWith("--")) a[x.slice(2)] = true; else a._.push(x); }
  return a;
}
function signin(dir, role, ttl, now) {
  const lease = { role, heartbeatUtc: now, ttlSeconds: ttl, signedInBy: "presence-cli" };
  const target = join(dir, `${role}.lease.json`);
  const tmp = `${target}.tmp-${process.pid}`;
  writeFileSync(tmp, JSON.stringify(lease, null, 2) + "\n");
  renameSync(tmp, target);
  return target;
}
function main(argv) {
  const args = parseArgs(argv.slice(2));
  const cmd = args._[0];
  const now = typeof args.now === "string" && args.now ? args.now : new Date().toISOString();
  const dir = presenceDir(args);
  if (cmd === "signin") {
    const role = args._[1];
    if (!KNOWN.includes(role)) { console.error(`presence-cli: unknown role '${role}'. one of: ${KNOWN.join(", ")}`); process.exit(2); }
    const ttl = Number(args.ttl);
    if (!Number.isFinite(ttl) || ttl <= 0) { console.error("presence-cli: signin needs --ttl=<positive seconds>"); process.exit(2); }
    console.log(`signed in: ${role} (ttl ${ttl}s) -> ${signin(dir, role, ttl, now)}`);
    return;
  }
  if (cmd === "roster") { for (const r of liveRoster(readLeases(dir), now)) console.log(r); return; }
  if (cmd === "is-live") { process.exit(liveRoster(readLeases(dir), now).includes(args._[1]) ? 0 : 1); }
  console.error("presence-cli: usage: signin <role> --ttl=N | roster | is-live <role>  [--now=ISO] [--dir=PATH]");
  process.exit(2);
}
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main(process.argv);
