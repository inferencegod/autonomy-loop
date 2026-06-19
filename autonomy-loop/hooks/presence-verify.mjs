// hooks/presence-verify.mjs - pure core verifyRoster. Replaces the file-only roster that P0-3 forged: a
// role is PRESENT only if its lease heartbeat is fresh AND a real process holds its liveness lock, and
// SEPARATED only if the lease file is owned by a different OS principal than the builder. The impure
// runner supplies the stat'd owner uid/sid and the lock/socket liveness; this core only decides.
// Fail-closed: missing or ambiguous evidence -> not present, not separated. No deps beyond pure isLive.
import { isLive } from "./presence.mjs";

// verifyRoster(input) -> { present:[role], byRole:{role:{present,live,separated}}, reviewer:{...} }
//   input.leases   : [{ role, ownerUid, ownerSid, heartbeatUtc, ttlSeconds, pid }]
//   input.liveness : { role: boolean }   (a process provably holds the role's lock / socket)
//   input.self     : { uid, sid, platform }   (the builder's own identity)
//   input.nowUtc
export function verifyRoster(input = {}) {
  const leases = Array.isArray(input.leases) ? input.leases : [];
  const liveness = input.liveness && typeof input.liveness === "object" ? input.liveness : {};
  const self = input.self && typeof input.self === "object" ? input.self : {};
  const nowUtc = input.nowUtc;
  const byRole = {};
  for (const lease of leases) {
    if (!lease || !lease.role) continue;
    const heartbeatFresh = isLive(lease, nowUtc);                  // existing pure heartbeat/TTL check
    const live = heartbeatFresh && liveness[lease.role] === true;  // fresh heartbeat AND a real holder
    byRole[lease.role] = { present: live, live, separated: isSeparated(lease, self) };
  }
  const present = Object.keys(byRole).filter((r) => byRole[r].present);
  const reviewer = byRole.reviewer || { present: false, live: false, separated: false };
  return { present, byRole, reviewer };
}

function isSeparated(lease, self) {
  if (self.platform === "win32") {
    // fs.stat().uid is ALWAYS 0 on Windows; only an owner SID can prove separation (honest punt if absent).
    return typeof lease.ownerSid === "string" && lease.ownerSid.length > 0
      && typeof self.sid === "string" && self.sid.length > 0 && lease.ownerSid !== self.sid;
  }
  // POSIX: a different owning uid, and the builder itself is not root (root can forge any ownership).
  return Number.isInteger(lease.ownerUid) && Number.isInteger(self.uid)
    && self.uid !== 0 && lease.ownerUid !== self.uid;
}
