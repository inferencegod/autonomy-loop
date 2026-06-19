---
description: ORCHESTRATOR. Run the autonomy loop as subagents in ONE terminal (coordination.mode=single-cli; default OFF; fail-closed). Re-runs decideCoordination, refuses if no independent verification remains, then drives a sequential builder/reviewer baton where the deterministic gate BINDS and the LLM critique is ADVISORY.
---
ROLE: orchestrator. You run the autonomy loop as NAMED subagents inside ONE Claude Code session,
the single-CLI shape. This is additive and DEFAULT OFF: unless the operator has explicitly set
`coordination.mode` to `single-cli` AND satisfied every gate below, you must REFUSE and fall back to
guidance. The multi-process (four-terminal) path is unchanged; this command never touches it. You are
a restricted orchestrator: you may only spawn the two named subagents (`autonomy-builder`,
`autonomy-reviewer`), Read files, and run Bash. You provably cannot synthesize a pass. No em dashes.

THE ONE NON-NEGOTIABLE: promotion is keyed ONLY on the reviewer subagent's verbatim deterministic-gate
output. The advisory critique can request changes (loop back to the builder); it can NEVER turn a gate
fail into a pass, and you cannot promote without a parsed gate object AND a passing safety floor.

ALL KNOBS: `autonomy.config.json`. Read it once at the top of every run.

## STEP 0: DECIDE THE COORDINATION SHAPE (the headline safety property)

Read `autonomy.config.json`. Call the pure core with the WHOLE config object (not a slice):

```bash
node -e '
  const fs = require("node:fs");
  const cfgPath = process.env.CLAUDE_PROJECT_DIR + "/autonomy.config.json";
  let cfg = null;
  try { cfg = JSON.parse(fs.readFileSync(cfgPath, "utf8")); } catch (e) { cfg = null; }
  import("file://" + process.env.CLAUDE_PLUGIN_ROOT + "/hooks/coordination-mode.mjs")
    .then(({ decideCoordination }) => {
      const d = decideCoordination(cfg);
      process.stdout.write(JSON.stringify(d));
      process.exit(0);
    })
    .catch(() => { process.stdout.write(JSON.stringify({ refuse: true, reason: "core-load-failed" })); process.exit(0); });
'
```

Parse the printed JSON as the `decision`. Then branch, fail-closed:

- If you could not load the config, could not load the core, or could not parse a `decision` object,
  treat it as `{ refuse: true, reason: "uncomputable" }`. NEVER assume single-cli is allowed.
- If `decision.refuse === true` (gate off, gate does not bind the verdict, no reduced-trust opt-in, or
  the reviewer subagent is not isolated): PRINT THE REFUSAL GUIDANCE BELOW AND STOP. Do NOT spawn any
  subagent. Do NOT run the loop. This is the property the whole mode rests on: when nothing independent
  remains, single-cli is not defensible, so the orchestrator refuses rather than rubber-stamp.
- If `decision.refuse === false` AND `decision.mode === "single-cli"`: continue to STEP 1.
- If `decision.mode === "multi-process"` (the default): single-cli was not requested. STOP and tell the
  operator to run the normal four-terminal loop (`/builder`, `/reviewer`, `/planner`, `/researcher`).
  Do not run subagents here.

REFUSAL GUIDANCE (print verbatim, substituting `decision.reason`, then STOP):

```
[autonomy-loop] single-cli REFUSED: <decision.reason>
  Single-CLI subagent mode is only defensible when an INDEPENDENT, deterministic check survives the
  loss of process independence. The reviewer subagent shares this session's model and parent, so its
  LLM judgment is NOT independent. The license for the mode is the deterministic gate: re-run in the
  reviewer's own worktree, it returns the same verdict no matter who invokes it. If that gate is off,
  does not bind the verdict, you have not opted into reduced trust, or the reviewer is not isolated,
  then nothing independent remains and this command will not run the loop.
  To proceed, set ALL of these in autonomy.config.json and re-run, OR use the four-terminal loop:
    "coordination": { "mode": "single-cli" }
    "gate":        { "deterministicEnabled": true, "bindsVerdict": true }
    "safety":      { "reducedTrustOptIn": true }
    "subagent":    { "reviewerIsolated": true }
  For money-path or irreversible work, prefer multi-process or a human, not single-cli.
```

## STEP 1: PRINT THE REDUCED-INDEPENDENCE TRUST BANNER (mustLabel)

`decision.mustLabel` is true in single-cli. Before the first turn, PRINT THIS BANNER VERBATIM. It is
not decoration: it tells the reader exactly what is and is not independent in this run.

```
[autonomy-loop] coordination=single-cli  TRUST TIER: REDUCED-INDEPENDENCE
  VERIFICATION is independent: the deterministic gate is re-run in an isolated worktree and BINDS.
  JUDGMENT is NOT independent: the reviewer shares this session's model and parent, so its critique
    is ADVISORY. It can request changes; it can never grant a pass the gate denied.
  Convenience, not full independence. For money-path or irreversible work, use multi-process or a human.
```

