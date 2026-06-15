# autonomy-loop — marketing pass (the launch plan)

> Principle: lead with what's genuinely UNOCCUPIED (the self-writing prompt + the no-fabrication
> lens + the committed-baton two-terminal topology). Do NOT lead with "adversarial reviewer" or
> "safety hook" — both are crowded and invite the "already exists" reply. Credit priors. No invented
> metrics. Let the mechanics do the flexing.

## 1. The hook (first 3 seconds — make or break)
Cold-open on the line that stops the scroll. Pick one, test both:
- **A (curiosity):** black screen → types `two terminals. one repo. they argue until the code is right.`
- **B (the flex):** the baton scene mid-motion → overlay `you stop writing prompts. the loop writes its own.`
Recommend A for the teaser, B for the full clip's open. No logo first — earn the logo.

## 2. Two cuts from the same scenes
- **Teaser (~12–15s, top of the X thread, autoplay-silent-friendly):** Title (0–2s) → baton ping (2–5s)
  → "the loop writes its own next move" quick (5–9s) → DENIED stamp slam (9–12s) → CTA (12–15s).
  Add big on-screen captions (most X autoplay is muted). Export 1:1 (1080×1080) AND 16:9.
- **Full explainer (~37s, the README + reply / YouTube):** the current 8-scene Clip. Keep sound.

## 3. Soundtrack
Muted-first for the teaser (captions carry it). For the full cut: a minimal, building synth/lofi —
quiet under the talky scenes, a beat-drop on the DENIED slam. Royalty-free sources: Pixabay Music,
Uppbeat, YouTube Audio Library. Keep it under the VO/captions, never over.

## 4. Transitions (replace the hard cuts)
- Scene-to-scene: a fast 6–8 frame cross-dissolve or a quick slide in the baton's travel direction
  (builder→reviewer = left-to-right) so the "handoff" motif carries visually.
- Hold the DENIED stamp an extra beat (it's the emotional peak), then smash-cut to "no fabrication."
- CTA: let the install command sit on screen 2+ seconds — people screenshot it.

## 5. Social-preview card (the repo og:image — 1280×640)
Dark bg (#0b0f14). Left: `autonomy-loop` wordmark + one line "two terminals. one repo. a git baton."
Right: a tiny baton diagram (Builder ⇄ Reviewer). Bottom strip: `MIT · claude code plugin`. This is
what unfurls when the repo link is pasted anywhere — set it as the GitHub repo social preview AND a
README banner. (Can render this as a still Remotion frame.)

## 6. The X thread (pairs with the teaser; honest)
**1/** [teaser video] Open-sourced a Claude Code plugin: two terminals on one repo — a builder and an
adversarial reviewer — passing a git baton, gated by a frozen invariant and a no-fabrication rule.
The loop writes its own next prompt. 🧵

**2/** It's a state machine, not a chat. The baton lives in a committed `LOOP-STATE.md`: whose turn,
last SHAs, and the next instruction — which the loop composes itself each tick from what just
happened. A crash just resumes from the last commit. You stop being the memory.

**3/** Thinking scales to the risk. Trivial diff → a quick cheap pass. Touch a frozen invariant or a
protected path → it escalates to a deep ultrathink review. Token-aware, tunable per project — you
don't pay Opus prices to approve a typo fix.

**4/** The reviewer's only win condition is finding fault: it re-runs your gate from scratch, runs a
5-lens review (correctness · honesty · regression · security · UX), and has to argue why the change
is WRONG before it can pass.

**5/** A no-fabrication rule, in both prompts: every number carries its sample size or says
"building — N/30." A feature with no real data abstains visibly instead of inventing a plausible one.

**6/** Honest about the safety hook: it's a defense-in-depth tripwire, not a sandbox — blocks prod
push, force-push, history rewrite, protected files, with unit tests for the bypasses. Real
containment is still branch protection + a container.

**7/** Credit where due: Anthropic ships /loop, hooks, agent teams; the community has builder/reviewer
loops (claude-review-loop, continuous-claude, compound-engineering). What I haven't seen combined:
self-triggering ideation + a no-fabrication lens + a committed-baton two-terminal topology, in one plugin.

**8/** MIT. Point it at any repo via one config.
`claude plugin marketplace add https://github.com/inferencegod/autonomy-loop`
Repo + docs: [link]. Built something similar? I'd love to compare notes. 👇

## 7. One-liners (pick per surface)
- repo tagline: "Two Claude Code terminals that build, review, and re-prompt themselves — safely."
- the flex: "You stop writing prompts. The loop writes its own."
- the honest: "It can't fabricate a number, and it can't push to prod. By construction."

## Pre-post checklist
- [ ] Replace [link] with the live repo URL.
- [ ] Render teaser (1:1 + 16:9) with captions; render full explainer.
- [ ] Set the og:image social card on the repo + README banner.
- [ ] Repo topics: claude-code, claude-code-plugin, ai-agents, developer-tools, code-review.
- [ ] `claude plugin validate` clean; fresh-clone install test passes.
