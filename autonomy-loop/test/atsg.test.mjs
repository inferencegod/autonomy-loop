import { test } from "node:test";
import assert from "node:assert/strict";
import { decideAcceptanceStrength } from "../hooks/atsg.mjs";

const M = (o) => ({ mutantId: "m", lineNo: 1, viable: true, killedByAcceptanceTest: false, timedOut: false, buildError: false, ...o });

test("AC2/3: a test that kills >=1 viable mutant -> pass(0)", () => {
  const r = decideAcceptanceStrength({ mutantResults: [M({ killedByAcceptanceTest: true }), M({})], assertionStrong: true });
  assert.equal(r.pass, 0);
  assert.equal(r.killed, 1);
});

test("AC: a test that kills ZERO mutants -> too-weak(1) -> PARK", () => {
  const r = decideAcceptanceStrength({ mutantResults: [M({}), M({})], assertionStrong: true });
  assert.equal(r.pass, 1);
  assert.equal(r.reason, "acceptance-test-pins-nothing");
});

test("weak assertion (even if it kills) -> too-weak(1)", () => {
  const r = decideAcceptanceStrength({ mutantResults: [M({ killedByAcceptanceTest: true })], assertionStrong: false });
  assert.equal(r.pass, 1);
  assert.equal(r.reason, "weak-assertion-not-acceptance-strength");
});

test("equivalent mutants excluded from denominator; no viable -> cannot-verify(2)", () => {
  const r = decideAcceptanceStrength({ mutantResults: [M({ viable: false }), M({ viable: false })] });
  assert.equal(r.pass, 2);
  assert.equal(r.reason, "no-viable-mutants");
});

test("all mutants timed out -> timeout counts as killed -> pass", () => {
  const r = decideAcceptanceStrength({ mutantResults: [M({ timedOut: true })], assertionStrong: true });
  assert.equal(r.pass, 0); // timeout = killed
});

test("all mutants build-errored (no clean outcome) -> cannot-verify(2)", () => {
  const r = decideAcceptanceStrength({ mutantResults: [M({ buildError: true }), M({ buildError: true })] });
  assert.equal(r.pass, 2);
  assert.equal(r.reason, "all-mutants-inconclusive");
});

test("fail-closed: missing results -> cannot-verify(2)", () => {
  assert.equal(decideAcceptanceStrength({}).pass, 2);
  assert.equal(decideAcceptanceStrength(null).pass, 2);
});

test("requireKills configurable: needs 2, only 1 killed -> too-weak", () => {
  const r = decideAcceptanceStrength({ mutantResults: [M({ killedByAcceptanceTest: true }), M({})], requireKills: 2, assertionStrong: true });
  assert.equal(r.pass, 1);
});
