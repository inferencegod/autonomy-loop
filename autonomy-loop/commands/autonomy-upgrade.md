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
3. Then remind me, plainly: **`/reload` the plugin in BOTH terminals (Builder and Reviewer)** so the new
   commands and hooks take effect, and restart the `/loop` ticks if they were paused.

Do NOT start or steer the loop here, and do NOT touch the work itself. This command only migrates the config.
