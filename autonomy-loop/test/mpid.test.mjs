import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyChange, decideAdditive } from "../hooks/mpid.mjs";

const f = (path, content = "") => ({ path, content });

// --- B8 acceptance criteria ---
test("AC1: a row added to migrations/ -> irreversible -> PARK", () => {
  const r = classifyChange([f("db/migrations/0007_add_users.sql", "CREATE TABLE users (id int);")]);
  assert.equal(r.tier, "irreversible");
  assert.equal(r.park, true);
});

test("AC1b: LLM cannot override the floor — even if both models vote additive, migration parks", () => {
  const floor = classifyChange([f("migrations/x.sql", "ALTER TABLE accounts ADD COLUMN balance int;")]);
  const d = decideAdditive([{ family: "opus", tier: "additive" }, { family: "gpt", tier: "additive" }], floor);
  assert.equal(d.park, true);
  assert.equal(d.reason, "floor-park");
});

test("AC2: Stripe-call diff -> money-path; unit-test-only diff -> additive", () => {
  assert.equal(classifyChange([f("src/checkout.ts", "const stripe = require('stripe')(key)")]).tier, "money-path");
  assert.equal(classifyChange([f("test/util.test.ts", "expect(add(1,2)).toBe(3)")]).tier, "additive");
});

test("AC3: a high-entropy secret -> irreversible -> PARK", () => {
  // a Stripe live key pattern
  assert.equal(classifyChange([f("src/config.ts", "const k = 'sk_live_abcdef0123456789ABCDEF'")]).tier, "irreversible");
  // a generic high-entropy literal
  const hi = classifyChange([f("src/x.ts", "const token = 'a8Fk3Lm9Qz2Xv7Bn4Wp6Rt1Yc5Hd0Jg'")]);
  assert.equal(hi.tier, "irreversible");
});

test("AC4: same-family dual model rejected", () => {
  const floor = classifyChange([f("src/feature.ts", "export const x = 1")]); // additive floor
  const d = decideAdditive([{ family: "opus", tier: "additive" }, { family: "opus", tier: "additive" }], floor);
  assert.equal(d.park, true);
  assert.equal(d.reason, "same-family-rejected");
});

test("AC5: 30 seeded money-path diffs all PARK (0 false-negatives)", () => {
  const cases = [
    f("billing/charge.ts", "x"), f("payments/refund.ts", "x"), f("pricing/tiers.ts", "x"),
    f("checkout/session.ts", "x"), f("src/x.ts", "import Stripe from 'stripe'"),
    f("infra/main.tf", "resource aws_db_instance"), f(".github/workflows/deploy.yml", "on: push"),
    f("Dockerfile", "FROM node"), f("auth/login.ts", "x"), f("src/session.ts", "setCookie(...)"),
    f("migrations/001.sql", "CREATE TABLE x (id int)"), f("db/migrate/002.rb", "add_column :users"),
    f("schema.prisma", "model User {}"), f("public/index.html", "x"), f("GROWTH.md", "competitor claim"),
    f("marketing/copy.md", "x"), f("package-lock.json", "x"), f("yarn.lock", "x"),
    f("src/x.ts", "DELETE FROM accounts"), f("src/y.ts", "TRUNCATE table"), f("scripts/clean.sh", "rm -rf /data"),
    f(".env", "SECRET=1"), f("key.pem", "-----BEGIN PRIVATE KEY-----"), f("src/z.ts", "DROP TABLE logs"),
    f("authz/rbac.ts", "authorize(user)"), f("subscription/plan.ts", "x"), f("invoice/gen.ts", "x"),
    f("src/pay.ts", "braintree.Gateway"), f("Cargo.lock", "x"), f("infra/k8s/deploy.yaml", "kind: Deployment"),
  ];
  let parkedCount = 0;
  for (const c of cases) {
    const r = classifyChange([c]);
    if (r.park) parkedCount++;
    else assert.fail(`false-negative: ${c.path} classified additive`);
  }
  assert.equal(parkedCount, cases.length); // all 30 parked
});

test("plainly additive change passes (no false positive)", () => {
  const r = classifyChange([f("src/components/Button.tsx", "export const Button = () => <button/>")]);
  assert.equal(r.tier, "additive");
  assert.equal(r.park, false);
});

test("models agree additive on a clean diff -> no park", () => {
  const floor = classifyChange([f("src/format.ts", "export const fmt = (n)=>String(n)")]);
  const d = decideAdditive([{ family: "opus", tier: "additive" }, { family: "gemini", tier: "additive" }], floor);
  assert.equal(d.agree, true);
  assert.equal(d.park, false);
});

test("models disagree -> park (caution)", () => {
  const floor = classifyChange([f("src/maybe.ts", "export const x=1")]);
  const d = decideAdditive([{ family: "opus", tier: "additive" }, { family: "gemini", tier: "money-path" }], floor);
  assert.equal(d.park, true);
  assert.equal(d.reason, "models-disagree");
});

test("operator can EXTEND policy with custom globs", () => {
  const r = classifyChange([f("custom-sensitive/x.ts", "x")], { moneyPathGlobs: ["custom-sensitive/"] });
  assert.equal(r.tier, "money-path");
});

test("fail-closed: malformed input -> additive only on truly empty, never throws", () => {
  assert.equal(classifyChange(null).tier, "additive");
  assert.equal(classifyChange([]).tier, "additive");
  assert.doesNotThrow(() => classifyChange([{ nonsense: true }]));
});
