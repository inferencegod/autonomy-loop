import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyOracle, decideAssertionGate } from "../hooks/assert-classify.mjs";

test("AC: W1 no assertion", () => {
  assert.equal(classifyOracle(["const x = add(1,2);", "doThing(x);"]).category, "W1");
});
test("AC: tautological/boolean-only -> W3, fails gate", () => {
  assert.equal(classifyOracle(["assert True"]).category, "W3");
  assert.equal(classifyOracle(["expect(ok).toBeTruthy()"]).category, "W3");
  assert.equal(decideAssertionGate(["assert True"]).pass, false);
});
test("AC: existence-only -> W2", () => {
  assert.equal(classifyOracle(["expect(result).toBeDefined()"]).category, "W2");
  assert.equal(classifyOracle(["self.assertIsNotNone(x)"]).category, "W2");
});
test("AC: mock-only -> W4", () => {
  assert.equal(classifyOracle(["expect(fn).toHaveBeenCalled()"]).category, "W4");
  assert.equal(classifyOracle(["mock.assert_called_once()"]).category, "W4");
});
test("AC: snapshot-only -> W5", () => {
  assert.equal(classifyOracle(["expect(tree).toMatchSnapshot()"]).category, "W5");
});
test("AC: value equality -> S1, passes gate", () => {
  assert.equal(classifyOracle(["expect(add(1,2)).toBe(3)"]).category, "S1");
  assert.equal(classifyOracle(["assert x == 42"]).category, "S1");
  assert.equal(classifyOracle(["if got != want {"]).category, "S1");
  assert.equal(decideAssertionGate(["expect(add(1,2)).toBe(3)"]).pass, true);
});
test("AC: error/containment -> S2", () => {
  assert.equal(classifyOracle(["expect(() => f()).toThrow('bad')"]).category, "S2");
  assert.equal(classifyOracle(["with pytest.raises(ValueError):"]).category, "S2");
  assert.equal(classifyOracle(["expect(list).toContain(5)"]).category, "S2");
});
test("AC: two strong types -> S3", () => {
  const r = classifyOracle(["expect(x).toBe(3)", "expect(() => g()).toThrow()"]);
  assert.equal(r.category, "S3");
  assert.equal(r.strong, true);
});
test("gate floor configurable (require S2)", () => {
  assert.equal(decideAssertionGate(["expect(x).toBe(3)"], { minCategory: "S2" }).pass, false); // S1 < S2
  assert.equal(decideAssertionGate(["expect(()=>f()).toThrow()"], { minCategory: "S2" }).pass, true);
});
test("classifier accuracy on a 12-case labeled set >= 85%", () => {
  const labeled = [
    [["assert True"], false], [["expect(x).toBeTruthy()"], false], [["expect(x).toBeDefined()"], false],
    [["mock.assert_called()"], false], [["expect(t).toMatchSnapshot()"], false], [["// no assert"], false],
    [["expect(add(1,2)).toBe(3)"], true], [["assert x == 5"], true], [["if got != want {"], true],
    [["expect(()=>f()).toThrow()"], true], [["with pytest.raises(E):"], true], [["expect(l).toContain(2)"], true],
  ];
  let correct = 0;
  for (const [lines, isStrong] of labeled) if (classifyOracle(lines).strong === isStrong) correct++;
  assert.ok(correct / labeled.length >= 0.85, `accuracy ${correct}/${labeled.length}`);
});
