---
description: Lock the autonomy-loop control plane read-only so a bypassed gate cannot disable itself (v0.8 Ring 1)
---
Harden this repo's control plane so the gate cannot be edited away by the agent it guards. Run:

`node ${CLAUDE_PLUGIN_ROOT}/hooks/harden-control-plane.mjs`

For every `protectedPaths` entry in `autonomy.config.json` plus the plugin `hooks/` dir it MATERIALIZES the path if absent (touch empty) then locks it read-only: on POSIX `chmod a-w` then `chattr +i` where the filesystem supports it; on Windows `icacls <path> /deny "<agent-user>:(W)"`. Materialize-then-lock is mandatory and idempotent: you cannot read-only-protect a file that does not exist yet (a missing file is a write primitive an injected agent can use to create and inject into).

Report the per-target result. Then print the durable-ownership guidance: the strongest barrier is to `chown` the control plane to a NON-agent user and run the agent as a user that is not the owner, because a chmod/chattr the agent itself owns it could in principle reset. After this runs, the `SessionStart` preflight (`hooks/preflight.mjs`) probes the same set and reads `controlPlaneWritable: false`, which clears the refusal that points here.

This is the local Ring 1 lockdown. It is not a substitute for the OS sandbox (`/launch-sandboxed`) or server-side prod protection (`/autonomy-init` step 2); it is the cheap, high-value first barrier. On Windows, if `icacls` cannot enforce write denial for your setup, the preflight refuses the local-hardening tiers and points you at the devcontainer / WSL or the OS-independent forge guarantee (server-side required review) instead.
