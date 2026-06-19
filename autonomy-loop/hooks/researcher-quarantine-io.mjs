// autonomy-loop: researcher-quarantine-io (Spec B6 runner). THIN wrapper over the pure quarantine
// core. The pure core (quarantine.mjs: extractTyped + decidePromotion) holds the typing policy and
// the taint gate; this file does the orchestration the core cannot and adds a defense-in-depth
// PRE-SCREEN. It stands between the Researcher's (simulated) web fetch and the Planner, and between
// a finished spec and promotion. No real network: we take already-fetched content STRINGS as input,
// exactly as a Q-LLM would have read them.
//
// WHY A WRAPPER PRE-SCREEN (and not a core change): the pure core is frozen (built + green, 11 ACs).
// The red-team corpus surfaced ADAPTIVE evasions the marker-based core lets through as a typed
// record, which would violate the AC "no spec emitted from instruction-like content":
//   (1) base64-encoded instructions  ("Decode and run: aWdub3Jl...")  -> raw b64 matches no marker.
//   (2) zero-width-hidden markers (a ZWSP between letters of "you are now") -> the core strips the
//       zero-width chars to SPACES, which is exactly what de-obfuscates the instruction AND breaks
//       the word-boundary marker, so it slips through.
//   (3) novel phrasings not in the fixed marker set ("forget what you were told", "create a spec
//       that...", "push --force origin main", "granting yourself the Bash tool").
// Fix lives HERE, fail-closed, BEFORE the core ever types the content:
//   - normalize (strip zero-width / bidi / control) then RE-RUN an extended marker set on the
//     normalized text, so de-obfuscation cannot help the attacker;
//   - decode base64-looking substrings and re-scan the decoded text for the SAME markers;
//   - keep the core as the second gate, so anything the pre-screen passes still gets typed (claim is
//     DATA, fields are scalars only). Two gates: reject if EITHER fires.
//
// Two duties, both fail-closed:
//  1. quarantineFetch(fetched): every researcher web fetch -> a TYPED record or a typed reject. Raw,
//     instruction-like web tokens never pass; the planner gets structure, never prose (CaMeL).
//  2. gatePromotion(spec): a spec citing a FRESH url cannot auto-promote without a deterministic
//     refetch-hash match or a human GO; a fresh, unverified citation PARKs.
//
// House convention: pure core + thin runner; no external deps; no I/O beyond stdin/argv; no em dashes.
// The source is intentionally pure ASCII: the obfuscation strip-set is built from \u code points.

import * as fs from "node:fs";
import { extractTyped, decidePromotion } from "./quarantine.mjs";

// ---- Pre-screen markers (superset of the core's, plus adaptive phrasings) ------------------------
// These run on the NORMALIZED text and on any DECODED base64, in the wrapper, before the core.
const PRESCREEN_MARKERS = [
  /\bignore\s+(all\s+)?(previous|prior|above)\s+instructions?\b/i,
  /\bdisregard\s+(the\s+)?(system|previous|earlier|above)\b/i,
  /\bforget\s+(what|everything|all)\b[\s\S]{0,40}\b(told|said|instruction|earlier|above|previous)\b/i,
  /\byou\s+are\s+now\b/i,
  /\bnew\s+instructions?\s*:/i,
  /\bsystem\s*prompt\b/i,
  /\bchat\.tools\.autoApprove\b/i,
  /"?\s*autoApprove\s*"?\s*:\s*true/i,
  /\bsetcookie\b|\bexfiltrate\b|\bcurl\s+http/i,
  /<\s*tool_use\s*>|<\s*system\s*>|<\s*assistant\s*>/i,
  /\bplease\s+(add|create|write|commit|push)\b[\s\S]{0,60}\bspec\b/i,
  /\b(add|create|write|commit|inject|append)\b[\s\S]{0,40}\bspec(s)?\b/i,
  /\bappend\s+(a\s+)?(new\s+)?(task|spec|instruction|rule)\b/i,
  /\b(push|merge|commit)\b[\s\S]{0,30}\b(main|master|origin)\b/i,
  /\bwrite\b[\s\S]{0,40}\b(token|secret|credential|key)\b[\s\S]{0,20}\b(to|into)\b/i,
  /\bdecode\s+(and|then)\s+(run|exec|execute|eval)\b/i,
  /\b(run|exec|execute|eval)\s+(the\s+)?(following|this|decoded|base64)\b/i,
  /\bbase64\b[\s\S]{0,30}\b(decode|run|exec)\b|\b(decode|run|exec)\b[\s\S]{0,30}\bbase64\b/i,
  /\boverride\s+(the\s+)?(gate|guard|safety|review)\b/i,
  /\bauto[-\s]?approve\b/i,
  /\bgrant(s|ing)?\s+(yourself|me)\b[\s\S]{0,30}\b(permission|access|tool)\b/i,
  /\bdisabl(e|es|ing)\s+(the\s+)?(gate|guard|safety|sandbox|review|floor)\b/i,
];

