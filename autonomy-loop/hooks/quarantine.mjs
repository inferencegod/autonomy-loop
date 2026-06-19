// autonomy-loop: quarantine (Spec B6). Pure core for the CaMeL/dual-LLM researcher quarantine.
// The Researcher reads untrusted web content but its output is forced through a TYPED schema so
// free-text instructions cannot survive into a spec. The Planner sees only structured fields +
// provenance, never raw web tokens. Plus a taint gate: a spec citing a freshly-fetched URL cannot
// auto-promote. No I/O, no deps, fail-closed (reject on any schema violation).

// extractTyped(rawWebText, opts) -> { record } | { reject, reason }
// The schema is fixed: a researcher "finding" is { claim, sourceUrl, fetchedAt, contentHash,
// extractedFields }. Any instruction-like content is stripped; the claim is treated as DATA.
export function extractTyped(rawWebText, opts = {}) {
  const text = typeof rawWebText === "string" ? rawWebText : "";
  if (!text.trim()) return { reject: true, reason: "empty" };

  // Reject if the content is trying to act as an INSTRUCTION rather than data. These are the
  // classic indirect-prompt-injection markers. We do not "clean and proceed" — we reject, because
  // a quarantined source has no business issuing instructions (architecture, not filtering).
  const INJECTION_MARKERS = [
    /\bignore\s+(all\s+)?(previous|prior|above)\s+instructions?\b/i,
    /\bdisregard\s+(the\s+)?(system|previous)\b/i,
    /\byou\s+are\s+now\b/i,
    /\bnew\s+instructions?\s*:/i,
    /\bsystem\s*prompt\b/i,
    /\bchat\.tools\.autoApprove\b/i,            // the Copilot YOLO CVE marker
    /"?\s*autoApprove\s*"?\s*:\s*true/i,
    /\bsetcookie\b|\bexfiltrate\b|\bcurl\s+http/i,
    /<\s*tool_use\s*>|<\s*system\s*>/i,
    /\bplease\s+(add|create|write|commit|push)\b.*\bspec\b/i, // "please add this spec"
  ];
  if (INJECTION_MARKERS.some((re) => re.test(text))) {
    return { reject: true, reason: "instruction-like-content-rejected" };
  }

  // Require provenance. A finding with no resolvable source URL is not promotable material.
  const url = opts.sourceUrl;
  if (!url || !/^https?:\/\//i.test(String(url))) return { reject: true, reason: "no-valid-source-url" };

  // Build the typed record. The claim is the data; we cap length and strip control chars so it
  // can't smuggle a payload through whitespace/unicode tricks.
  const claim = text.replace(/[\u0000-\u001F\u007F-\u009F\u200B-\u200F\u202A-\u202E]/g, " ").slice(0, 1000).trim();
  const record = {
    claim,
    sourceUrl: String(url),
    fetchedAt: opts.fetchedAt || new Date().toISOString(),
    contentHash: opts.contentHash || simpleHash(text),
    extractedFields: sanitizeFields(opts.extractedFields),
  };
  return { record };
}

function sanitizeFields(fields) {
  if (!fields || typeof fields !== "object") return {};
  const out = {};
  for (const [k, v] of Object.entries(fields)) {
    if (typeof v === "string") out[k] = v.slice(0, 200);
    else if (typeof v === "number" || typeof v === "boolean") out[k] = v;
    // objects/arrays/functions are dropped — only scalar facts survive
  }
  return out;
}

function simpleHash(s) {
  let h = 0; for (let i = 0; i < s.length; i++) { h = (Math.imul(31, h) + s.charCodeAt(i)) | 0; }
  return "h" + (h >>> 0).toString(16);
}

// decidePromotion(spec, opts) -> { allow, park, reason }
// HARD RULE: a spec citing a freshly-fetched URL cannot auto-promote unless a deterministic
// re-fetch hash matches (the fact was verified) OR a human GO is present.
export function decidePromotion(spec, opts = {}) {
  const citesFreshUrl = !!(spec && spec.citesFreshUrl);
  const nowMs = opts.nowMs ?? Date.now();
  const freshWindowMs = opts.freshWindowMs ?? 15 * 60 * 1000; // 15 min
  if (!citesFreshUrl) return { allow: true, park: false, reason: "no-fresh-citation" };

  const fetchedAtMs = Date.parse(spec.fetchedAt || "");
  const isFresh = Number.isFinite(fetchedAtMs) && (nowMs - fetchedAtMs) < freshWindowMs;
  if (!isFresh) return { allow: true, park: false, reason: "citation-aged-out" };

  // It's fresh: require either a verified re-fetch hash match or a human GO.
  if (spec.refetchHashMatches === true) return { allow: true, park: false, reason: "refetch-verified" };
  if (opts.humanGo === true) return { allow: true, park: false, reason: "human-go" };
  return { allow: false, park: true, reason: "fresh-url-needs-verification-or-go" };
}

export const _internal = { simpleHash };
