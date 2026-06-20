# Contributing

Small, opinionated tool - PRs that keep it small and honest are welcome.

## Ground rules (the discipline the loop itself enforces)
- **No fabricated claims.** Any number in docs carries its method + sample size, or it's marked illustrative.
- **The safety hook is a tripwire, not a sandbox.** Harden it? Add a `test/gate-guard.test.mjs` case (RED-before/GREEN-after).
- **Keep `plugin.json` minimal** - do NOT add `commands`/`skills`/`hooks` path fields (they auto-discover; declaring them causes a duplicate-load error).

## Dev
- Hook tests: `node --test test/gate-guard.test.mjs`
- Validate: `claude plugin validate`
- Single-purpose commits; SemVer releases.
