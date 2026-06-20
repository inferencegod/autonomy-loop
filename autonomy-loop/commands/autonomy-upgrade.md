---
description: Upgrade an existing autonomy-loop install to the current schema (safe, idempotent, run after a plugin update)
---
Bring THIS repo's loop up to date after you have updated the plugin. This is the one thing to run when you
move to a new version. It is safe to run any time: it only ADDS missing knobs with sane defaults, never
changes a value you set, and never resets the baton.

The full sequence is UNLOCK -> MIGRATE -> RE-LOCK: a hardened v0.8 install locks `autonomy.config.json`
read-only (it is one of the `protectedPaths`), so the migrate hooks below cannot rewrite it until it is
unlocked, and we re-lock it afterward so the control plane is protected again. Run the steps in order.

0. **UNLOCK the control plane so the migration can write the config.** Run
   `node ${CLAUDE_PLUGIN_ROOT}/hooks/harden-control-plane.mjs --unlock` from the repo root. This walks the same
   targets the lockdown protects (`protectedPaths` + the plugin `hooks/` dir) and makes them writable again
   (POSIX: `chattr -i` then `chmod u+w`; Windows: removes the deny ACE). It is best-effort and never aborts the
   upgrade: it prints a per-target result. If a target reports FAIL, it was chown'd to a non-agent OWNER (the
   durable barrier) and `chattr -i` needs THAT owner: have the owner run `chattr -i <path> && chmod u+w <path>`
   (or adjust ownership) for each FAIL, then re-run this step. On a fresh, never-hardened install nothing is
   locked and every target reports OK as a no-op. After this, the config is writable and the migrate hooks can run.

1. Run `node ${CLAUDE_PLUGIN_ROOT}/hooks/migrate-config.mjs` from the repo root. It tops up
   `autonomy.config.json` (the `breaker` block, `gate.selfMutate`, and the self-protecting `protectedPaths`
   entries) and `LOOP-STATE.md` (`epoch`, `no-progress-epochs`, `last-tree-sha`), writing back only what was
   missing. If `autonomy.config.json` is not valid JSON it refuses to touch it and tells you to fix it first.
2. Report exactly what it added, or that everything was already current.

