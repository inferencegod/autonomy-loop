// autonomy-loop: turn-scheduler. Pure decision core for driving the baton over a DYNAMIC,
// auto-detected roster. The turn cursor advances over live roles in rank order, skips absent
// ones (they simply are not in the roster), and reclaims the turn when the pointed-to role has
// died. Every reassigning write bumps the monotonic epoch (the fencing token), so a zombie that
// wakes cannot win. Routing state (the cursor) is kept separate from work state (the baton body).
// No I/O, no deps, fail-closed. (Spec A-turn-scheduler.)

const RANK = { researcher: 1, planner: 2, builder: 3, reviewer: 4 };

function ranked(roster) {
  return [...new Set(roster || [])].filter((r) => RANK[r]).sort((a, b) => RANK[a] - RANK[b]);
}

// advanceTurn: from the current holder, return the next LIVE role in rank order (wrapping),
// and the next epoch. Absent/stale roles are not in `roster`, so skipping is emergent.
// If the current holder is not in the roster (it just died/left), start from the top of the roster.
// FAIL-CLOSED: empty roster -> { nextHolder: null } (caller must park, never spin).
export function advanceTurn(currentHolder, roster, epoch) {
  const live = ranked(roster);
  const e = Number(epoch);
  const newEpoch = Number.isInteger(e) ? e + 1 : 1;
  if (live.length === 0) return { nextHolder: null, newEpoch, reason: "empty-roster" };

  const idx = live.indexOf(currentHolder);
  if (idx === -1) {
    // holder absent: hand to the highest-ranked live role.
    return { nextHolder: live[0], newEpoch, reason: "holder-absent" };
  }
  const next = live[(idx + 1) % live.length];
  return { nextHolder: next, newEpoch, reason: "ok" };
}

// reclaim: if the baton points at a role whose lease is NOT live, produce a baton update that
// reassigns the turn to the next live role and bumps the epoch. Returns null when no reclaim is
// needed (the pointed-to role is live) or impossible (no live roles).
//   baton: { turn, epoch }
//   isLiveFn: (role) => bool   (injected; in practice presence.isLive bound to nowUtc)
export function reclaim(baton, roster, isLiveFn) {
  if (!baton || typeof baton !== "object") return null;
  const live = ranked(roster);
  if (live.length === 0) return null;
  const holder = baton.turn;
  // If the holder is live, nothing to reclaim.
  if (holder && typeof isLiveFn === "function" && isLiveFn(holder)) return null;
  // Holder is dead/absent: advance from it (advanceTurn handles the absent case).
  const { nextHolder, newEpoch } = advanceTurn(holder, live, baton.epoch);
  if (!nextHolder) return null;
  return { turn: nextHolder, epoch: newEpoch, reason: "reclaimed-from-dead-holder" };
}

// commitAccepted: an epoch-guarded write is accepted only if it carries exactly baton.epoch+1.
// Two simultaneous reclaim/advance attempts: only the one matching the expected next epoch wins;
// the loser re-reads and retries. FAIL-CLOSED on non-integer input.
export function commitAccepted(writeEpoch, batonEpoch) {
  const w = Number(writeEpoch);
  const b = Number(batonEpoch);
  if (!Number.isInteger(w) || !Number.isInteger(b)) return false;
  return w === b + 1;
}

// hasDeadlock: a sanity predicate for tests/telemetry. With >=1 live role, advanceTurn must always
// return a live role; deadlock would be returning null despite a non-empty roster.
export function wouldDeadlock(currentHolder, roster, epoch) {
  const live = ranked(roster);
  if (live.length === 0) return false; // empty is "park", not deadlock
  const { nextHolder } = advanceTurn(currentHolder, live, epoch);
  return nextHolder === null;
}

export const _internal = { RANK, ranked };
