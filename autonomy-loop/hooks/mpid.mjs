// autonomy-loop: mpid (Money-Path / Irreversibility Detector, Spec B8). Pure decision core.
// "Additive vs money-path" stops being an LLM call. A diff that touches a configured sensitive set
// (money-path globs, secrets, DB migrations, IaC, auth, public content, data-deletion) FORCES a
// human PARK regardless of what any model votes. This is the semantic-risk analogue of gate-guard's
// protectedPaths: the LLM cannot override it. No I/O, no deps, fail-closed (ambiguity -> higher tier).

// Default policy. Operators extend via policy/sensitive-paths.yml (merged in by the caller).
const DEFAULT_POLICY = {
  moneyPathGlobs: ["billing/", "payments/", "pricing/", "checkout/", "subscription", "invoice"],
  paymentSdkPatterns: [/\bstripe\b/i, /\bpaypal\b/i, /\bbraintree\b/i, /\blemonsqueezy\b/i, /\bchargebee\b/i],
  migrationGlobs: ["migrations/", "migrate/", "/alembic/", "schema.prisma", "/db/migrate/"],
  migrationContent: [/\bCREATE\s+TABLE\b/i, /\bALTER\s+TABLE\b/i, /\bDROP\s+TABLE\b/i, /\baddColumn\b/, /\bremoveColumn\b/],
  iacGlobs: [".tf", ".tfvars", "Dockerfile", "docker-compose", "/k8s/", ".github/workflows/", "serverless.yml"],
  authGlobs: ["auth/", "authz/", "/rbac/", "permission", "session", "login", "oauth"],
  authContent: [/\bjwt\b/i, /\bbcrypt\b/i, /\bpassport\b/i, /\bauthorize\b/i, /\bsetCookie\b/i],
  publicContentGlobs: ["public/", "marketing/", "GROWTH.md", "/landing/", "/blog/", "/press/"],
  dataDeletionContent: [/\bDROP\s+(TABLE|DATABASE|SCHEMA)\b/i, /\bDELETE\s+FROM\b/i, /\bTRUNCATE\b/i, /\brm\s+-rf\b/, /\.drop\(\)/, /destroyAll/],
  secretPatterns: [
    /\bAKIA[0-9A-Z]{16}\b/,                 // AWS access key id
    /\bsk_live_[0-9a-zA-Z]{16,}\b/,         // Stripe live secret
    /\bghp_[0-9a-zA-Z]{36}\b/,              // GitHub PAT
    /-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----/,
    /\bxox[baprs]-[0-9a-zA-Z-]{10,}\b/,     // Slack token
  ],
  secretGlobs: [".env", ".pem", "id_rsa", "credentials", ".npmrc", ".pypirc"],
  dependencyGlobs: ["package-lock.json", "yarn.lock", "pnpm-lock.yaml", "Cargo.lock", "poetry.lock", "go.sum", "Gemfile.lock"],
  // Shannon-entropy threshold for "looks like a secret" string literals.
  entropyThreshold: 4.0,
};

function mergePolicy(custom) {
  if (!custom || typeof custom !== "object") return DEFAULT_POLICY;
  const m = { ...DEFAULT_POLICY };
  for (const k of Object.keys(DEFAULT_POLICY)) {
    if (Array.isArray(custom[k])) m[k] = [...DEFAULT_POLICY[k], ...custom[k]];
    else if (typeof custom[k] === "number" && custom[k] != null) m[k] = custom[k];
  }
  return m;
}

function pathMatches(path, globs) {
  const p = String(path).toLowerCase();
  return globs.some((g) => p.includes(String(g).toLowerCase()));
}
function pathEndsWith(path, exts) {
  const p = String(path).toLowerCase();
  return exts.some((e) => p.endsWith(String(e).toLowerCase()) || p.includes(String(e).toLowerCase()));
}
function contentMatches(content, patterns) {
  const c = String(content || "");
  return patterns.some((re) => re.test(c));
}

