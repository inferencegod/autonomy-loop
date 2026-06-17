// Tests for the self-mutation gate. maskCode protects strings/comments; mutantsForLine applies one
// text-level operator to a changed line (multi-char before single, integers not floats, arid skipped);
// decideMutation scores killed/survived/unviable with timeout=killed and an allowlist for equivalents.
// Run: node --test test/mutate.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { maskCode, mutantsForLine, decideMutation } from "../hooks/mutate.mjs";

const first = (line) => { const m = mutantsForLine(line); return m[0] || null; };

// ---- maskCode ----

test("maskCode preserves length and blanks string + comment content", () => {
  const s = 'a < "x > y" // z >= w';
  const m = maskCode(s);
  assert.equal(m.length, s.length);
  assert.ok(m.includes("a < "));            // the real operator survives
  assert.ok(!m.slice(4).includes(">"));     // every > here lives inside the string or comment, masked
});

// ---- mutantsForLine ----

test("mutates a real relational operator (boundary)", () => {
  const f = first("if (a < b) {");
  assert.equal(f.op, "rel-boundary");
  assert.equal(f.before, "<");
  assert.equal(f.after, "<=");
  assert.equal(f.mutated, "if (a <= b) {");
});

test("multi-char operator is mutated before its single-char prefix", () => {
  const f = first("while (i <= n) {");
  assert.equal(f.before, "<=");
  assert.equal(f.after, "<");
});

test("strict equality flips to not-equal", () => {
  assert.equal(first("return x === y;").after, "!==");
});

test("NEVER mutates an operator inside a string literal", () => {
  assert.equal(first('const s = "a < b";'), null);     // the only < lives in the string
  const f = first('if (x === "a===b") {');
  assert.equal(f.op, "eq-strict");
  assert.equal(f.index, 6);                              // the real ===, not the one in the string
});

test("NEVER mutates inside a comment", () => {
  assert.equal(first("const n = fn(); // a < b && c"), null);
});

test("arid lines (imports, logging, comments) are skipped", () => {
  assert.deepEqual(mutantsForLine("import x from './y.js';"), []);
  assert.deepEqual(mutantsForLine("console.log(a < b);"), []);
  assert.deepEqual(mutantsForLine("// if (a < b)"), []);
});

test("off-by-one hits integers, never floats", () => {
  const f = first("return arr.slice(3);");
  assert.equal(f.op, "off-by-one");
  assert.equal(f.after, "4");
  assert.equal(first("const y = 2.5;"), null);          // float not mutated, '=' is not an operator
});

test("logical and boolean operators", () => {
  assert.equal(first("if (a && b) {").after, "||");
  assert.equal(first("const ok = true;").after, "false");
});

// ---- decideMutation ----

const R = (outcome, line = 1, op = "rel-boundary") => ({ file: "a.js", line, op, before: "<", after: "<=", outcome });

test("all mutants killed -> pass", () => {
  const r = decideMutation([R("killed", 1), R("killed", 2)]);
  assert.equal(r.ok, true);
  assert.equal(r.action, "all-killed");
  assert.equal(r.killed, 2);
});

test("a survivor -> fail, and it is listed", () => {
  const r = decideMutation([R("killed", 1), R("survived", 2)]);
  assert.equal(r.ok, false);
  assert.equal(r.action, "survivors");
  assert.equal(r.survived.length, 1);
});

test("timeout counts as killed, not a survivor", () => {
  const r = decideMutation([R("timeout", 1), R("killed", 2)]);
  assert.equal(r.action, "all-killed");
  assert.equal(r.killed, 2);
});

test("unviable mutants are excluded from the denominator", () => {
  const r = decideMutation([R("unviable", 1), R("unviable", 2)]);
  assert.equal(r.action, "no-op");
  assert.equal(r.unviable, 2);
});

test("the allowlist suppresses a confirmed-equivalent survivor", () => {
  const r = decideMutation([R("survived", 7)], { allow: ["a.js:7:rel-boundary"] });
  assert.equal(r.ok, true);
  assert.equal(r.action, "no-op");
});

test("deterministic", () => {
  const a = decideMutation([R("killed", 1), R("survived", 2)]);
  const b = decideMutation([R("killed", 1), R("survived", 2)]);
  assert.deepEqual(a, b);
});