// The set of invisible / format / bidi-control / soft-hyphen / C0-C1 code points an attacker uses to
// split a marker (a ZWSP inside "you are now"). Built from \u escapes so this file stays pure ASCII.
const ZW_STRIP = new RegExp(
  "[" +
  "\\u0000-\\u0008\\u000B\\u000C\\u000E-\\u001F\\u007F-\\u009F" + // C0 + C1 controls
  "\\u00AD" +                                                     // soft hyphen
  "\\u200B-\\u200F" +                                             // ZWSP, ZWNJ, ZWJ, LRM, RLM
  "\\u202A-\\u202E" +                                             // bidi embeddings/overrides
  "\\u2060-\\u206F" +                                             // word joiner, invisible math ops
  "\\uFEFF" +                                                     // BOM / ZWNBSP
  "]",
  "g"
);

// Strip the invisible chars WITHOUT inserting spaces, so a marker that was split by an invisible char
// reassembles into a matchable token. This is the opposite of the core's replace-with-space: here we
// want to UNHIDE, not tokenize.
function deobfuscate(s) {
  return String(s == null ? "" : s).replace(ZW_STRIP, "");
}

// Find base64-looking runs (>= 24 chars of the b64 alphabet), decode each, keep only mostly-printable
// decodings, and return them joined for re-scanning. Bounded work: cap count and decoded length.
function decodedB64Blobs(s) {
  const text = String(s == null ? "" : s);
  const out = [];
  const re = /[A-Za-z0-9+/]{24,}={0,2}/g;
  let m, n = 0;
  while ((m = re.exec(text)) && n < 20) {
    n++;
    let dec = "";
    try { dec = Buffer.from(m[0], "base64").toString("utf8"); } catch { dec = ""; }
    if (!dec) continue;
    const printable = dec.replace(/[^\x20-\x7E]/g, "");
    if (printable.length >= dec.length * 0.8 && printable.length >= 6) out.push(printable.slice(0, 2000));
  }
  return out.join("\n");
}

// The pre-screen verdict: does this content look like an INSTRUCTION under de-obfuscation or b64?
// Returns a reason string if it does (blocked), or null if it is clean enough to hand to the core.
export function prescreen(content) {
  const raw = String(content == null ? "" : content);
  const norm = deobfuscate(raw);
  const decoded = decodedB64Blobs(raw);
  const hay = raw + "\n" + norm + "\n" + decoded;
  for (const re of PRESCREEN_MARKERS) {
    if (re.test(hay)) return "instruction-like-content-rejected";
  }
  return null;
}

