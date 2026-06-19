import test from "node:test";
import assert from "node:assert/strict";
import { planHardening, isDirTarget, pluginHooksDir } from "../hooks/harden-control-plane.mjs";
import { join } from "node:path";

const PP = ["test/__snapshots__/", "test/golden/", "autonomy.config.json", ".autonomy-coverage.json"];

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
