#!/usr/bin/env node
// autonomy-loop: self-mutation (the builder's upstream bite). The reviewer's bite reverts the ONE fix
// and checks the test goes RED. This goes broader and earlier: before handoff the builder mutates the
// lines its own diff changed and requires the tests to KILL each mutant. A surviving mutant means a test
// executed the changed line but asserted nothing about its behavior, the exact weak-test the bite and
// coverage both miss. It is diff-scoped mutation testing run as a self-check.
//
// DESIGN (validated against Stryker / PIT / cargo-mutants / universalmutator / Google mutation-at-scale):
//  - TEXT-LEVEL operators on the changed line (language-agnostic, like universalmutator). MANDATORY: mask
//    string and comment contents first, or a corrupted-but-compiling line yields a FALSE survival.
//  - ONE mutant per line (Google: in 90% of cases a line's mutants share a fate), highest-value low-
//    equivalence operators only (relational boundary, equality, logical, boolean, arithmetic, off-by-one).
//  - killed = tests fail; survived = tests pass (weak test); unviable = build/parse error (EXCLUDED from
//    the denominator); timeout = killed (prior-art convention, unlike the bite).
//  - The equivalent-mutant problem is undecidable, so a survivor is ADVISORY by default (a survivor may be
//    a weak test OR an unkillable equivalent). --block makes survivors fail; an allowlist suppresses
//    confirmed equivalents. Never auto-revert correct code on a lone survivor.
//
// PURE CORE: maskCode(), mutantsForLine(), decideMutation() do no I/O and are unit-tested. The runner
// mutates a changed line in place, runs the test, and restores it (Stryker's model), one mutant at a time
// inside try/finally so a crash cannot leave the tree mutated. Reuses parseDiff (patch-coverage) and
// classifyOutcome (bite). No external deps. No em dashes anywhere.

import { readFileSync, writeFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseDiff } from "./patch-coverage.mjs";
import { classifyOutcome } from "./bite.mjs";

const NUM = (v, d) => { const n = Number(v); return Number.isFinite(n) ? n : d; };
const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));

// PURE: lexically mask string and comment CONTENT (length-preserving) so operator-finding never matches
// inside a string or comment. Best-effort single-line: an unterminated string/comment masks to EOL.
export function maskCode(line) {
  let out = "", i = 0; const n = line.length; let mode = null; // "'" | '"' | "`" | "//" | "/*"
  while (i < n) {
    const c = line[i], c2 = line.slice(i, i + 2);
    if (mode === null) {
      if (c2 === "//") { out += "  "; i += 2; mode = "//"; continue; }
      if (c2 === "/*") { out += "  "; i += 2; mode = "/*"; continue; }
      if (c === "'" || c === '"' || c === "`") { out += c; mode = c; i++; continue; }
      out += c; i++; continue;
    }
    if (mode === "//") { out += " "; i++; continue; }
    if (mode === "/*") { if (c2 === "*/") { out += "  "; i += 2; mode = null; continue; } out += " "; i++; continue; }
    if (c === "\\") { out += "  "; i += 2; continue; }        // escaped char inside a string
    if (c === mode) { out += c; mode = null; i++; continue; } // closing quote
    out += " "; i++; continue;                                 // string content
  }
  return out;
}