2b. **ADDITIVE v0.7.0 + roles migration.** SIMPLEST and REQUIRED under v0.8: run the trusted hook
   `node ${CLAUDE_PLUGIN_ROOT}/hooks/migrate-roles.mjs` from the repo root. It does the whole roles + v0.7.0
   migration in ONE gate-allowed write: it migrates the legacy `{research, planner}` booleans to the à la carte
   `auto|off|required` shape (legacy `true` -> `auto`, `false` -> `off`, absent -> the presence-driven `auto`
   default), and tops up `coordination` / `subagent` / `convergence` / `scope` / `speed` plus the rigor routers
   (`gate.verifyGate: "govern"`, `gate.requireProdProtection: true`) at the example-config defaults, only-if-missing,
   idempotent, never resetting the baton. Report what it added. Do NOT use an inline `node -e` write to
   `autonomy.config.json`: the v0.8 gate-guard blocks an interpreter write to the locked control plane (Ring 1), so
   the hook is the only path that works. (The detailed `migrateRoles(cfg)` description below documents the same
   transform the hook performs.) This runs AFTER step 1's
   `migrate-config.mjs` and reuses the same top-up-only convention; it only ADDS missing keys and never changes a
   value I set. Apply the à la carte roles transform with `hooks/migrate-roles.mjs` `migrateRoles(cfg)`: read the
   repo's `autonomy.config.json`, and if `isMigrated(cfg)` is false, transform the old `{research, planner}` boolean
   roles block into the à la carte shape `{ builder: "auto", reviewer: "required", planner: "off", researcher: "off" }`
   (legacy `true` maps to `"auto"`, legacy `false` to `"off"`, so a deliberate disable is preserved; an absent
   planner/researcher defaults to `"off"` to reproduce current behavior), and top up the `lease`, `safety`, and
   rigor `gate` blocks at their safe defaults. It is pure and idempotent: a config already in the new shape is left
   byte-identical, and it NEVER touches `LOOP-STATE.md` `turn:` (the baton). Do this transform by running the
   `hooks/migrate-roles.mjs` HOOK (step 2b above): that is the ONLY working path, because the v0.8 gate-guard blocks
   an interpreter write to the locked control plane (Ring 1), so an inline `node -e` write to `autonomy.config.json`
   is refused. The hook performs exactly the `migrateRoles(cfg)` transform documented here.
   Then top up the remaining new 0.7.0 keys at their safe, behavior-preserving defaults ONLY if missing (never
   overwrite): `coordination` (`{ mode: "multi-process" }`, the unchanged default), `safety.reducedTrustOptIn`
   (`false`), `subagent` (`{ reviewerIsolated: true }`, inert unless single-cli is later chosen), `convergence`
   (`{ maxAttemptsPerTask: 5, oscillationK: 2 }`), `scope` (`{ maxFiles: 0, maxLines: 0, maxNewPublicSymbols: 0,
   warnRatio: 0.8 }`, all 0 = OFF so no ceiling is enforced), `speed` (the terminal opt-out block; rigor gates stay
   ON by default), and `gate.verifyGate` (`"govern"`, rigor-on DEFAULT: the fifth-gate bite router governs the
   verify verdict and is fail-closed; this matches what `hooks/migrate-roles.mjs` sets and the reviewer's default).
   Report each key added, or that everything was already current. Defaults above reproduce current behavior exactly.

2c. **Print the roster banner (additive output only).** After the migration, compute the live roster from the
   migrated roles and print `hooks/ux-banner.mjs` `rosterPanel(roster, config)` then `banner(roster, config)` so I
   can see the active shape and trust tier. This is print-only and changes no files or behavior; the default shows
   full-independence.

2d. **ADDITIVE v0.8 "provision or refuse" top-up (idempotent, never resets the baton, never overwrites a value I
   set).** This reuses the same top-up-only convention as the steps above; it only ADDS the missing v0.8 keys.
   - **Config key.** Top up `gate.requireProdProtection` to `true` ONLY if it is absent (read the repo's
     `autonomy.config.json`, and if `cfg.gate` exists and `cfg.gate.requireProdProtection` is undefined, set it to
     `true` and write back only that key; never change an existing value). `true` is the fail-closed default: it
     makes the SessionStart preflight (`hooks/preflight.mjs` `decidePreflight`) REFUSE the auto-promotion path
     unless `prodBranch` carries the no-bypass ruleset. Report whether it was added or already present.
   - **Provision the rails the preflight now demands.** Tell me that v0.8 turns the old "warn and continue" prod
     check into "provision or refuse", then offer (do not force) to provision both rails so the loop is not
     refused at next start: (a) the no-bypass prod ruleset exactly as `/autonomy-init` step 2 does (substitute
     `{prodBranch}` into `${CLAUDE_PLUGIN_ROOT}/prod-ruleset.json`, strip `_comment*` keys, POST to
     `repos/{owner}/{repo}/rulesets`; `pull_request` + `non_fast_forward` + `deletion`, empty `bypass_actors`, NOT
     Restrict-updates), and (b) the control-plane lockdown by running
     `node ${CLAUDE_PLUGIN_ROOT}/hooks/harden-control-plane.mjs` from the repo root (materialize-then-lock every
     `protectedPaths` entry + the plugin `hooks/` dir; idempotent; safe to re-run). Neither aborts the upgrade on
     failure: print the result and continue.
   - **Escape hatch (attended only).** Document plainly: if I cannot provision prod protection right now (no admin,
     no `gh`, local-only repo), I can either set `gate.requireProdProtection` to `false` to stop demanding it, or
     pass `--i-accept-reduced-assurance` (or env `AUTONOMY_ACCEPT_REDUCED_ASSURANCE=1`) to the preflight to let an
     ATTENDED run START with a writable control plane. The escape hatch is attended-only and NEVER enables the
     unattended / auto-promotion path: auto-promotion still requires the locked control plane, the no-bypass prod
     ruleset, a live reviewer, and a live sandbox, all four. Report each v0.8 key added, or that everything was
     already current.

2e. **RE-LOCK the control plane (closes the step 0 unlock).** Now that the migration has written the config, run
   `node ${CLAUDE_PLUGIN_ROOT}/hooks/harden-control-plane.mjs` from the repo root (NO flag) to re-protect the
   control plane: it materializes-then-locks every `protectedPaths` entry + the plugin `hooks/` dir, read-only
   again. This is the same lockdown step 2d offers; running it here is REQUIRED to leave the install protected
   after the unlock. It is idempotent and prints a per-target result; it does not abort the upgrade on a partial
   failure. Note: if step 0 reported a target was chown'd to a non-agent OWNER, that owner must re-lock (and had
   to unlock) it manually, because `chattr` needs that owner; the agent alone cannot.

2f. **Per-worktree control-plane state (run the upgrade in EACH worktree).** Run `git worktree list`. If it shows
   more than one worktree, tell me plainly that `autonomy.config.json` is per-worktree LOCAL control-plane state
   (it is gitignored / per-checkout), so an upgrade in one worktree does NOT upgrade the others, and "is it
   upgraded?" can otherwise give different answers in different worktrees. Resolve it one of two ways: either run
   `/autonomy-upgrade` (this whole UNLOCK -> migrate -> RE-LOCK sequence) in EACH worktree, or, if you have chosen
   to track `autonomy.config.json` in git, commit it from this worktree and let the others pull. If there is only
   one worktree, say so and skip.

3. Then remind me, plainly: **`/reload` the plugin in BOTH terminals (Builder and Reviewer)** so the new
   commands and hooks take effect, and restart the `/loop` ticks if they were paused.

Do NOT start or steer the loop here, and do NOT touch the work itself. This command only unlocks, migrates,
and re-locks the config (and reports); it never resets the baton or changes a value you set.
