---
description: Upgrade an existing autonomy-loop install to the current schema (safe, idempotent, run after a plugin update)
---
Bring THIS repo's loop up to date after you have updated the plugin. This is the one thing to run when you
move to a new version. It is safe to run any time: it only ADDS missing knobs with sane defaults, never
changes a value you set, and never resets the baton.

1. Run `node ${CLAUDE_PLUGIN_ROOT}/hooks/migrate-config.mjs` from the repo root. It tops up
   `autonomy.config.json` (the `breaker` block, `gate.selfMutate`, and the self-protecting `protectedPaths`
   entries) and `LOOP-STATE.md` (`epoch`, `no-progress-epochs`, `last-tree-sha`), writing back only what was
   missing. If `autonomy.config.json` is not valid JSON it refuses to touch it and tells you to fix it first.
2. Report exactly what it added, or that everything was already current.

2b. **ADDITIVE v0.7.0 migration (idempotent, never resets the baton).** This runs AFTER step 1's
   `migrate-config.mjs` and reuses the same top-up-only convention; it only ADDS missing keys and never changes a
   value I set. Apply the à la carte roles transform with `hooks/migrate-roles.mjs` `migrateRoles(cfg)`: read the
   repo's `autonomy.config.json`, and if `isMigrated(cfg)` is false, transform the old `{research, planner}` boolean
   roles block into the à la carte shape `{ builder: "auto", reviewer: "required", planner: "off", researcher: "off" }`
   (legacy `true` maps to `"auto"`, legacy `false` to `"off"`, so a deliberate disable is preserved; an absent
   planner/researcher defaults to `"off"` to reproduce current behavior), and top up the `lease`, `safety`, and
   rigor `gate` blocks at their safe defaults. It is pure and idempotent: a config already in the new shape is left
   byte-identical, and it NEVER touches `LOOP-STATE.md` `turn:` (the baton). It is a pure core with no CLI runner,
   so invoke it from the repo root with node, reading and writing back only the changed keys, for example:
   `node --input-type=module -e "import {readFileSync,writeFileSync} from 'node:fs'; const {migrateRoles,isMigrated}=await import('${CLAUDE_PLUGIN_ROOT}/hooks/migrate-roles.mjs'); const p='autonomy.config.json'; const cfg=JSON.parse(readFileSync(p,'utf8')); if(!isMigrated(cfg)){const {cfg:out,added}=migrateRoles(cfg); writeFileSync(p, JSON.stringify(out,null,2)+'\n'); console.log('migrate-roles added:', added.join(', '));} else {console.log('roles already à la carte; nothing changed');}"`
   Then top up the remaining new 0.7.0 keys at their safe, behavior-preserving defaults ONLY if missing (never
   overwrite): `coordination` (`{ mode: "multi-process" }`, the unchanged default), `safety.reducedTrustOptIn`
   (`false`), `subagent` (`{ reviewerIsolated: true }`, inert unless single-cli is later chosen), `convergence`
   (`{ maxAttemptsPerTask: 5, oscillationK: 2 }`), `scope` (`{ maxFiles: 0, maxLines: 0, maxNewPublicSymbols: 0,
   warnRatio: 0.8 }`, all 0 = OFF so no ceiling is enforced), `speed` (the terminal opt-out block; rigor gates stay
   ON by default), and `gate.verifyGate` (`"off"`, the staged fifth-gate router that does not govern). Report each
   key added, or that everything was already current. Defaults above reproduce current behavior exactly.

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

3. Then remind me, plainly: **`/reload` the plugin in BOTH terminals (Builder and Reviewer)** so the new
   commands and hooks take effect, and restart the `/loop` ticks if they were paused.

Do NOT start or steer the loop here, and do NOT touch the work itself. This command only migrates the config.