// Shannon entropy of a string (bits/char). Used to flag high-entropy literals as possible secrets.
function shannonEntropy(s) {
  if (!s || s.length < 16) return 0;
  const freq = {};
  for (const ch of s) freq[ch] = (freq[ch] || 0) + 1;
  let H = 0;
  for (const ch in freq) { const p = freq[ch] / s.length; H -= p * Math.log2(p); }
  return H;
}
function hasHighEntropyToken(content, threshold) {
  const tokens = String(content || "").split(/[\s"'`=:,()\[\]{}]+/);
  return tokens.some((t) => t.length >= 20 && shannonEntropy(t) >= threshold);
}

// classifyChange: the core decision.
//   changedFiles: [{ path, content }]  (content = the added/changed text of the diff for that file)
//   policyConfig: optional operator overrides (from sensitive-paths.yml)
// Returns { tier: "additive"|"money-path"|"irreversible", matchedRules: [...], park: bool }
export function classifyChange(changedFiles, policyConfig) {
  const policy = mergePolicy(policyConfig);
  const files = Array.isArray(changedFiles) ? changedFiles : [];
  const matched = [];

  let irreversible = false;
  let moneyPath = false;

  for (const f of files) {
    const path = f && f.path ? f.path : "";
    const content = f && f.content ? f.content : "";

    // IRREVERSIBLE class (highest) ----
    if (pathMatches(path, policy.secretGlobs) || contentMatches(content, policy.secretPatterns) || hasHighEntropyToken(content, policy.entropyThreshold)) {
      irreversible = true; matched.push({ path, rule: "secret" });
    }
    if (contentMatches(content, policy.dataDeletionContent)) {
      irreversible = true; matched.push({ path, rule: "data-deletion" });
    }
    if (pathMatches(path, policy.migrationGlobs) || contentMatches(content, policy.migrationContent)) {
      irreversible = true; matched.push({ path, rule: "db-migration" });
    }

    // MONEY-PATH class ----
    if (pathMatches(path, policy.moneyPathGlobs) || contentMatches(content, policy.paymentSdkPatterns)) {
      moneyPath = true; matched.push({ path, rule: "money-path" });
    }
    if (pathEndsWith(path, policy.iacGlobs)) { moneyPath = true; matched.push({ path, rule: "iac" }); }
    if (pathMatches(path, policy.authGlobs) || contentMatches(content, policy.authContent)) {
      moneyPath = true; matched.push({ path, rule: "auth" });
    }
    if (pathMatches(path, policy.publicContentGlobs)) { moneyPath = true; matched.push({ path, rule: "public-content" }); }
    if (pathEndsWith(path, policy.dependencyGlobs)) { moneyPath = true; matched.push({ path, rule: "dependency-lockfile" }); }
  }

  const tier = irreversible ? "irreversible" : moneyPath ? "money-path" : "additive";
  // PARK on anything that is not plainly additive. The LLM cannot downgrade this.
  return { tier, matchedRules: matched, park: tier !== "additive" };
}

// decideAdditive: optional second layer (dual-different-family model agreement on the additive call).
// The deterministic floor above ALWAYS wins; this only adds caution, never removes a park.
//   verdicts: [{ family, tier }]  from >=2 models
// Returns { agree, tier, park }. Disagreement -> park. Same-family pair -> rejected (caller config error).
export function decideAdditive(verdicts, floorResult) {
  // The deterministic floor parks first, unconditionally.
  if (floorResult && floorResult.park) return { agree: false, tier: floorResult.tier, park: true, reason: "floor-park" };

  const v = Array.isArray(verdicts) ? verdicts.filter((x) => x && x.family && x.tier) : [];
  if (v.length < 2) return { agree: false, tier: "additive", park: true, reason: "need-two-models" };
  const families = new Set(v.map((x) => x.family));
  if (families.size < 2) return { agree: false, tier: "additive", park: true, reason: "same-family-rejected" };
  const tiers = new Set(v.map((x) => x.tier));
  if (tiers.size > 1) return { agree: false, tier: "money-path", park: true, reason: "models-disagree" };
  const tier = v[0].tier;
  return { agree: true, tier, park: tier !== "additive", reason: "models-agree" };
}

export const _internal = { DEFAULT_POLICY, shannonEntropy, mergePolicy };