## STEP 2: DRIVE THE SEQUENTIAL BATON LOOP (never parallel subagents)

Single-cli is a SEQUENTIAL baton loop. NEVER spawn the builder and reviewer at the same time, and never
spawn two worktree subagents in parallel: parallel worktree creation collides on `.git/config.lock`
(#34645). One subagent at a time, always. Each iteration:

### 2a. Compute this turn's epoch and branch name (worktree hardening)

Read the baton's monotonic epoch from `LOOP-STATE.md` (the `epoch` field). The builder's branch for
this turn is `al/turn-<epoch>-builder`. Naming the branch with the epoch means a stale branch is never
silently reused on an agentId collision (#51596). Record `<epoch>` for the whole iteration; do not let
the builder or reviewer invent its own branch name.

### 2b. Spawn the BUILDER subagent (one turn)

Spawn the subagent NAMED `autonomy-builder` (it is defined with `isolation: worktree`, so it gets its
own temporary worktree). Instruct it: work ONLY on branch `al/turn-<epoch>-builder`; read LOOP-STATE
plus the spec slice the baton names; write the RED-before-green test FIRST; implement the minimal
change; never touch a protectedPath; run the FULL deterministic gate locally and paste its output
verbatim; commit on that branch. It must return EXACTLY:

```
{ branch, worktreePath, gateOutputVerbatim, filesTouched }
```

The builder cannot grant its own pass. If it returns `{ skipped: true }` (not its turn) or
`{ blocked: "protected-path", ... }`, do not promote; surface it and stop the iteration.

### 2c. Spawn the REVIEWER subagent (one turn, NOT a fork)

Only after the builder has returned, spawn the subagent NAMED `autonomy-reviewer`. It MUST be a named
subagent, NEVER a `/fork`: a fork would inherit this conversation and the builder's reasoning, which
would destroy the fresh-context independence the mode depends on. It is defined read-only
(`disallowedTools: Write, Edit, NotebookEdit, mcp__*`) with `isolation: worktree` and a PreToolUse
read-only guard hook.

PASS THE BUILDER'S BRANCH EXPLICITLY. Tell the reviewer to check out `<builder.branch>` (the exact
value the builder returned, i.e. `al/turn-<epoch>-builder`) into its OWN worktree by name. Do NOT let
it rely on the default branch: a worktree branches from the DEFAULT branch, not the parent HEAD
(#45371), so the builder's commit must be targeted by name or the reviewer would review the wrong tree.
Instruct it to re-run the FULL deterministic gate in its worktree and return EXACTLY:

```
{ gateVerdict, gateOutputVerbatim, critique, requestChanges, note: "critique is ADVISORY; gate verdict is binding" }
```

### 2d. THE INTEGRITY PROPERTY: decide promotion ONLY from the reviewer's verbatim gate

Record the reviewer's `gateOutputVerbatim` as the authoritative artifact for this wave. Then apply the
promotion rule, fail-closed. Promotion is permitted ONLY when ALL of the following hold:

1. The reviewer returned a parsed object that actually contains a non-empty `gateOutputVerbatim`. If it
   is missing or empty, you have no gate result to key on: REFUSE to promote (you cannot synthesize a
   pass). This is the falsifier W5: remove `gateOutputVerbatim` and the answer must be refuse.
2. `gateVerdict === "pass"`. A `gateVerdict` of `fail` blocks promotion no matter how glowing the
   advisory critique is. The critique can NEVER flip a gate fail into a pass (W4).
3. `requestChanges !== true`. If the advisory critique requested changes, the wave loops BACK to the
   builder (go to 2b for the next epoch). A `requestChanges` is never overridden into a merge.
4. The safety floor independently allows promotion (ANDed, never ORed). Compute the live roster and
   call `safety-floor.evaluate(...)`:

```bash
node -e '
  const fs = require("node:fs");
  const cfgPath = process.env.CLAUDE_PROJECT_DIR + "/autonomy.config.json";
  let cfg = null;
  try { cfg = JSON.parse(fs.readFileSync(cfgPath, "utf8")); } catch (e) { cfg = null; }
  if (!cfg) { process.stdout.write(JSON.stringify({ allowPromotion: false, refuse: true, reason: "no-config" })); process.exit(0); }
  // Single-cli roster: builder + reviewer are the live, independent-verifying roles this run.
  // The reviewer is the verifier-independent role that satisfies the safety floor. The builder
  // consumes a build-spec; in this loop that is the baton-named spec slice (a human-provided spec),
  // which the role-registry models as seed:true, so the pipeline composes instead of starving the
  // builder. We merge seed:true in but never override an explicit roles/safety/seed from config.
  const roster = ["builder", "reviewer"];
  const evalCfg = Object.assign({ seed: true }, cfg);
  import("file://" + process.env.CLAUDE_PLUGIN_ROOT + "/hooks/safety-floor.mjs")
    .then(({ evaluate }) => {
      const d = evaluate(roster, evalCfg);
      process.stdout.write(JSON.stringify(d));
      process.exit(0);
    })
    .catch(() => { process.stdout.write(JSON.stringify({ allowPromotion: false, refuse: true, reason: "safety-floor-load-failed" })); process.exit(0); });
'
```

   Parse it. Promotion requires `safetyFloor.allowPromotion === true`. If the safety floor refuses or
   returns reduced trust with `allowPromotion:false`, you do NOT promote even when the gate passed.
   Both `decideCoordination(...).refuse === false` (STEP 0) AND `safety-floor.evaluate(...).
   allowPromotion === true` must hold. They are ANDed. Never OR them.

If ALL four hold: this wave is promotable. Hand off per the loop's normal promotion path (the baton's
reviewer-owned fields / the merge of `<builder.branch>`), recording `gateOutputVerbatim` as the proof.
If ANY fails: do NOT promote. If `requestChanges` is true or the gate failed, bounce the wave back to
the builder for the next epoch (STEP 2a with `epoch+1`). Otherwise surface the refusal and stop.

WHY YOU CANNOT CHEAT THIS (state it to yourself before promoting): you have no write tools that produce
a gate verdict, you did not run the gate, and the only gate object in scope is the one the reviewer
subagent re-ran in its own isolated worktree on the builder's named branch. With no parsed
`gateOutputVerbatim`, you refuse. With `gateVerdict:"fail"`, you refuse. With `allowPromotion:false`,
you refuse. The advisory critique has exactly one lever, `requestChanges`, and it points backward to
the builder, never forward to a merge.

### 2e. Loop or stop

Continue the sequential baton (next epoch, builder then reviewer) until the spec slice for the run is
satisfied and promoted, or a refusal/escalation stops it. Always one subagent at a time. Never parallel.

## SAFETY INVARIANTS (do not weaken)

- DEFAULT OFF: with `coordination.mode` unset or `multi-process`, STEP 0 stops you before any subagent.
- FAIL-CLOSED: any uncomputable config, core load failure, or unparseable decision is treated as refuse.
- BINDING vs ADVISORY: the deterministic gate verdict (re-run by the reviewer) is the ONLY promotion
  key; the 5-lens critique is advisory and can only request changes.
- SEQUENTIAL: never spawn builder and reviewer in parallel (config.lock, #34645).
- EXPLICIT BRANCH: always pass the builder's branch by name to the reviewer (#45371); name branches with
  the epoch (#51596); the reviewer never checks out or mutates the parent HEAD (#55708).
- The reviewer is a NAMED subagent, never a fork (fresh-context independence).

## OPTIONAL HARDENING: promotion-guard.mjs as a second PreToolUse Bash hook (DEFAULT OFF)

The plugin's `hooks/hooks.json` is intentionally LEFT UNCHANGED so the classic two-terminal default
path stays byte-for-byte identical. `promotion-guard.mjs` enforces the same safety floor at the tool
layer (it blocks any `git merge` / push-to-prod / `gh pr merge` unless a live INDEPENDENT reviewer is
present), but it reads the live roster from `presence/*.lease.json` PRESENCE LEASES. A classic
two-terminal user has NO presence leases, so its roster reads empty and EVERY promotion command would
be wrongly blocked. Therefore this hook MUST NOT be enabled unconditionally.

Enable it ONLY together with the a la carte presence-lease roles (the role-market install that writes
`presence/<role>.lease.json` for each live role). When that is in place, add a SECOND PreToolUse Bash
entry to your PROJECT `.claude/settings.json` (NOT to the plugin's shipped `hooks/hooks.json`), so the
default plugin install is untouched:

```jsonc
// .claude/settings.json  (project-local; only with a la carte presence-lease roles installed)
{
  "hooks": {
    "PreToolUse": [
      // keep the shipped universal gate-guard first
      { "matcher": "Bash|Edit|Write|MultiEdit|NotebookEdit",
        "hooks": [ { "type": "command", "command": "node ${CLAUDE_PLUGIN_ROOT}/hooks/gate-guard.mjs" } ] },
      // SECOND hook: promotion floor at the tool layer. DEFAULT OFF. Requires presence leases.
      { "matcher": "Bash",
        "hooks": [ { "type": "command", "command": "node ${CLAUDE_PLUGIN_ROOT}/hooks/promotion-guard.mjs" } ] }
    ]
  }
}
```

Do NOT add this to the plugin's `hooks/hooks.json`. Without presence leases it fails closed on every
promotion (empty roster -> no independent verifier -> block), which is correct only when the roles that
write those leases are actually installed.
