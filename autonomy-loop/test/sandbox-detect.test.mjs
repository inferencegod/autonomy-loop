import test from "node:test";
import assert from "node:assert/strict";
import { readsSandboxLive } from "../hooks/sandbox-detect.mjs";

// Pure core only (readsSandboxLive). The impure sandboxLive() default export reads real fs/env and is
// exercised by the integration check in /tmp; the unit contract is fail-closed truth-table behavior.

test("fail-closed: no markers, no probes -> false", () => {
  assert.equal(readsSandboxLive({}, {}), false);
  assert.equal(readsSandboxLive(), false);
});

test("AUTONOMY_SANDBOX=1 (and truthy variants) -> true", () => {
  for (const v of ["1", "true", "TRUE", "yes", "on", " 1 "]) {
    assert.equal(readsSandboxLive({ AUTONOMY_SANDBOX: v }, {}), true, "truthy: " + JSON.stringify(v));
  }
});

test("AUTONOMY_SANDBOX falsey / junk -> false (fail-closed)", () => {
  for (const v of ["0", "false", "", "no", "off", "maybe", "2"]) {
    assert.equal(readsSandboxLive({ AUTONOMY_SANDBOX: v }, {}), false, "falsey: " + JSON.stringify(v));
  }
});

test("srt / sandbox-runtime env breadcrumbs -> true", () => {
  assert.equal(readsSandboxLive({ SRT_ACTIVE: "1" }, {}), true);
  assert.equal(readsSandboxLive({ SANDBOX_RUNTIME: "true" }, {}), true);
  assert.equal(readsSandboxLive({ SBX_SANDBOX: "yes" }, {}), true);
  assert.equal(readsSandboxLive({ SANDBOX_BACKEND: "srt" }, {}), true);   // non-empty backend string
  assert.equal(readsSandboxLive({ SANDBOX_BACKEND: "" }, {}), false);     // empty backend is not evidence
});

test("srtMarker probe -> true; bare container indicators are NOT sufficient -> false", () => {
  assert.equal(readsSandboxLive({}, { srtMarker: true }), true);
  // A docker/cgroup signal alone does not prove the control plane is out of write reach: fail-closed false.
  assert.equal(readsSandboxLive({}, { dockerenv: true }), false);
  assert.equal(readsSandboxLive({}, { cgroup: "0::/docker/abc" }), false);
  assert.equal(readsSandboxLive({}, { dockerenv: true, cgroup: "0::/docker/abc" }), false);
});

test("a container indicator PLUS the wrapper attestation -> true (the intended hardened launch)", () => {
  assert.equal(readsSandboxLive({ AUTONOMY_SANDBOX: "1" }, { dockerenv: true }), true);
});

test("malformed inputs never throw, always fail-closed", () => {
  assert.equal(readsSandboxLive(null, null), false);
  assert.equal(readsSandboxLive(undefined, undefined), false);
  assert.equal(readsSandboxLive(42, "x"), false);
});