// arid lines: nothing worth mutating (comments, imports, pure logging) -> skip (Google's arid-node idea).
function isArid(masked) {
  const t = masked.trim();
  if (t === "" || t.startsWith("//") || t.startsWith("*") || t.startsWith("/*")) return true;
  if (/^(import|export)\b/.test(t) || /\brequire\s*\(/.test(t)) return true;
  if (/\b(console|logger|log|print)\s*\./.test(t)) return true;
  return false;
}

// ordered highest-value, low-equivalence operators. Multi-char BEFORE single-char; lookarounds keep us
// out of larger tokens (===, =>, >>, <=). One mutant per line = the FIRST that applies.
const OPS = [
  [/===/, "!==", "eq-strict"],
  [/!==/, "===", "eq-strict"],
  [/(?<![=!<>])==(?!=)/, "!=", "eq-loose"],
  [/(?<![=!<>])!=(?!=)/, "==", "eq-loose"],
  [/<=/, "<", "rel-boundary"],
  [/>=/, ">", "rel-boundary"],
  [/(?<![<=>!])<(?![<=])/, "<=", "rel-boundary"],
  [/(?<![<=>!-])>(?![>=])/, ">=", "rel-boundary"],
  [/&&/, "||", "logical"],
  [/\|\|/, "&&", "logical"],
  [/\btrue\b/, "false", "bool"],
  [/\bfalse\b/, "true", "bool"],
  [/ \+ /, " - ", "arith"],
  [/ \* /, " / ", "arith"],
  [/(?<![\w.])\d+(?![\w.])/, (s) => String(parseInt(s, 10) + 1), "off-by-one"], // integers only, never floats
];

// PURE: candidate mutants for one source line (ordered; the runner uses the first). Mutates the ORIGINAL
// at the index found in the MASKED copy, so the operator is never inside a string or comment.
export function mutantsForLine(line) {
  const masked = maskCode(line);
  if (isArid(masked)) return [];
  const out = [];
  for (const [re, rep, op] of OPS) {
    const m = re.exec(masked);
    if (!m) continue;
    const idx = m.index, len = m[0].length;
    const token = line.slice(idx, idx + len);
    const after = typeof rep === "function" ? rep(token) : rep;
    const mutated = line.slice(0, idx) + after + line.slice(idx + len);
    if (mutated === line) continue;
    out.push({ op, index: idx, before: token, after, mutated });
  }
  return out;
}

// PURE decision core. results: [{file, line, op, before, after, outcome}] where outcome is
// "killed" | "survived" | "unviable" | "timeout". opts.allow = iterable of "file:line:op" keys to suppress.
export function decideMutation(results = [], opts = {}) {
  const allow = new Set(opts.allow || []);
  const considered = (Array.isArray(results) ? results : []).filter((r) => !allow.has(`${r.file}:${r.line}:${r.op}`));
  let killed = 0; const survived = []; let unviable = 0;
  for (const r of considered) {
    const o = r.outcome === "timeout" ? "killed" : r.outcome; // timeout counts as killed (prior art)
    if (o === "killed") killed++;
    else if (o === "survived") survived.push(r);
    else unviable++; // unviable / unknown: excluded from the denominator
  }
  const scored = killed + survived.length;
  if (scored === 0) {
    return { ok: true, action: "no-op", killed: 0, survived: [], unviable, reason: "no scoreable mutants on the changed lines (arid, or every mutant was unviable)." };
  }
  if (survived.length === 0) {
    return { ok: true, action: "all-killed", killed, survived: [], unviable, reason: `all ${killed} changed-line mutant(s) were killed by the tests.` };
  }
  const list = survived.map((r) => `${r.file}:${r.line} (${r.op} ${r.before} -> ${r.after})`);
  return { ok: false, action: "survivors", killed, survived: list, unviable, reason: `${survived.length} mutant(s) SURVIVED: a test ran these changed lines but asserted nothing about them. Strengthen the assertion, or allowlist if equivalent. ${list.slice(0, 8).join("; ")}${list.length > 8 ? " ..." : ""}` };
}

// ---- thin runner (mutate in place, run, restore; only when invoked directly) ----
function sh(cmd, cwd) { return execSync(cmd, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 64 * 1024 * 1024 }); }
function runTest(cmd, cwd) {
  try { const out = sh(cmd, cwd); return { code: 0, text: out }; }
  catch (e) { return { code: (e && e.status) || 1, text: ((e && e.stdout) || "") + "\n" + ((e && e.stderr) || "") }; }
}
function loadAllow(path) {
  if (!path) return [];
  try { return readFileSync(path, "utf8").split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("#")); }
  catch { return []; }
}

