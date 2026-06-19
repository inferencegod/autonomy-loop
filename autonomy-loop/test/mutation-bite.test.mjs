import test from "node:test";
import assert from "node:assert/strict";
import { decideMutationBite } from "../hooks/mutation-bite.mjs";

test("a covered, viable, killed mutant -> exit 0 and the kill is recorded", () => {
  const r = decideMutationBite({ mutantResults: [{ lineNo: 42, op: ">=->>", covered: true, viable: true, killedByTest: true }] });
  assert.equal(r.exit, 0);
  assert.equal(r.killed.length, 1);
});

test("all viable+covered mutants survive -> exit 1 (the test pins nothing)", () => {
  assert.equal(decideMutationBite({ mutantResults: [{ covered: true, viable: true, killedByTest: false }] }).exit, 1);
});

test("zero viable+covered -> exit 2 cannot-verify; no results -> exit 2", () => {
  assert.equal(decideMutationBite({ mutantResults: [{ viable: false }, { covered: false }] }).exit, 2);
  assert.equal(decideMutationBite({}).exit, 2);
});

test("a timeout counts as a kill; a test with no live assertion -> exit 1 before mutation", () => {
  assert.equal(decideMutationBite({ mutantResults: [{ covered: true, viable: true, timedOut: true }] }).exit, 0);
  assert.equal(decideMutationBite({ assertionLiveness: false, mutantResults: [{ covered: true, viable: true, killedByTest: true }] }).exit, 1);
});

test("GLOBAL fail-closed invariant: never exit 0 without a recorded killed mutant (4000-iteration fuzz)", () => {
  let bad = 0;
  for (let i = 0; i < 4000; i++) {
    const n = Math.floor(Math.random() * 5);
    const mr = Array.from({ length: n }, () => ({ lineNo: (Math.random() * 100) | 0, covered: Math.random() < 0.7, viable: Math.random() < 0.7, killedByTest: Math.random() < 0.5, timedOut: Math.random() < 0.2, buildError: Math.random() < 0.3 }));
    const r = decideMutationBite({ mutantResults: mr });
    if (r.exit === 0 && r.killed.length === 0) bad++;
  }
  assert.equal(bad, 0);
});
