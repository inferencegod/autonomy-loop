# Launch notes (for the author)

A checklist + honest copy for open-sourcing this. The thread is written to *credit priors and
under-claim* - overclaiming in a crowded space is how you get dunked on. Better to be the person
who shipped a sharp, honest tool than the person who "invented" something that already exists.

## Pre-flight (do before posting)

- [ ] `node --test test/gate-guard.test.mjs` passes.
- [ ] `claude plugin validate` is clean.
- [ ] Replace every `inferencegod` / `inferencegod` placeholder (plugin.json, marketplace.json, LICENSE, README install block).
- [ ] Fresh-clone test: `claude plugin marketplace add https://github.com/inferencegod/autonomy-loop` -> `install` -> `/autonomy-loop:autonomy-init` works.
- [ ] Record the demo GIF (`demo/demo.tape`, see below) and drop it under the README's "What it actually is".
- [ ] Confirm no project-specific artifacts leak (no golden files, no private branch names, no API keys).
- [ ] Add repo topics: `claude-code`, `claude-code-plugin`, `ai-agents`, `code-review`, `developer-tools`.

## Twitter / X thread (honest version)

**1/**
Open-sourced a Claude Code plugin: two terminals on one repo - a builder and an *adversarial* reviewer - passing a git baton through a frozen-invariant safety gate.

Self-driving loops aren't new. The discipline around this one is the point. 🧵

**2/**
The reviewer's only win condition is finding fault.
It re-runs your gate from scratch (never trusts "tests pass"), spawns a 5-lens critic panel - correctness · honesty · regression · security · UX - and has to argue *why the change is wrong* before it can approve.

**3/**
A "frozen invariant" the loop can't quietly re-baseline.
You declare what must stay byte-identical - golden tests, a recorded API contract. Drift needs a human GO. The loop escalates instead of overwriting your source of truth.

**4/**
A no-fabrication rule, injected into both prompts.
Every number a build emits carries its sample size, or it says "building - N/30." A feature with no real data abstains *visibly* instead of inventing a plausible-looking value.

**5/**
Honest about the safety hook: it's a defense-in-depth *tripwire, not a sandbox.*
It blocks prod-branch pushes, force-push, history rewrite, and writes to protected paths - with unit tests for the bypasses I could think of. Real containment is still branch protection + a container.

**6/**
Credit where due: Anthropic ships /loop, hooks, and agent teams; the community has builder/reviewer loops already. This is a specific *combination* - adversarial multi-lens review + human-gated invariant + anti-fabrication + per-project config - packaged as one installable plugin.

**7/**
MIT. One `autonomy.config.json` points it at any repo.
`claude plugin marketplace add https://github.com/inferencegod/autonomy-loop`
Repo + docs: [link]
If you've built something similar I'd genuinely like to compare notes. 👇

## What to expect / how to respond

- "This already exists" -> agree, link the README's Prior art, point at the specific combination. Don't get defensive.
- "Does the hook actually stop X?" -> point to the LIMITATIONS section; it's a tripwire, you said so first.
- "Token cost?" -> the Cost section: cheap critics in parallel, expensive judge only on escalation.
