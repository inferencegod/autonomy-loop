// autonomy-loop: assert-classify (Spec B5). Pure static detector of weak vs strong test oracles,
// implementing the "All Smoke, No Alarm" taxonomy (arXiv:2606.18168): W1 no assertion, W2
// existence/non-null only, W3 boolean-only (no value compared), W4 mock/call-verification only,
// W5 snapshot-only; S1 value equality/comparison, S2 error/containment/type checks, S3 >=2 distinct
// strong types. HARD GATE in the loop: W1-W5 fails, require >=S1. Language-agnostic-ish: covers
// pytest, Jest/Vitest, JUnit/AssertJ, Go testing, RSpec. No I/O, no deps. (Operates on ADDED lines.)

// Strong VALUE assertions (S1): an asserted value is compared to an expected value.
const S1_PATTERNS = [
  /\bassert\s+\w[\w.\[\]()]*\s*==\s*.+/, // python: assert x == y
  /\bassertEqual\s*\(/i, /\bassertEquals\s*\(/i, /\bassertSame\s*\(/i,
  /\bexpect\s*\(.*\)\s*\.\s*(toBe|toEqual|toStrictEqual|toBeCloseTo|toHaveLength|toHaveBeenCalledWith)\s*\(/,
  /\bassert\.(equal|deepEqual|strictEqual|deepStrictEqual)\s*\(/,
  /\bassert\.That\s*\(.+,\s*Is\.EqualTo/i, // assertj/nunit-ish
  /\bif\s+got\s*!=\s*want\b/, /\bif\s+\w+\s*!=\s*expected\b/, // go: if got != want
  /\bexpect\s*\([^)]*\)\.to\s+eq\b/, // rspec
  /\bassertThat\s*\([^)]*\)\.isEqualTo\s*\(/, // assertj
];

// Strong ERROR/CONTAINMENT/TYPE assertions (S2).
const S2_PATTERNS = [
  /\bassertRaises\b/i, /\bpytest\.raises\b/, /\bexpect\s*\(.*\)\.toThrow\s*\(/, /\.rejects\.toThrow/,
  /\bassertThrows\b/i, /\bexpect\s*\(.*\)\.toContain\s*\(/, /\bassertIn\b/, /\bassertContains\b/i,
  /\bassertIsInstance\b/, /\bexpect\s*\(.*\)\.toBeInstanceOf\s*\(/, /\bassert\.throws\b/,
  /\bexpect\s*\(.*\)\.toMatch\s*\(/, /\bassertRegex\b/i,
];

// WEAK: boolean-only (W3) - asserts truthiness without comparing a value.
const W3_PATTERNS = [
  /\bassert\s+(True|False)\b/, /\bassertTrue\s*\(/i, /\bassertFalse\s*\(/i,
  /\bexpect\s*\([^)]*\)\.toBeTruthy\s*\(\)/, /\bexpect\s*\([^)]*\)\.toBeFalsy\s*\(\)/,
  /\bassert\s+\w+\s*$/, // assert x   (bare truthiness)
  /\bassert\.ok\s*\(/,
];
// W2: existence / non-null only.
const W2_PATTERNS = [
  /\bassertIsNotNone\b/, /\bassertIsNone\b/, /\bexpect\s*\([^)]*\)\.toBeDefined\s*\(\)/,
  /\bexpect\s*\([^)]*\)\.toBeNull\s*\(\)/, /\bexpect\s*\([^)]*\)\.not\.toBeNull\s*\(\)/,
  /\bassertNotNull\b/i, /\bassert\s+\w+\s+is\s+not\s+None\b/,
];
// W4: mock / call verification only.
const W4_PATTERNS = [
  /\bexpect\s*\([^)]*\)\.toHaveBeenCalled\s*\(\)/, /\.assert_called\b/, /\.assert_called_once\b/,
  /\bverify\s*\(/, /\bexpect\s*\([^)]*\)\.toHaveBeenCalledTimes\s*\(/,
];
// W5: snapshot only.
const W5_PATTERNS = [
  /\.toMatchSnapshot\s*\(\)/, /\.toMatchInlineSnapshot\s*\(/, /\bapprovals?\.verify\b/i,
];

function anyMatch(lines, patterns) {
  return lines.some((ln) => patterns.some((re) => re.test(ln)));
}

// classifyOracle(addedLines: string[] | string) -> { category: 'W1'..'S3', strong: bool, signals }
export function classifyOracle(added) {
  const lines = Array.isArray(added) ? added : String(added || "").split("\n");
  const signals = [];

  const hasS1 = anyMatch(lines, S1_PATTERNS); if (hasS1) signals.push("S1");
  const hasS2 = anyMatch(lines, S2_PATTERNS); if (hasS2) signals.push("S2");

  const strongTypes = (hasS1 ? 1 : 0) + (hasS2 ? 1 : 0);
  if (strongTypes >= 2) return { category: "S3", strong: true, signals };
  if (hasS1) return { category: "S1", strong: true, signals };
  if (hasS2) return { category: "S2", strong: true, signals };

  // No strong signal: classify the weak kind (most-informative first).
  if (anyMatch(lines, W4_PATTERNS)) return { category: "W4", strong: false, signals: ["W4"] };
  if (anyMatch(lines, W5_PATTERNS)) return { category: "W5", strong: false, signals: ["W5"] };
  if (anyMatch(lines, W3_PATTERNS)) return { category: "W3", strong: false, signals: ["W3"] };
  if (anyMatch(lines, W2_PATTERNS)) return { category: "W2", strong: false, signals: ["W2"] };
  return { category: "W1", strong: false, signals: ["W1"] }; // no assertion at all
}

// decideAssertionGate(addedLines, { minCategory='S1' }) -> { pass: bool, category, reason }
// HARD GATE: W1-W5 fail; require >= the configured strong floor (default S1).
export function decideAssertionGate(added, opts = {}) {
  const min = opts.minCategory || "S1";
  const { category, strong } = classifyOracle(added);
  const order = { W1: 0, W2: 1, W3: 2, W4: 3, W5: 4, S1: 5, S2: 6, S3: 7 };
  const pass = strong && order[category] >= order[min];
  return { pass, category, reason: pass ? "strong-oracle" : `weak-oracle:${category}` };
}

export const _internal = { S1_PATTERNS, S2_PATTERNS };
