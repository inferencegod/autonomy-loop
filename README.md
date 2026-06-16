# autonomy-loop

**Two Claude Code terminals on one repo — a builder and an adversarial reviewer — passing a git baton through a frozen-invariant safety gate.** A Claude Code plugin you drop into any project and tune from one config file.

> Honest framing up front: the *idea* of a self-driving builder/reviewer loop is not new (see [Prior art](#prior-art)). What this gives you is a **specific, opinionated discipline** — an adversarial multi-lens reviewer, a *frozen-invariant* gate, and a no-fabrication rule — wired together and tunable per project. The value is in the constraints, not the novelty.

---

## What it actually is

Two terminals run `claude` in a `/loop` against the **same repo on different git worktrees**:

- **Terminal 1 — Builder.** Picks up the next task, writes code + a RED-before/GREEN-after test, runs the gate, commits to the work branch, hands off.
- **Terminal 2 — Reviewer.** Re-runs the gate itself, spawns a **5-lens critic panel** (correctness · honesty · regression · security · UX), red-teams the opposite, fixes what's safe, flags the rest, hands back.

They never talk in chat. The only shared state is a committed markdown file — **`LOOP-STATE.md`** — that holds the baton (`turn:`, `last-builder-sha`, `last-reviewed-sha`, the next instruction each way). State lives in git, so a crash just resumes from the last commit.

```mermaid
flowchart LR
    subgraph T1["Terminal 1 - Builder"]
      B1[read baton] --> B2[write code + RED-GREEN test] --> B3[run gate] --> B4[commit + push work branch]
    end
    subgraph T2["Terminal 2 - Reviewer worktree"]
      R1[read baton] --> R2[re-run gate] --> R3[5-lens critic panel<br/>+ red-team-the-opposite] --> R4[fix safe / flag rest]
    end
    B4 -->|turn: reviewer| R1
    R4 -->|turn: builder| B1
    R3 -.->|frozen-drift / unsafe / deadlock| H[(turn: human<br/>FOR-REVIEW.md)]
    GATE{{gate-guard hook:<br/>blocks prod push, force-push,<br/>history rewrite, protected writes}}
    B4 -. every tool call .-> GATE
    R4 -. every tool call .-> GATE
```

## Why you might want it

- **The reviewer is adversarial by construction.** Its only win condition is finding fault. It re-runs the gate from scratch (never trusts the builder's "tests pass"), spawns role-specialized critics, and must argue *why the change is wrong* before it's allowed to approve.
- **A frozen invariant the loop can't quietly re-baseline.** You declare what must stay byte-identical (golden/snapshot tests, a recorded API contract). Drift requires a human GO — the loop escalates, it doesn't overwrite.
- **A no-fabrication rule.** Every number a build emits must carry its sample size + interval, or say "building — N/30." A capability with no real data abstains *visibly* instead of inventing a plausible value.
- **Cost-aware.** Critics run on a cheap model in parallel; the expensive judge is only invoked when a wave escalates. See [Cost](#cost).
- **Portable.** One `autonomy.config.json` drives the branch names, gate commands, models, protected paths, and honesty rule. The plugin is project-agnostic.

## Install

```bash
# 1. add this repo as a plugin marketplace, then install
claude plugin marketplace add https://github.com/inferencegod/autonomy-loop
claude plugin install autonomy-loop

# 2. in your project, scaffold the config + baton
/autonomy-loop:autonomy-init

# 3. edit autonomy.config.json (branches, gate commands, protected paths), then:
#    Terminal 1:  claude  ->  /autonomy-loop:builder   ->  /loop 600
#    Terminal 2 (in the review worktree):  claude  ->  /autonomy-loop:reviewer  ->  /loop 600
```

`/loop 600` = self-schedule every 600s (10 min). Commands are namespaced `/autonomy-loop:<command>`.

## Configure

Copy `autonomy.config.example.json` -> `autonomy.config.json` at your repo root (it's gitignored — per-checkout). Key knobs:

| knob | what it does |
|---|---|
| `workBranch` / `prodBranch` | the loop only ever pushes `workBranch`; `prodBranch` is gated |
| `worktreePath` | where Terminal 2's worktree lives |
| `gate.test` / `gate.build` / `gate.lint` | your real commands — the reviewer re-runs them |
| `gate.coverage` | optional third gate: a command that emits a coverage summary; the reviewer ratchets coverage so it can never silently drop (see [Coverage ratchet](#coverage-ratchet-the-third-gate)) |
| `gate.frozenInvariant` | what must stay byte-identical without a human re-baseline |
| `protectedPaths` | edits **and** shell writes (`rm`/`mv`/`cp`/redirect/`sed -i`) here are blocked by the hook |
| `models.builder` / `reviewerCritics` / `reviewerJudge` | builder + cheap critics + escalation judge |
| `honestyRule` | the anti-fabrication contract injected into both prompts |

## Safety model & limitations

**Read this before you trust it.** The `gate-guard` PreToolUse hook is a **defense-in-depth tripwire, not a sandbox.** It catches the *common-case* dangerous actions and returns a structured denial the model can act on (escalate to a human), instead of crashing the agent.

What it blocks today (with unit tests in [`autonomy-loop/test/gate-guard.test.mjs`](autonomy-loop/test/gate-guard.test.mjs)): pushes/fast-forwards to `prodBranch` (including `HEAD:refs/heads/...` refspecs), force-push, history rewrite / `reset --hard` / `--mirror`, `gh` PR-merge/release/workflow shipping, and edits **or** shell writes/deletes targeting `protectedPaths`.

What it **cannot** do — be honest with yourself:

- A regex over shell commands cannot anticipate every trick (novel tools, exotic git refs, a script that writes a script). Treat it as a seatbelt, not a vault.
- PreToolUse hooks are **not reliably enforced for sub-agent tool calls** — a spawned agent may bypass the hook. Don't rely on it as your only barrier.
- If `autonomy.config.json` is missing/unparseable, the hook prints a **visible warning** and falls back to universal git guards only (`protectedPaths` are *not* enforced). It fails loud, not silent — but it does fail open on paths.

**Real backstops** (use them in addition, not instead): server-side **branch protection** on `prodBranch`, **read-only file permissions** on golden/frozen files, and running the loop in a **container / disposable checkout**. The hook reduces blast radius; your infra is what actually contains it.

## Coverage ratchet (the third gate)

The builder writes a RED-before-green test for each change, and the reviewer runs the per-fix **bite**: revert the change, confirm its test goes RED. That proves every *new* test catches its own bug. It says nothing about the rest of the tree slowly losing coverage over hundreds of waves. The coverage ratchet closes that gap. Total coverage can never fall below a stored baseline (`.autonomy-coverage.json`), and the baseline only ever ratchets up, so coverage holes cannot quietly pile up wave after wave.

This is the drift layer; the bite is the assertion layer, and they ship together on purpose. Line coverage measures execution, not assertions (a suite with every assert deleted still scores 100%), so the ratchet is never a quality claim on its own. Pairing a coverage ratchet with a per-change bite as a built-in loop invariant is the part no mainstream coding agent ships today. The pieces exist as CI a human wires up, never inside the agent's own loop.

It is opt-in. Set `gate.coverage` to a command that writes an Istanbul `coverage-summary.json`:

```jsonc
// autonomy.config.json
"gate": { "coverage": "c8 --reporter=json-summary --reporter=text npm test" }
```

The reviewer then runs the bundled script, which blocks any wave that lowers coverage and bumps the floor on a real improvement:

```bash
node "$CLAUDE_PLUGIN_ROOT/hooks/coverage-ratchet.mjs"   # reads coverage/coverage-summary.json + .autonomy-coverage.json
```

The pure decision core lives in [`autonomy-loop/hooks/coverage-ratchet.mjs`](autonomy-loop/hooks/coverage-ratchet.mjs), unit-tested in [`autonomy-loop/test/coverage-ratchet.test.mjs`](autonomy-loop/test/coverage-ratchet.test.mjs). Leave `gate.coverage` empty to skip it.

## Cost

This burns tokens — two agents running continuously is the point. To keep it sane:

- Critics default to a **cheap model in parallel**; the **Opus-class judge fires only on escalation** (frozen-drift, protected-path, or a split panel). Most waves never touch it.
- Effort is **scaled to the diff**: pure-doc/trivial waves get one quick pass, not the full panel.
- Tune `loopIntervalSec` up if you don't need 10-minute cadence.
- The "model" knobs are **labels written into prompts, not a runtime switch** — set the actual model when you launch each terminal (`claude --model ...`). The config keeps them consistent; it doesn't enforce them.

## When NOT to use this

- One-off scripts or throwaway prototypes — the ceremony isn't worth it.
- Repos with no meaningful test/build gate — the reviewer has nothing to stand on.
- Anything where an agent pushing to a shared branch unattended is unacceptable, even gated.
- If you won't set up the real backstops above, run it only on a disposable checkout.

## Prior art

Self-driving and review-loop patterns are a crowded space, and this stands on them. Anthropic ships first-party `/loop`, hooks, and agent-team primitives; the community has shipped builder/reviewer and "keep going" loops (e.g. claude-review-loop, autoloop, the Ralph Wiggum pattern). This project's contribution is the *combination*: an adversarial multi-lens reviewer + a human-gated frozen invariant + a no-fabrication discipline + per-project config, packaged as one installable plugin. If you've built something similar, I'd genuinely like to compare notes.

## License

MIT — see [LICENSE](LICENSE).
