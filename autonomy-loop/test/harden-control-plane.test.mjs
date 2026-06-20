import test from "node:test";
import assert from "node:assert/strict";
import { planHardening, isDirTarget, pluginHooksDir } from "../hooks/harden-control-plane.mjs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync, accessSync, rmSync, constants as fsConstants } from "node:fs";
import { tmpdir } from "node:os";

const PP = ["test/__snapshots__/", "test/golden/", "autonomy.config.json", ".autonomy-coverage.json"];

// Absolute path to the runner module, resolved from this test file (mirrors how the prod hook is invoked).
const HOOK = fileURLToPath(new URL("../hooks/harden-control-plane.mjs", import.meta.url));

test("plan resolves every protectedPaths entry relative to repoRoot, in declared order", () => {
  const { targets } = planHardening({ protectedPaths: PP }, { repoRoot: "/repo", pluginHooks: "/repo/hooks" });
  const paths = targets.map((t) => t.path);
  // Entries are resolved with path.join, so expectations use join too: this stays correct on BOTH
  // POSIX (/repo/...) and Windows (\repo\...). The four declared entries come first, in declared order.
  assert.deepEqual(paths.slice(0, 4), [
    join("/repo", "test/__snapshots__/"), join("/repo", "test/golden/"),
    join("/repo", "autonomy.config.json"), join("/repo", ".autonomy-coverage.json"),
  ]);
});

test("the plugin hooks dir is ALWAYS included, last, even if protectedPaths is empty", () => {
  const { targets } = planHardening({ protectedPaths: [] }, { repoRoot: "/repo", pluginHooks: "/plugin/hooks" });
  assert.equal(targets.length, 1);
  assert.equal(targets[0].path, "/plugin/hooks");
  assert.equal(targets[0].source, "pluginHooks");
});

test("missing protectedPaths key still locks the plugin hooks dir (fail-closed default coverage)", () => {
  const { targets } = planHardening({}, { repoRoot: "/repo", pluginHooks: "/plugin/hooks" });
  assert.equal(targets.length, 1);
  assert.equal(targets[0].source, "pluginHooks");
});

test("blank / non-string entries are dropped, never emitted as an unnameable target", () => {
  const { targets } = planHardening({ protectedPaths: ["", "  ", null, 7, "real.json"] }, { repoRoot: "/repo", pluginHooks: "/plugin/hooks" });
  const sources = targets.map((t) => t.source);
  // join() for the re-rooted entry (platform-native); the absolute pluginHooks is passed through as-is.
  assert.deepEqual(targets.map((t) => t.path), [join("/repo", "real.json"), "/plugin/hooks"]);
  assert.deepEqual(sources, ["protectedPaths", "pluginHooks"]);
});

test("absolute protectedPaths entries are passed through, not re-rooted", () => {
  const { targets } = planHardening({ protectedPaths: ["/etc/secret.json"] }, { repoRoot: "/repo", pluginHooks: "/plugin/hooks", platform: "linux" });
  assert.equal(targets[0].path, "/etc/secret.json");
});

test("de-dupe: the same resolved path (declared twice, or equal to the hooks dir) is locked once", () => {
  const { targets } = planHardening(
    { protectedPaths: ["dup", "dup", "/plugin/hooks"] },
    { repoRoot: "/repo", pluginHooks: "/plugin/hooks" }
  );
  const paths = targets.map((t) => t.path);
  assert.deepEqual(paths, [join("/repo", "dup"), "/plugin/hooks"]); // dup once; hooks dir not duplicated
});

test("isDirTarget: trailing slash => dir, otherwise file", () => {
  assert.equal(isDirTarget("test/golden/"), true);
  assert.equal(isDirTarget("test\\snap\\"), true);
  assert.equal(isDirTarget("autonomy.config.json"), false);
  assert.equal(isDirTarget(""), false);
  assert.equal(isDirTarget(null), false);
});

test("pluginHooksDir resolves to an absolute path with no trailing separator", () => {
  const d = pluginHooksDir();
  assert.equal(typeof d, "string");
  assert.ok(d.length > 0);
  assert.ok(!/[\\/]$/.test(d), "no trailing separator");
});

