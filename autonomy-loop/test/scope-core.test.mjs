import test from "node:test";
import assert from "node:assert/strict";
import { decideScope } from "../hooks/scope-core.mjs";

test("no ceiling -> continue; under the ceiling -> continue", () => {
  assert.equal(decideScope({ ceiling: {}, current: { files: 99 } }).action, "continue");
  assert.equal(decideScope({ ceiling: { maxFiles: 10 }, current: { files: 4 } }).action, "continue");
});

test("warn band (>= 80% of a ceiling), then handoff when over", () => {
  assert.equal(decideScope({ ceiling: { maxLines: 100 }, current: { lines: 85 } }).action, "warn");
  assert.equal(decideScope({ ceiling: { maxFiles: 10 }, current: { files: 11 } }).action, "handoff");
});

test("fail-closed: a ceiling set with no measurement -> handoff (cannot prove you are under it)", () => {
  assert.equal(decideScope({ ceiling: { maxFiles: 5 }, current: {} }).action, "handoff");
});

test("any single metric over the ceiling forces a handoff", () => {
  assert.equal(decideScope({ ceiling: { maxFiles: 10, maxNewPublicSymbols: 3 }, current: { files: 2, newPublicSymbols: 9 } }).action, "handoff");
});
