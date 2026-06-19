// hooks/sandbox-detect.mjs - pure-ish sandboxLive() probe for the preflight (v0.8 "provision or refuse").
// Answers ONE question: is this agent running inside a live OS-level sandbox whose write/egress boundary
// puts the control plane (config, hooks, leases) out of the agent's write reach? The preflight feeds the
// boolean into decidePreflight as probe.sandboxLive; a true here unlocks (with the other probes) the
// T3-HARDENED unattended tier, so this MUST be fail-closed: it returns true ONLY on positive evidence of
// a real boundary, and false on absence, ambiguity, or any error. A sandbox the agent could itself
// disable is not a boundary (the Ona finding), so the boundary's own config lives outside allowWrite and
// is not what we detect here; we detect that a boundary is ACTIVE, not that it is correctly scoped.
//
// The pure core readsSandboxLive(env, probes) takes already-gathered evidence and decides, so it is
// unit-testable with no I/O. The thin sandboxLive() default-exports the impure gather (env + a few
// best-effort fs stats) and is what the preflight imports. No deps beyond node: builtins.
import { existsSync, readFileSync } from "node:fs";

// Truthy values for the launch-wrapper env marker. The launch-sandboxed wrapper sets AUTONOMY_SANDBOX=1
// AFTER it has established the srt / container boundary, so the marker is a positive attestation by the
// wrapper, not a self-assertion the agent can usefully forge from inside (forging it only LOWERS its own
// assurance gate's honesty; it cannot create write reach the OS boundary already removed).
const TRUE_SET = new Set(["1", "true", "yes", "on"]);
const isTrue = (v) => typeof v === "string" && TRUE_SET.has(v.trim().toLowerCase());

// readsSandboxLive(env, probes) -> boolean. PURE. Fail-closed: anything not positively a boundary => false.
//   env             : process.env-shaped object (read-only here)
//   probes.dockerenv: did /.dockerenv exist?                  (container indicator)
//   probes.cgroup   : contents of /proc/1/cgroup or /proc/self/cgroup, or "" (container indicator)
//   probes.srtMarker: did an srt / seatbelt / bubblewrap runtime marker exist? (sandbox-runtime indicator)
export function readsSandboxLive(env = {}, probes = {}) {
  const e = env && typeof env === "object" ? env : {};
  const p = probes && typeof probes === "object" ? probes : {}; // null/junk -> {} (fail-closed, never throw)

  // 1. Explicit launch-wrapper attestation. The strongest signal we have locally: the wrapper that built
  //    the boundary sets this. AUTONOMY_SANDBOX is the documented marker; AUTONOMY_SANDBOX_TIER carries
  //    which tier (srt | devcontainer | microvm) for the banner but is not required for the boolean.
  if (isTrue(e.AUTONOMY_SANDBOX)) return true;

  // 2. srt / seatbelt / bubblewrap runtime markers. Anthropic's sandbox-runtime (srt) and the common
  //    OS sandboxers export an env breadcrumb when they wrap a process; bubblewrap is detectable by its
  //    runtime dir. Each is positive evidence of an active boundary established by something other than
  //    the agent. We DO NOT treat a mere binary-on-PATH as evidence (installed is not active).
  if (isTrue(e.SBX_SANDBOX) || isTrue(e.SANDBOX_RUNTIME) || isTrue(e.SRT_ACTIVE)) return true;
  if (typeof e.SANDBOX_BACKEND === "string" && e.SANDBOX_BACKEND.trim() !== "") return true; // srt sets the backend it enforces
  if (p.srtMarker === true) return true;

  // 3. Container indicators. A container is a boundary only when paired with the wrapper marker above in
  //    a correctly-scoped launch; on its own a container does NOT prove the control plane is out of write
  //    reach (the repo could be bind-mounted writable). So a bare container indicator is necessary-looking
  //    but NOT SUFFICIENT here: we require the explicit AUTONOMY_SANDBOX attestation for the unattended
  //    tier and treat raw container signals as non-conclusive, returning false. They are surfaced for the
  //    banner by the runner, not promoted to a true. Fail-closed wins over "probably fine".
  //    (probes.dockerenv / probes.cgroup are accepted and ignored-for-truth on purpose; see SECURITY note.)
  void p.dockerenv; void p.cgroup;

  return false;
}

// Impure best-effort gather. Wrapped so a throw anywhere yields false (fail-closed). The preflight runner
// may also call readsSandboxLive directly with its own gathered probes; this default export is convenience.
export function sandboxLive(env = process.env) {
  try {
    const probes = {};
    try { probes.dockerenv = existsSync("/.dockerenv"); } catch { probes.dockerenv = false; }
    try {
      probes.cgroup = existsSync("/proc/1/cgroup") ? readFileSync("/proc/1/cgroup", "utf8")
        : (existsSync("/proc/self/cgroup") ? readFileSync("/proc/self/cgroup", "utf8") : "");
    } catch { probes.cgroup = ""; }
    try {
      // bubblewrap / podman leave a per-instance marker; srt / seatbelt set env handled in the pure core.
      // Treat a sandbox-flagged container marker as an srtMarker. Never throw out of here.
      probes.srtMarker = existsSync("/run/.containerenv") && /sandbox/i.test(safeRead("/run/.containerenv"));
    } catch { probes.srtMarker = false; }
    return readsSandboxLive(env, probes);
  } catch {
    return false; // fail-closed on any unexpected error
  }
}

function safeRead(p) { try { return readFileSync(p, "utf8"); } catch { return ""; } }

export default sandboxLive;
