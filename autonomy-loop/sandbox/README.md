# Sandbox tier (autonomy-loop v0.8)

The OS-level write + egress boundary the preflight requires for the unattended (T3-HARDENED) tier. The
gate-guard hook is a tripwire that only raises the bar; THIS is the layer that makes an out-of-bounds write
or an exfil call fail at the OS, regardless of interpreter, `cd`, or a bypassed gate. `hooks/sandbox-detect.mjs`
attests it to `hooks/preflight.mjs` (`probe.sandboxLive`), which clears the `sandboxNotLive` refusal.

Two boundaries SHIP; one harder boundary is DOCUMENTED as opt-in user-infra.

## Shipped: srt tier (default, no container needed)

`launch-sandboxed` wraps Anthropic's `@anthropic-ai/sandbox-runtime` (srt): native sandboxing via
`sandbox-exec` (macOS) or `bubblewrap` (Linux), plus proxy-based egress filtering.

- `launch-sandboxed` - the wrapper. Reads `autonomy.config.json`, generates the srt settings, exports
  `AUTONOMY_SANDBOX=1` (+ `SANDBOX_BACKEND=srt`), and execs `srt --settings <file> <shell-or-command>`.
  Exposed as the `/autonomy-loop:launch-sandboxed` command. Fail-closed: aborts before launch on any error,
  never starts an unsandboxed shell as a fallback.
- `srt-settings.gen.mjs` - emits the settings on stdout from `autonomy.config.json`. `allowWrite = ["."]`
  (the workspace); `denyWrite` = the control plane (`autonomy.config.json` + `hooks/` + every
  `protectedPaths` entry); `allowedDomains` = a tight egress allowlist that ALSO bounds the researcher
  web-fetch. Missing/unparseable config falls back to a SAFE-MINIMAL boundary (still denies the control
  plane), never a permissive one.
- `.srt-settings.json` - a human-readable TEMPLATE of the generated shape. The LIVE copy is generated to
  `$HOME/.config/autonomy-loop/srt-settings.json`, OUTSIDE the workspace.

Install: `npm install -g @anthropic-ai/sandbox-runtime` (Linux also needs `bubblewrap socat ripgrep`).
Knobs: `AUTONOMY_WORKSPACE`, `AUTONOMY_CONFIG`, `AUTONOMY_SRT_SETTINGS`, `AUTONOMY_EXTRA_DOMAINS`.

## Shipped: devcontainer tier (full container boundary)

`../.devcontainer/` is the opt-in container alternative, modeled on Anthropic's claude-code reference.

- `devcontainer.json` - sets `AUTONOMY_SANDBOX=1`, mounts the control plane (`hooks/`, `autonomy.config.json`)
  READ-ONLY (the container analog of `denyWrite`), and runs the firewall at start with `NET_ADMIN`/`NET_RAW`.
- `init-firewall.sh` - a default-deny iptables/ipset egress firewall: policy `DROP`, an ipset of the forge
  IP ranges + a resolved domain allowlist, `REJECT` for everything else, and a fail-closed verification step
  (a denied host MUST be unreachable AND the forge API reachable, or it exits non-zero). It lives under the
  read-only-mounted `.devcontainer/`, so the agent inside cannot edit it to widen the boundary.

## The self-disable invariant (the Ona finding)

Agents disable their own sandbox. So the boundary's config is OUTSIDE the agent's write reach:
- srt: the generated settings file is written outside the workspace (the wrapper REFUSES a settings path
  inside the workspace), and srt additionally hard-denies writes to `.git/hooks`, `.claude/commands`,
  `.claude/agents`, and `.mcp.json` even within an allowed path.
- devcontainer: the firewall script and the control plane are bind-mounted read-only.

## Documented: gVisor / Firecracker microVM tier (opt-in user-infra)

For untrusted code or a hostile-input researcher lane, a user-space-kernel (gVisor / `runsc`) or microVM
(Firecracker, e.g. via Kata Containers or Weave Ignite) boundary gives a stronger isolation guarantee than a
shared-kernel container: a kernel-level sandbox escape no longer reaches the host. This is NOT shipped as a
script because it is infrastructure you provision, not a file the plugin can drop in, and the right shape is
site-specific (orchestrator, image supply chain, networking). To adopt it: run the agent terminal inside a
gVisor/Firecracker guest, apply the same two rules (workspace-only writes via the guest's mount policy; the
egress allowlist via the guest's network policy), and export `AUTONOMY_SANDBOX=1` from the launch path so the
preflight probe attests the boundary. The plugin's contract is just that env marker plus the deny boundaries;
any tier that satisfies them is accepted.
