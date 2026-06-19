// autonomy-loop test fixture helper: a ZERO-DEP coverage command for the verify-gate fixtures only.
// Real installs use c8/nyc (--reporter=json -> coverage-final.json), the convention patch-coverage.mjs
// reads. The fixtures cannot assume c8 is installed, so this shim runs `node --test <file>` under V8's
// built-in NODE_V8_COVERAGE and converts the raw byte-range coverage to a LINE-LEVEL Istanbul
// coverage-final.json. It emits exactly what coverageFromIstanbul (patch-coverage.mjs) consumes:
// per file, a statementMap of { id: {start:{line}} } plus s of { id: count }. One statement per code
// line; a line is covered iff the innermost V8 range over its first non-whitespace byte has count > 0.
// This is a TEST utility, not a production hook (production stays dependency-free). No em dashes.
import { readFileSync, readdirSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { join, isAbsolute, resolve, dirname } from "node:path";

function offsetToLine(src) {
  const nl = []; for (let i = 0; i < src.length; i++) if (src[i] === "\n") nl.push(i);
  return (off) => { let lo = 0, hi = nl.length; while (lo < hi) { const m = (lo + hi) >> 1; if (nl[m] < off) lo = m + 1; else hi = m; } return lo + 1; };
}
function firstCodeOffsetByLine(src) {
  const lines = src.split("\n"); const out = []; let off = 0;
  for (const ln of lines) { const m = ln.match(/\S/); out.push(m ? off + m.index : null); off += ln.length + 1; }
  return out; // index 0 == line 1; null == blank line
}
export function v8ToIstanbul(v8dir, srcAbsList) {
  let all = [];
  for (const f of readdirSync(v8dir)) { try { const j = JSON.parse(readFileSync(join(v8dir, f), "utf8")); all = all.concat(j.result || []); } catch {} }
  const want = new Set(srcAbsList.map((p) => resolve(p)));
  const final = {};
  for (const entry of all) {
    if (!entry.url || !entry.url.startsWith("file:")) continue;
    let abs; try { abs = fileURLToPath(entry.url); } catch { continue; }
    if (!want.has(resolve(abs))) continue;
    let src; try { src = readFileSync(abs, "utf8"); } catch { continue; }
    const firstCode = firstCodeOffsetByLine(src);
    const ranges = [];
    for (const fn of entry.functions || []) for (const r of fn.ranges || []) ranges.push(r);
    const countAt = (off) => {
      let best = null, bestLen = Infinity;
      for (const r of ranges) { if (r.startOffset <= off && off < r.endOffset) { const len = r.endOffset - r.startOffset; if (len < bestLen) { bestLen = len; best = r; } } }
      return best ? best.count : 0;
    };
    const statementMap = {}, s = {}; let id = 0;
    for (let li = 0; li < firstCode.length; li++) {
      const off = firstCode[li]; if (off == null) continue;
      const line = li + 1;
      statementMap[id] = { start: { line, column: 0 }, end: { line, column: 0 } };
      s[id] = countAt(off) > 0 ? 1 : 0;
      id++;
    }
    final[abs] = { path: abs, statementMap, s, fnMap: {}, f: {}, branchMap: {}, b: {} };
  }
  return final;
}
function main(argv) {
  const args = Object.fromEntries(argv.slice(2).map((a) => { const m = a.match(/^--([^=]+)=(.*)$/); return m ? [m[1], m[2]] : [a.replace(/^--/, ""), true]; }));
  const out = args.out || "coverage/coverage-final.json";
  const srcs = String(args.src || "").split(",").map((x) => x.trim()).filter(Boolean);
  const testFiles = String(args.test || "").split(",").map((x) => x.trim()).filter(Boolean);
  if (!srcs.length || !testFiles.length) { console.error("v8cov: need --src=a,b --test=t1,t2 --out=path"); process.exit(2); }
  const v8dir = join(process.cwd(), ".v8cov-" + process.pid); mkdirSync(v8dir, { recursive: true });
  try { execFileSync(process.execPath, ["--test", ...testFiles], { cwd: process.cwd(), env: { ...process.env, NODE_V8_COVERAGE: v8dir }, stdio: "ignore" }); } catch {}
  const final = v8ToIstanbul(v8dir, srcs.map((p) => (isAbsolute(p) ? p : resolve(process.cwd(), p))));
  try { rmSync(v8dir, { recursive: true, force: true }); } catch {}
  const outAbs = isAbsolute(out) ? out : resolve(process.cwd(), out);
  mkdirSync(dirname(outAbs), { recursive: true });
  writeFileSync(outAbs, JSON.stringify(final));
  console.log("v8cov wrote " + outAbs + " (" + Object.keys(final).length + " file(s))");
}
// Run as a CLI only when invoked directly AND given its real args. Under `node --test` the runner
// makes this fixture its own entry (argv[1] === this file) with no --src/--test/--out, so the
// arg-intent guard keeps it inert (no usage print, no exit 2) instead of being counted as a failed test.
const _hasCliIntent = process.argv.slice(2).some((a) => /^--(src|test|out)\b/.test(a));
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1] && _hasCliIntent) main(process.argv);
