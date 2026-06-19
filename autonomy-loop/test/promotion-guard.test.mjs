// Pure-core ACs for the promotion-guard safety floor (Build-brief Task 4, Spec A3).
// Run: node --test test/promotion-guard.test.mjs
// These exercise decidePromotionGuard() directly (no I/O). The thin PreToolUse runner is exercised
// separately by the scratch integration script (test/promotion-guard.integration.sh) against real git.
import { test } from "node:test";
import assert from "node:assert/strict";
import { decidePromotionGuard } from "../hooks/promotion-guard.mjs";

const FULL_ROSTER = ["builder", "reviewer"];
const LONE_BUILDER = ["builder"];

// reviewer REQUIRED, no reduced-trust opt-in (the strict default operators should ship with).
// seed:true models the normal case where a human-provided first spec satisfies the builder's input
// (without a planner/researcher/seed the pipeline is starved and the floor refuses, which is correct).
const CFG_REVIEWER_REQUIRED = {
  prodBranch: "main",
  roles: { reviewer: "required" },
  safety: { reducedTrustOptIn: false },
  seed: true,
};

// reviewer OFF, reduced-trust explicitly opted in (the operator chose to run with no reviewer).
const CFG_REVIEWER_OFF_REDUCED = {
  prodBranch: "main",
  roles: { reviewer: "off" },
  safety: { reducedTrustOptIn: true },
  seed: true,
};

// ---- AC1: reviewer:"required" + lone-builder roster -> REFUSE to start --------------------------
test("AC1 startup REFUSES when reviewer is required but absent (lone builder)", () => {
  const d = decidePromotionGuard({ phase: "startup", roster: LONE_BUILDER, config: CFG_REVIEWER_REQUIRED });
  assert.equal(d.action, "refuse");
  assert.equal(d.block, true);
  assert.equal(d.exitCode, 2);
  assert.ok(d.reason.includes("required-role-absent:reviewer"), d.reason);
});

test("AC1 startup STARTS when builder + reviewer are both live", () => {
  const d = decidePromotionGuard({ phase: "startup", roster: FULL_ROSTER, config: CFG_REVIEWER_REQUIRED });
  assert.equal(d.action, "start");
  assert.equal(d.block, false);
  assert.equal(d.exitCode, 0);
  assert.ok(d.reason.includes("full"), d.reason);
});

// ---- AC2: reviewer:"off" + reducedTrustOptIn -> runs, but promotion commands are BLOCKED ---------
test("AC2 startup is ALLOWED in reduced trust (reviewer off + opt-in) so the loop runs", () => {
  const d = decidePromotionGuard({ phase: "startup", roster: LONE_BUILDER, config: CFG_REVIEWER_OFF_REDUCED });
  assert.equal(d.action, "start");
  assert.equal(d.exitCode, 0);
});

test("AC2 'git merge ...' is BLOCKED (exit 2) in reduced trust", () => {
  const d = decidePromotionGuard({
    phase: "pretooluse", command: "git merge feature/login", roster: LONE_BUILDER, config: CFG_REVIEWER_OFF_REDUCED,
  });
  assert.equal(d.block, true);
  assert.equal(d.exitCode, 2);
  assert.ok(d.reason.includes("reduced"), d.reason);
});

test("AC2 'git push origin main' is BLOCKED (exit 2) in reduced trust", () => {
  const d = decidePromotionGuard({
    phase: "pretooluse", command: "git push origin main", roster: LONE_BUILDER, config: CFG_REVIEWER_OFF_REDUCED,
  });
  assert.equal(d.block, true);
  assert.equal(d.exitCode, 2);
});

// ---- AC3: builder + reviewer both live -> promotion ALLOWED -------------------------------------
// The safety-floor governs the "promote my work for integration" action: a local merge and a tag push.
// At FULL trust (a live independent reviewer) the floor lets them through.
test("AC3 promotion (merge) ALLOWED when builder + reviewer are both live", () => {
  const merge = decidePromotionGuard({
    phase: "pretooluse", command: "git merge feature/login", roster: FULL_ROSTER, config: CFG_REVIEWER_REQUIRED,
  });
  assert.equal(merge.block, false, merge.reason);
  assert.equal(merge.exitCode, 0);

  // A tag push (not a prod-branch push) is likewise a floor-governed promotion: allowed at full trust,
  // and it is exactly what gets BLOCKED in the lone-builder reduced-trust case.
  const tags = decidePromotionGuard({
    phase: "pretooluse", command: "git push --tags", roster: FULL_ROSTER, config: CFG_REVIEWER_REQUIRED,
  });
  assert.equal(tags.block, false, tags.reason);
  assert.equal(tags.exitCode, 0);

  // Symmetric negative: the same tag push with a lone builder in reduced trust IS blocked by the floor.
  const tagsReduced = decidePromotionGuard({
    phase: "pretooluse", command: "git push --tags", roster: LONE_BUILDER, config: CFG_REVIEWER_OFF_REDUCED,
  });
  assert.equal(tagsReduced.block, true);
  assert.equal(tagsReduced.exitCode, 2);
});