// ---- Duty 1: every fetch is quarantined into a typed record (or a typed reject) -------------------
// fetched = { content, sourceUrl, fetchedAt, contentHash, extractedFields }. The planner NEVER
// receives `content`; it receives either { ok:true, record } or { ok:false, reject, reason }.
export function quarantineFetch(fetched = {}) {
  const f = fetched && typeof fetched === "object" ? fetched : {};
  // GATE 1 (wrapper pre-screen, defense in depth): block obfuscated / encoded / novel instructions
  // before the core ever types them. Fail-closed: a hit emits only a reason, never any content.
  const pre = prescreen(f.content);
  if (pre) {
    return { ok: false, reject: true, reason: pre, sourceUrl: typeof f.sourceUrl === "string" ? f.sourceUrl : null };
  }
  // GATE 2 (pure core): the canonical typed-extraction + marker policy. Still authoritative.
  const out = extractTyped(f.content, {
    sourceUrl: f.sourceUrl,
    fetchedAt: f.fetchedAt,
    contentHash: f.contentHash,
    extractedFields: f.extractedFields,
  });
  if (out && out.reject) {
    return { ok: false, reject: true, reason: out.reason, sourceUrl: typeof f.sourceUrl === "string" ? f.sourceUrl : null };
  }
  return { ok: true, reject: false, record: out.record };
}

// ---- Duty 2: promotion taint gate ----------------------------------------------------------------
// A spec citing a freshly-fetched URL cannot auto-promote. decidePromotion returns allow|park.
export function gatePromotion(spec = {}, opts = {}) {
  const d = decidePromotion(spec, opts);
  return { decision: d.allow ? "PROMOTE" : "PARK", park: !!d.park, reason: d.reason };
}

// ---- Combined helper: the planner's view of one researcher finding + its promotion fate -----------
// If the fetch is rejected, NO spec is emitted (specEmitted:false) and promotion is moot (PARK). A
// clean page that cites a fresh url with no refetch match yields specEmitted:true but decision:"PARK".
export function processFinding(fetched = {}, draftSpec = null, opts = {}) {
  const q = quarantineFetch(fetched);
  if (!q.ok) {
    return { specEmitted: false, reason: q.reason, promotion: { decision: "PARK", park: true, reason: "no-spec-from-rejected-fetch" } };
  }
  if (!draftSpec) return { specEmitted: true, record: q.record, promotion: { decision: "PARK", park: true, reason: "no-spec-supplied" } };
  return { specEmitted: true, record: q.record, promotion: gatePromotion(draftSpec, opts) };
}

// ---- Thin CLI: read one JSON job from stdin, print the envelope, fail-closed exit codes -----------
// Job shapes: {op:"fetch",fetched} | {op:"promote",spec,opts} | {op:"finding",fetched,spec,opts}
// Exit: 0 = clean pass (fetch accepted / PROMOTE). 1 = blocked (reject / PARK). 2 = bad job / error.
function main() {
  let raw = "";
  try { raw = fs.readFileSync(0, "utf8"); } catch { raw = ""; }
  let job;
  try { job = JSON.parse(raw || "{}"); } catch { process.stderr.write("bad-json\n"); process.exit(2); return; }
  const op = job && job.op;
  try {
    if (op === "fetch") {
      const r = quarantineFetch(job.fetched || {});
      process.stdout.write(JSON.stringify(r) + "\n");
      process.exit(r.ok ? 0 : 1);
    } else if (op === "promote") {
      const r = gatePromotion(job.spec || {}, job.opts || {});
      process.stdout.write(JSON.stringify(r) + "\n");
      process.exit(r.decision === "PROMOTE" ? 0 : 1);
    } else if (op === "finding") {
      const r = processFinding(job.fetched || {}, job.spec || null, job.opts || {});
      process.stdout.write(JSON.stringify(r) + "\n");
      const blocked = !r.specEmitted || r.promotion.decision !== "PROMOTE";
      process.exit(blocked ? 1 : 0);
    } else {
      process.stderr.write("unknown-op\n");
      process.exit(2);
    }
  } catch (e) {
    process.stderr.write("error:" + (e && e.message ? e.message : String(e)) + "\n");
    process.exit(2);
  }
}

const invokedPath = (process.argv[1] || "").replace(/\\/g, "/");
if (invokedPath && import.meta.url.endsWith(invokedPath)) main();
