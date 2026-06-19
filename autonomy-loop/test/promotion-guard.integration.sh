#!/usr/bin/env bash
# Real-git integration for promotion-guard's thin PreToolUse runner (Build-brief Task 4 ACs).
# Builds a scratch git repo, writes autonomy.config.json + presence leases, pipes PreToolUse
# events into hooks/promotion-guard.mjs, and asserts exit codes. 0 = allowed, 2 = blocked.
set -u
HOOKS=/tmp/pg-verify/hooks
REPO=/tmp/pg-verify/scratch-repo
rm -rf "$REPO"; mkdir -p "$REPO/presence"; cd "$REPO"
git init -q -b agent-loop
git config user.email t@t; git config user.name t
echo "x" > a.txt; git add -A; git commit -qm init
git branch main 2>/dev/null

NOW=$(node -e 'console.log(new Date().toISOString())')
lease () { # role -> presence/<role>.lease.json with a fresh heartbeat
  cat > "presence/$1.lease.json" <<JSON
{ "role": "$1", "pid": "pid-$1", "heartbeatUtc": "$NOW", "ttlSeconds": 600, "epoch": 1 }
JSON
}
event () { printf '{"tool_name":"Bash","tool_input":{"command":%s}}' "$(node -e 'console.log(JSON.stringify(process.argv[1]))' "$1")"; }

PASS=0; FAIL=0
check () { # desc, expected_exit, actual_exit
  if [ "$2" = "$3" ]; then echo "PASS  $1  (exit $3)"; PASS=$((PASS+1));
  else echo "FAIL  $1  expected exit $2 got $3"; FAIL=$((FAIL+1)); fi
}
runner () { event "$1" | node "$HOOKS/promotion-guard.mjs" >/tmp/pg-verify/_out 2>/tmp/pg-verify/_err; echo $?; }

echo "================ CONFIG A: reviewer required, reduced opt-in OFF ================"
cat > autonomy.config.json <<JSON
{ "prodBranch": "main", "protectedPaths": [], "roles": { "reviewer": "required" }, "safety": { "reducedTrustOptIn": false }, "seed": true }
JSON

echo "--- A1: lone-builder roster, promotion merge -> BLOCK (no reviewer) ---"
rm -f presence/*.json; lease builder
check "A1 lone builder: git merge blocked"            2 "$(runner 'git merge feature')"
echo "    reason: $(cat /tmp/pg-verify/_err)"

echo "--- A2: builder+reviewer live, promotion merge -> ALLOW ---"
rm -f presence/*.json; lease builder; lease reviewer
check "A2 builder+reviewer: git merge allowed"        0 "$(runner 'git merge feature')"
check "A2 builder+reviewer: git push --tags allowed"  0 "$(runner 'git push --tags')"
echo "--- A2c: direct prod push stays owner-gated even with reviewer ---"
check "A2c builder+reviewer: push origin main blocked" 2 "$(runner 'git push origin main')"

echo "================ CONFIG B: reviewer OFF, reducedTrustOptIn TRUE ================"
cat > autonomy.config.json <<JSON
{ "prodBranch": "main", "protectedPaths": [], "roles": { "reviewer": "off" }, "safety": { "reducedTrustOptIn": true }, "seed": true }
JSON
rm -f presence/*.json; lease builder   # reviewer must NOT be live (config vetoes it)

echo "--- B1: reduced trust, git merge -> BLOCK ---"
check "B1 reduced: git merge blocked"                 2 "$(runner 'git merge feature')"
echo "    reason: $(cat /tmp/pg-verify/_err)"
echo "--- B2: reduced trust, git push origin main -> BLOCK ---"
check "B2 reduced: push origin main blocked"          2 "$(runner 'git push origin main')"
echo "--- B3: reduced trust, non-promotion (commit/test) -> ALLOW ---"
check "B3 reduced: npm test allowed"                  0 "$(runner 'npm test')"
check "B3 reduced: git commit allowed"                0 "$(runner 'git commit -m wip')"
check "B3 reduced: git push work-branch allowed"      0 "$(runner 'git push origin agent-loop')"

echo "================ INVARIANT via the RUNNER (real process, several rosters) ================"
LEAK=0
for combo in "" "builder" "researcher planner builder" "planner" "researcher" "reviewer" "builder reviewer" "researcher planner builder reviewer"; do
  rm -f presence/*.json; for r in $combo; do lease "$r"; done
  for cmd in "git merge x" "git push origin main" "gh pr merge 1" "git push --tags"; do
    ec=$(runner "$cmd")
    if [ "$ec" = "0" ]; then
      case " $combo " in *" reviewer "*) : ;; *) echo "  LEAK: '$cmd' allowed with roster=[$combo]"; LEAK=$((LEAK+1));; esac
    fi
  done
done
if [ "$LEAK" = "0" ]; then echo "INVARIANT HOLDS: no promotion allowed through the runner without a live reviewer"; PASS=$((PASS+1));
else echo "INVARIANT VIOLATED: $LEAK leak(s)"; FAIL=$((FAIL+1)); fi

echo "================ SUMMARY ================"
echo "PASS=$PASS  FAIL=$FAIL"
[ "$FAIL" = "0" ]
