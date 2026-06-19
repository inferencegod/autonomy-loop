// autonomy-loop: presence. Pure decision core for à la carte role auto-detection.
// Roles are detected from per-role git lease files (presence/<role>.lease.json), each carrying
// a heartbeat timestamp, a TTL, and the loop's monotonic epoch as a fencing token. A role is
// "live" iff its lease heartbeat is within TTL. No I/O here (a thin impure wrapper reads/writes
// the files and commits); this module only DECIDES. Fail-closed. No deps. (Spec A2.)

const RANK = { researcher: 1, planner: 2, builder: 3, reviewer: 4 };

// Parse an ISO-8601 UTC timestamp to epoch millis. Returns NaN on anything malformed.
function parseUtc(s) {
  if (typeof s !== "string") return NaN;
  const t = Date.parse(s);
  return Number.isFinite(t) ? t : NaN;
}

// isLive: is this lease still valid as of nowUtc?
// FAIL-CLOSED: a malformed lease (bad/absent heartbeat or ttl, bad role) is treated as NOT live.
export function isLive(lease, nowUtc) {
  if (!lease || typeof lease !== "object") return false;
  if (!RANK[lease.role]) return false;
  const hb = parseUtc(lease.heartbeatUtc);
  const now = parseUtc(nowUtc);
  const ttl = Number(lease.ttlSeconds);
  if (!Number.isFinite(hb) || !Number.isFinite(now) || !Number.isFinite(ttl) || ttl <= 0) return false;
  // Elapsed-duration check (never wall-clock agreement): dead if heartbeat is older than TTL.
  // A heartbeat in the future (negative elapsed) is tolerated within one TTL (mild skew) but
  // rejected beyond that as a corrupt/skewed clock.
  const elapsedMs = now - hb;
  if (elapsedMs > ttl * 1000) return false;
  if (elapsedMs < -(ttl * 1000)) return false; // absurd future heartbeat -> fail-closed
  return true;
}

// roster: given all lease files, return the rank-ordered list of LIVE role ids.
// Deterministic, rank-sorted, no stale entries. Duplicate roles are de-duped (the live one wins;
// if both live, see detectDoubleClaim which flags the conflict for the caller to refuse).
export function roster(leases, nowUtc) {
  const liveRoles = new Set();
  for (const lease of leases || []) {
    if (isLive(lease, nowUtc)) liveRoles.add(lease.role);
  }
  return [...liveRoles].sort((a, b) => RANK[a] - RANK[b]);
}

// detectDoubleClaim: same role held by two DIFFERENT live pids -> a conflict the caller must
// resolve by refusing the newcomer (fail-closed). Returns the list of conflicted role ids.
export function detectDoubleClaim(leases, nowUtc) {
  const byRole = new Map(); // role -> Set<pid> of LIVE claims
  for (const lease of leases || []) {
    if (!isLive(lease, nowUtc)) continue;
    const role = lease.role;
    const pid = lease.pid;
    if (!byRole.has(role)) byRole.set(role, new Set());
    if (typeof pid === "string" && pid.length) byRole.get(role).add(pid);
  }
  const conflicts = [];
  for (const [role, pids] of byRole) if (pids.size > 1) conflicts.push(role);
  return conflicts.sort((a, b) => RANK[a] - RANK[b]);
}

// canClaim: may THIS process (myPid) claim `role` given the current leases?
// Yes if no LIVE lease for that role, or the only live lease is mine. No if someone else holds it.
// FAIL-CLOSED default: unknown role -> false.
export function canClaim(role, myPid, leases, nowUtc) {
  if (!RANK[role]) return false;
  for (const lease of leases || []) {
    if (lease.role !== role) continue;
    if (!isLive(lease, nowUtc)) continue;
    if (lease.pid !== myPid) return false; // someone else holds a live lease
  }
  return true;
}

// staleEpochRejected: fencing-token check. A write carrying `writeEpoch` against the current
// `batonEpoch` is only accepted if it is exactly batonEpoch+1 (the next monotonic step).
// A zombie that wakes with an old epoch is rejected. FAIL-CLOSED on non-numeric input.
export function epochAccepted(writeEpoch, batonEpoch) {
  const w = Number(writeEpoch);
  const b = Number(batonEpoch);
  if (!Number.isInteger(w) || !Number.isInteger(b)) return false;
  return w === b + 1;
}

export const _internal = { RANK, parseUtc };