// COMPOSITION INVARIANT (not a regression): a DIRECT push to the prod branch and a gh pr merge stay
// owner-gated by the existing decide.mjs core EVEN at full trust. The loop never ships to prod itself;
// a human owner does. The safety-floor layers UNDER, never OVER, that stricter base gate. Asserted so
// nobody later "fixes" AC3 by weakening the prod-push / shipping-CLI block.
test("AC3 corollary: direct prod-branch push AND gh pr merge stay owner-gated at full trust (base gate, by design)", () => {
  const push = decidePromotionGuard({
    phase: "pretooluse", command: "git push origin main", roster: FULL_ROSTER, config: CFG_REVIEWER_REQUIRED,
  });
  assert.equal(push.block, true);
  assert.equal(push.exitCode, 2);
  assert.ok(push.reason.includes("gate-guard"), push.reason);

  const ghMerge = decidePromotionGuard({
    phase: "pretooluse", command: "gh pr merge 42 --squash", roster: FULL_ROSTER, config: CFG_REVIEWER_REQUIRED,
  });
  assert.equal(ghMerge.block, true);
  assert.ok(ghMerge.reason.includes("gate-guard"), ghMerge.reason);
});

// ---- Composition checks: the existing gate-guard core still fires (we did not bypass it) ---------
test("the existing gate-guard core still blocks a force-push even at full trust", () => {
  const d = decidePromotionGuard({
    phase: "pretooluse", command: "git push --force origin feature", roster: FULL_ROSTER, config: CFG_REVIEWER_REQUIRED,
  });
  assert.equal(d.block, true);
  assert.equal(d.exitCode, 2);
  assert.ok(d.reason.includes("gate-guard"), d.reason);
});

test("non-promotion commands pass regardless of trust (lone builder may build/commit/test)", () => {
  for (const cmd of ["npm test", "git commit -m wip", "git push origin work-branch", "ls -la"]) {
    const d = decidePromotionGuard({ phase: "pretooluse", command: cmd, roster: LONE_BUILDER, config: CFG_REVIEWER_OFF_REDUCED });
    assert.equal(d.block, false, `${cmd} should pass: ${d.reason}`);
  }
});

// ---- Fail-closed inputs -------------------------------------------------------------------------
test("fail-closed: missing config refuses", () => {
  const d = decidePromotionGuard({ phase: "startup", roster: FULL_ROSTER, config: null });
  assert.equal(d.block, true);
  assert.equal(d.reason, "no-config");
});

test("fail-closed: a non-array roster refuses, even for a promotion at face value", () => {
  const d = decidePromotionGuard({ phase: "pretooluse", command: "git push origin main", roster: "builder,reviewer", config: CFG_REVIEWER_REQUIRED });
  assert.equal(d.block, true);
  assert.equal(d.exitCode, 2);
});

// ---- INVARIANT (brute force): NO roster lets a promotion command through without a live reviewer -
test("INVARIANT: across every roster subset AND config posture, a promotion is allowed ONLY with a live reviewer", () => {
  const roles = ["researcher", "planner", "builder", "reviewer"];
  const promotionCmds = [
    "git merge feature",
    "git push origin main",
    "git push origin master",
    "git push prod-remote production",
    "gh pr merge 42",
    "git push --tags",
  ];
  // Posture A: strict (reviewer required, no opt-in). Posture B: reduced (reviewer off + opt-in).
  // Posture C: permissive roles map but reduced opt-in off. None may leak a promotion w/o reviewer.
  const postures = [
    { roles: {}, safety: { reducedTrustOptIn: true }, prodBranch: "main", seed: true },
    { roles: { reviewer: "off" }, safety: { reducedTrustOptIn: true }, prodBranch: "main", seed: true },
    { roles: {}, safety: { reducedTrustOptIn: false }, prodBranch: "main", seed: true },
  ];

  let allowedWithReviewer = 0;
  let blockedTotal = 0;
  for (let mask = 0; mask < 16; mask++) {
    const subset = roles.filter((_, i) => mask & (1 << i));
    for (const cfg of postures) {
      for (const cmd of promotionCmds) {
        const d = decidePromotionGuard({ phase: "pretooluse", command: cmd, roster: subset, config: cfg });
        if (!d.block) {
          // The ONLY way a promotion is allowed is with a live reviewer in the roster.
          assert.ok(
            subset.includes("reviewer"),
            `LEAK: promotion "${cmd}" allowed without reviewer. roster=${JSON.stringify(subset)} cfg=${JSON.stringify(cfg.roles)}/${cfg.safety.reducedTrustOptIn}`
          );
          allowedWithReviewer++;
        } else {
          blockedTotal++;
        }
      }
    }
  }
  // Sanity: the sweep actually exercised both branches (some allowed with reviewer, many blocked).
  assert.ok(allowedWithReviewer > 0, "expected some promotions allowed when a reviewer was present");
  assert.ok(blockedTotal > 0, "expected most promotions blocked without a reviewer");
});