test("INVARIANT: every emitted target has a non-empty path and a known source", () => {
  const { targets } = planHardening({ protectedPaths: PP }, { repoRoot: "/repo", pluginHooks: "/plugin/hooks" });
  for (const t of targets) {
    assert.ok(typeof t.path === "string" && t.path.length > 0);
    assert.ok(t.source === "protectedPaths" || t.source === "pluginHooks");
  }
});

// ---- unlock plan parity + runner round-trip (R4) ----

test("UNLOCK plan == LOCK plan: both walk the SAME planHardening targets (no separate unlock target logic)", () => {
  // The runner derives the unlock set from the identical planHardening call it uses for lock, so the set a
  // --unlock pass touches is byte-identical to what a lock pass touches. We assert planHardening is the single
  // source of truth: same inputs -> same ordered targets, every time (deterministic), so lock and unlock match.
  const opts = { repoRoot: "/repo", pluginHooks: "/plugin/hooks", platform: "linux" };
  const a = planHardening({ protectedPaths: PP }, opts);
  const b = planHardening({ protectedPaths: PP }, opts);
  assert.deepEqual(a.targets, b.targets, "planHardening is deterministic, so lock and unlock cover the same set");
  // And it is non-empty (always includes the plugin hooks dir), so unlock is never a silent no-op-by-omission.
  assert.ok(a.targets.length >= 1);
  assert.equal(a.targets[a.targets.length - 1].source, "pluginHooks");
});

// POSIX-only: chmod/chattr round-trip via the actual runner. Skipped on win32 (icacls deny/remove differs and
// CI may run Windows). Also skipped if running as root, where chmod 0444 does not block the owner's own write
// (root bypasses the permission bit), so "not writable after lock" cannot be asserted honestly.
const ROUNDTRIP_OK = process.platform !== "win32" && typeof process.getuid === "function" && process.getuid() !== 0;

test("runner round-trip: lock makes a file read-only, --unlock makes it writable again (POSIX, non-root)", { skip: ROUNDTRIP_OK ? false : "POSIX-non-root only" }, () => {
  const dir = mkdtempSync(join(tmpdir(), "harden-rt-"));
  try {
    const cfgPath = join(dir, "autonomy.config.json");
    // The config lists itself as a protectedPath so the runner locks exactly this file (plus the plugin hooks
    // dir, which we do not assert on here). repoRoot=dir keeps the relative entry resolving inside the scratch.
    writeFileSync(cfgPath, JSON.stringify({ protectedPaths: ["autonomy.config.json"] }) + "\n");

    const lock = spawnSync(process.execPath, [HOOK, `--repoRoot=${dir}`, `--config=${cfgPath}`], { encoding: "utf8" });
    assert.equal(lock.status, 0, `lock should exit 0; stderr=${lock.stderr}`);
    assert.throws(() => accessSync(cfgPath, fsConstants.W_OK), "config must NOT be writable after lock");

    const unlock = spawnSync(process.execPath, [HOOK, "--unlock", `--repoRoot=${dir}`, `--config=${cfgPath}`], { encoding: "utf8" });
    assert.equal(unlock.status, 0, `unlock should exit 0; stderr=${unlock.stderr}`);
    assert.doesNotThrow(() => accessSync(cfgPath, fsConstants.W_OK), "config MUST be writable after --unlock");

    // The point of the unlock: the migrate hooks can now rewrite the locked config.
    assert.doesNotThrow(() => writeFileSync(cfgPath, JSON.stringify({ protectedPaths: ["autonomy.config.json"], migrated: true }) + "\n"));
    assert.equal(JSON.parse(readFileSync(cfgPath, "utf8")).migrated, true);
  } finally {
    // best-effort cleanup: re-unlock so rmSync can remove a possibly-relocked tree, then remove.
    spawnSync(process.execPath, [HOOK, "--unlock", `--repoRoot=${dir}`, `--config=${join(dir, "autonomy.config.json")}`], { encoding: "utf8" });
    rmSync(dir, { recursive: true, force: true });
  }
});