function main(argv) {
  const args = Object.fromEntries(argv.slice(2).map((a) => { const m = a.match(/^--([^=]+)=(.*)$/); return m ? [m[1], m[2]] : [a.replace(/^--/, ""), true]; }));
  const testCmd = args.test;                 // command that runs the relevant tests (narrow is faster)
  const base = args.base;                    // optional git ref/range; default = working tree vs HEAD
  const perFile = clamp(NUM(args["per-file"], 10), 1, 100);
  const maxMut = clamp(NUM(args.max, 30), 1, 500);
  const block = args.block === true || args.block === "true";
  const allow = loadAllow(args.allow);

  if (!testCmd) {
    console.error('[mutate] need --test "<command that runs the tests>". Optional: --base=<ref> --per-file=10 --max=30 --block --allow=.mutants-allow');
    process.exit(2);
  }
  let repoRoot, diffText;
  try {
    repoRoot = sh("git rev-parse --show-toplevel").trim();
    diffText = sh(base ? `git diff --unified=0 ${base}` : "git diff --unified=0 HEAD");
  } catch (e) { console.error(`[mutate] cannot read the diff: ${e && e.message}`); process.exit(2); }

  const changed = parseDiff(diffText);
  if (Object.keys(changed).length === 0) { console.log("[mutate] NO-OP: no changed lines in the diff."); process.exit(0); }

  // baseline: the tests must be GREEN unmutated, or a "killed" cannot be trusted.
  const baseline = runTest(testCmd, repoRoot);
  if (baseline.code !== 0) { console.error("[mutate] CANNOT-VERIFY: the test command is not GREEN on the current code; fix that before self-mutating."); process.exit(2); }

  // signal-safe restore: if we are killed (SIGINT / SIGTERM) while a mutant is live on disk, put the
  // file back before exiting, so a self-mutation run can never leave the builder's working tree mutated.
  let pending = null; // { abs, restore } while a mutant is written to disk
  const restorePending = () => {
    if (!pending) return;
    try { writeFileSync(pending.abs, pending.restore); }
    catch (e) { console.error(`[mutate] MANUAL RESTORE NEEDED for ${pending.abs}: ${e && e.message}`); }
    pending = null;
  };
  for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => { restorePending(); process.exit(130); });

  const results = []; let total = 0;
  for (const [file, lines] of Object.entries(changed)) {
    if (total >= maxMut) break;
    const abs = join(repoRoot, file);
    let content;
    try { content = readFileSync(abs, "utf8").split("\n"); } catch { continue; }
    let perFileCount = 0;
    for (const ln of lines) {
      if (total >= maxMut || perFileCount >= perFile) break;
      const idx0 = ln - 1;
      if (idx0 < 0 || idx0 >= content.length) continue;
      const muts = mutantsForLine(content[idx0]);
      if (muts.length === 0) continue;
      const mut = muts[0];
      const original = content[idx0];
      const restore = content.join("\n"); // exact pre-mutation bytes (line endings travel with each line)
      try {
        content[idx0] = mut.mutated;
        pending = { abs, restore };
        writeFileSync(abs, content.join("\n"));
        const res = runTest(testCmd, repoRoot);
        const cls = classifyOutcome(res.code, res.text); // pass | assert-fail | error | timeout
        const outcome = cls === "pass" ? "survived" : cls === "assert-fail" ? "killed" : cls === "timeout" ? "timeout" : "unviable";
        results.push({ file, line: ln, op: mut.op, before: mut.before, after: mut.after, outcome });
      } finally {
        content[idx0] = original;
        try { writeFileSync(abs, content.join("\n")); } // restore byte-for-byte, even on a crash
        catch (e) { console.error(`[mutate] MANUAL RESTORE NEEDED for ${abs}: ${e && e.message}`); }
        pending = null;
      }
      total++; perFileCount++;
    }
  }

  const r = decideMutation(results, { allow });
  const tag = r.action === "survivors" ? (block ? "SURVIVORS" : "SURVIVORS (advisory)") : r.action.toUpperCase();
  console.log(`[mutate] ${tag}: ${r.reason}`);
  // advisory by default (a survivor may be an equivalent mutant, not a weak test); --block makes it fail.
  process.exit(r.action === "survivors" && block ? 1 : 0);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main(process.argv);
