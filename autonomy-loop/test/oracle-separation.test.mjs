import { test } from "node:test";
import assert from "node:assert/strict";
import { checkSeparation } from "../hooks/oracle-separation.mjs";

const A = (spec, test_, impl, rev) => ({ specAuthor: { family: spec }, testAuthor: { family: test_ }, implementer: { family: impl }, reviewer: { family: rev } });

test("AC2: additive spec runs single-family + floor, no cross-family required", () => {
  const r = checkSeparation(A("opus", "opus", "opus", "opus"), { tier: "additive" });
  assert.equal(r.ok, true);
  assert.equal(r.park, false);
});

test("AC1: money-path spec, test author SAME family as implementer -> park", () => {
  const r = checkSeparation(A("opus", "gemini", "gemini", "gpt"), { tier: "money-path" });
  // testF=gemini == implF=gemini -> park
  assert.equal(r.park, true);
  assert.equal(r.reason, "test-author-same-family-as-implementer");
});

test("money-path, test author same family as spec -> park", () => {
  const r = checkSeparation(A("opus", "opus", "gemini", "gpt"), { tier: "money-path" });
  assert.equal(r.park, true);
  assert.equal(r.reason, "test-author-same-family-as-spec");
});

test("money-path with proper cross-family separation -> ok", () => {
  const r = checkSeparation(A("opus", "gemini", "opus", "opus"), { tier: "money-path" });
  // testF=gemini != specF=opus and != implF=opus -> ok
  assert.equal(r.ok, true);
  assert.equal(r.park, false);
});

test("irreversible treated like money-path", () => {
  const r = checkSeparation(A("opus", "opus", "opus", "opus"), { tier: "irreversible" });
  assert.equal(r.park, true);
});

test("AC3: plateau guard - too many distinct families -> park", () => {
  const asg = { specAuthor: { family: "a" }, testAuthor: { family: "b" }, implementer: { family: "c" }, reviewer: { family: "d" } };
  const r = checkSeparation(asg, { tier: "money-path", maxVoters: 3 });
  assert.equal(r.park, true);
  assert.equal(r.reason, "too-many-voters-diminishing-returns");
});

test("fail-closed: missing assignment -> park", () => {
  assert.equal(checkSeparation(null, { tier: "money-path" }).park, true);
  assert.equal(checkSeparation(A("opus", null, "opus"), { tier: "money-path" }).park, true);
});
