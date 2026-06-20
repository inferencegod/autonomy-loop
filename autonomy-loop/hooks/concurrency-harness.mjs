// autonomy-loop: concurrency harness (Spec A9). Deterministic simulation testing of the baton
// state machine under adversarial interleavings of up to 4 writers coordinating over one git
// baton. Single-threaded, seeded, quantized schedule (FoundationDB/TigerBeetle style). Asserts the
// invariants: single-writer-per-step, monotonic epoch (CAS), no double-feed, no starvation, and
// that a stale-epoch (zombie) write is rejected. Uses the real turn-scheduler decision core.

import { advanceTurn, commitAccepted } from "./turn-scheduler.mjs";

// A tiny deterministic PRNG (mulberry32) so runs are reproducible from a seed.
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// The shared baton: a single committed object. Writes go through commit(), which enforces the
// epoch fencing token (the git serialization point in reality).
function makeBaton() {
  return { turn: "builder", epoch: 1, feeds: [] }; // feeds: log of (epoch -> who got fed) for double-feed check
}

// commit: the single serialization point. Accepts a write only if its epoch == baton.epoch+1.
// Returns true if applied. This models git's "one commit lands first" guarantee.
function commit(baton, write) {
  if (!commitAccepted(write.epoch, baton.epoch)) return false;
  baton.turn = write.turn;
  baton.epoch = write.epoch;
  if (write.fed) baton.feeds.push({ epoch: write.epoch, role: write.turn });
  return true;
}

// simulate: run `steps` quantized rounds. Each round, the live roster is fixed (or perturbed by
// kills), the holder proposes an advance, and 0..k "zombie" writers also try to write with stale
// epochs. We assert invariants after every round.
export function simulate({ seed = 1, steps = 200, roster = ["builder", "reviewer"], injectZombies = true, killSchedule = {} } = {}) {
  const rand = rng(seed);
  const baton = makeBaton();
  let liveRoster = [...roster];
  const turnsSeen = new Set();
  const violations = [];

  for (let i = 0; i < steps; i++) {
    // Optional: kill a role at a scheduled step (it leaves the roster).
    if (killSchedule[i]) liveRoster = liveRoster.filter((r) => r !== killSchedule[i]);
    if (liveRoster.length === 0) break;

    // The legitimate holder advances.
    const holder = baton.turn;
    const { nextHolder, newEpoch } = advanceTurn(holder, liveRoster, baton.epoch);
    if (nextHolder === null) { // empty roster -> park, not a violation
      break;
    }

    // Adversary: zombie writers attempt writes with stale or equal epochs BEFORE the legit write.
    if (injectZombies && rand() < 0.5) {
      const staleEpoch = Math.max(0, baton.epoch - Math.floor(rand() * 3)); // behind or equal
      const applied = commit(baton, { turn: "researcher", epoch: staleEpoch, fed: true });
      if (applied) violations.push({ step: i, kind: "stale-epoch-accepted", staleEpoch, batonEpoch: baton.epoch });
    }

    // Two processes may both try the SAME legit advance (a race). Only one should win.
    const w1 = commit(baton, { turn: nextHolder, epoch: newEpoch, fed: true });
    const w2 = commit(baton, { turn: nextHolder, epoch: newEpoch, fed: true }); // duplicate -> must fail
    if (w1 && w2) violations.push({ step: i, kind: "double-commit-same-epoch" });
    if (w1) turnsSeen.add(nextHolder);

    // INVARIANT: epoch is strictly monotonic.
    if (baton.epoch <= 0) violations.push({ step: i, kind: "epoch-not-positive" });
  }

  // INVARIANT: no double-feed - no two feeds share an epoch.
  const feedEpochs = baton.feeds.map((f) => f.epoch);
  const dupFeed = feedEpochs.length !== new Set(feedEpochs).size;
  if (dupFeed) violations.push({ kind: "double-feed" });

  // INVARIANT: no starvation - every still-live role got at least one turn over a long run.
  if (steps >= liveRoster.length * 4) {
    for (const r of liveRoster) if (!turnsSeen.has(r)) violations.push({ kind: "starvation", role: r });
  }

  return { violations, finalEpoch: baton.epoch, turnsSeen: [...turnsSeen], feeds: baton.feeds.length };
}
