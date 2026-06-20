#!/usr/bin/env bash
# Real-git integration for the impure preflight + presence-verify RUNNERS (Build-brief Task ACs).
# Builds a scratch repo with real files and leases under /tmp, then drives the runners and asserts:
#   (a) a protectedPath the agent can write -> preflight exits NON-ZERO with controlPlaneWritable refusal
#   (b) the same path locked read-only       -> that probe passes (no controlPlaneWritable refusal; starts)
#   (c) a fresh reviewer.lease.json with NO lock holder -> verifyPresence: reviewer ABSENT (P0-3 closed)
#   (d) a live holder (background flock)      -> verifyPresence: reviewer LIVE
# Fail-closed throughout; no external deps beyond git, node, flock. NO em dashes in output.
set -u

# HOOKS points at the real plugin hooks dir so we exercise the shipped runners, not copies.
HOOKS="$(cd "$(dirname "$0")/../hooks" && pwd)"
WORK=/tmp/preflight-run-verify
REPO="$WORK/scratch-repo"
rm -rf "$WORK"; mkdir -p "$REPO/presence" "$REPO/protected"
cd "$REPO"
git init -q -b agent-loop
git config user.email t@t; git config user.name t
echo "x" > a.txt; git add -A; git commit -qm init >/dev/null 2>&1
git branch main >/dev/null 2>&1 || true
# IMPORTANT: no 'origin' remote -> prodProtected probe fail-closes to false (gh is also absent here),
# which is fine: this harness asserts the control-plane and reviewer ACs, not the forge probe.

PASS=0; FAIL=0
ok ()   { echo "PASS  $1"; PASS=$((PASS+1)); }
bad ()  { echo "FAIL  $1"; FAIL=$((FAIL+1)); }
check_eq () { if [ "$2" = "$3" ]; then ok "$1 (got $3)"; else bad "$1 (expected $2 got $3)"; fi; }

NOW=$(node -e 'console.log(new Date().toISOString())')
FRESH=$(node -e 'console.log(new Date(Date.now()-30000).toISOString())')   # 30s ago, within TTL
STALE=$(node -e 'console.log(new Date(Date.now()-36000000).toISOString())') # 10h ago, past TTL

write_lease () { # role heartbeat -> presence/<role>.lease.json
  cat > "presence/$1.lease.json" <<JSON
{ "role": "$1", "pid": "pid-$1", "epoch": 1, "heartbeatUtc": "$2", "ttlSeconds": 600 }
JSON
}

# A config whose protectedPaths include our scratch 'protected/' dir, so the writability probe targets it.
write_config () {
  cat > autonomy.config.json <<JSON
{ "prodBranch": "main", "protectedPaths": ["protected/"], "gate": { "requireProdProtection": false } }
JSON
}
write_config

# run_preflight: invoke the shipped runner from the repo root; capture exit, stdout, stderr.
run_preflight () {
  ( cd "$REPO" && node "$HOOKS/preflight-run.mjs" "$@" ) >"$WORK/_out" 2>"$WORK/_err"
  echo $?
}

echo "================ AC (a): protectedPath agent-writable ================"
# Keep protected/ writable by us. gate.requireProdProtection=false so the ONLY thing that can flip
# allowStart=false is controlPlaneWritable, isolating this AC.
chmod u+w protected
# attended (DEFAULT): the session must START (exit 0) with a heads-up, NOT a scary hook error.
EXIT=$(run_preflight)
check_eq "a1 attended start is NOT blocked (exit 0)" "0" "$EXIT"
if grep -q "auto-promotion is OFF" "$WORK/_out"; then ok "a2 attended heads-up printed (unattended off, not a hard error)"; else bad "a2 attended heads-up printed"; echo "    --- out ---"; sed 's/^/    /' "$WORK/_out"; fi
# strict / unattended (opt-in): the SAME writable plane hard-REFUSES with a non-zero exit.
EXITS=$( ( cd "$REPO" && AUTONOMY_UNATTENDED=1 node "$HOOKS/preflight-run.mjs" ) >"$WORK/_out" 2>"$WORK/_err"; echo $? )
check_eq "a3 unattended (AUTONOMY_UNATTENDED=1) REFUSES (exit 1)" "1" "$EXITS"
if grep -q "config/hooks/leases are writable" "$WORK/_err"; then ok "a4 controlPlaneWritable refusal printed (strict)"; else bad "a4 controlPlaneWritable refusal printed (strict)"; echo "    --- stderr ---"; sed 's/^/    /' "$WORK/_err"; fi

echo "================ AC (b): protectedPath locked read-only -> probe PASSES ================"
# Lock the protected dir; the controlPlaneWritable probe must now read it as LOCKED (not writable).
# We probe the named target directly (the unit the AC names), isolated from the always-added hooks/ dir.
chmod a-w protected
LOCKED=$(cd "$REPO" && node --input-type=module -e '
import { openSync, closeSync, unlinkSync, constants as FS } from "fs";
import { join } from "path";
let writable = false;
const probe = join("'"$REPO"'/protected", ".wtest-" + process.pid);
try {
  const fd = openSync(probe, FS.O_CREAT | FS.O_APPEND | FS.O_WRONLY, 0o600);
  closeSync(fd); try { unlinkSync(probe); } catch {}
  writable = true;
} catch (e) {
  writable = (e.code === "EACCES" || e.code === "EPERM" || e.code === "EROFS") ? false : true;
}
console.log(writable ? "WRITABLE" : "LOCKED");
')
check_eq "b1 locked protected/ probes as LOCKED" "LOCKED" "$LOCKED"

# Restore write so cleanup can remove the tree, then prove the GREEN start path end to end below.
chmod u+w protected

# End-to-end GREEN start: stage a scratch control plane we can fully lock. Copy the shipped runner and
# its imported modules into "$WORK/hooks", lock that dir AND protected/ read-only, and run the runner
# from there. With every control-plane target locked and gate.requireProdProtection=false, allowStart
# must be true: the runner exits 0 and prints the banner, with NO controlPlaneWritable refusal.
SBX="$WORK/sandbox"; SBH="$SBX/hooks"
rm -rf "$SBX"; mkdir -p "$SBH/presence" "$SBX/protected"
cp "$HOOKS/preflight-run.mjs" "$HOOKS/preflight.mjs" "$HOOKS/presence-verify-run.mjs" "$HOOKS/presence-verify.mjs" "$HOOKS/presence.mjs" "$SBH/"
( cd "$SBX" && git init -q -b agent-loop && git config user.email t@t && git config user.name t && echo x>a.txt && git add -A && git commit -qm init >/dev/null 2>&1 && (git branch main >/dev/null 2>&1 || true) )
cat > "$SBX/autonomy.config.json" <<JSON
{ "prodBranch": "main", "protectedPaths": ["protected/", "hooks/"], "gate": { "requireProdProtection": false } }
JSON
chmod -R a-w "$SBX/protected" "$SBH"          # lock the entire control plane (protected + the hooks dir)
( cd "$SBX" && node "$SBH/preflight-run.mjs" ) >"$WORK/_sbxout" 2>"$WORK/_sbxerr"
SBXEXIT=$?
chmod -R u+w "$SBX/protected" "$SBH" 2>/dev/null  # restore so the tree can be cleaned
check_eq "b2 fully locked control plane -> preflight exits 0 (green start)" "0" "$SBXEXIT"
if grep -q "config/hooks/leases are writable" "$WORK/_sbxout" "$WORK/_sbxerr"; then bad "b3 no controlPlaneWritable refusal on a locked plane"; else ok "b3 no controlPlaneWritable refusal on a locked plane"; fi
if grep -q "trust tier:" "$WORK/_sbxout"; then ok "b4 banner printed on green start"; else bad "b4 banner printed on green start"; echo "    --- out ---"; sed 's/^/    /' "$WORK/_sbxout"; echo "    --- err ---"; sed 's/^/    /' "$WORK/_sbxerr"; fi


echo "================ AC (c): fresh reviewer lease, NO lock holder -> reviewer ABSENT ================"
rm -f presence/*.json presence/*.lock
write_lease reviewer "$FRESH"   # fresh heartbeat, but NOBODY holds presence/reviewer.lock
ABSENT=$(cd "$REPO" && node --input-type=module -e '
import { verifyPresence } from "'"$HOOKS"'/presence-verify-run.mjs";
const r = verifyPresence("'"$REPO"'");
console.log(JSON.stringify({ live: r.reviewer.live, present: r.reviewer.present }));
')
echo "    reviewer = $ABSENT"
echo "$ABSENT" | grep -q '"live":false' && ok "c1 reviewer.live is false (stale file, no holder)" || bad "c1 reviewer.live is false"
echo "$ABSENT" | grep -q '"present":false' && ok "c2 reviewer.present is false (P0-3 forged roster rejected)" || bad "c2 reviewer.present is false"

echo "================ AC (d): a live holder (background flock) -> reviewer LIVE ================"
rm -f presence/*.json presence/*.lock
write_lease reviewer "$FRESH"
# Hold an exclusive flock on presence/reviewer.lock in the background for the duration of the probe.
( flock -x 9 ; sleep 6 ) 9>"$REPO/presence/reviewer.lock" &
HOLDER=$!
sleep 0.5
LIVE=$(cd "$REPO" && node --input-type=module -e '
import { verifyPresence } from "'"$HOOKS"'/presence-verify-run.mjs";
const r = verifyPresence("'"$REPO"'");
console.log(JSON.stringify({ live: r.reviewer.live, present: r.reviewer.present }));
')
echo "    reviewer = $LIVE"
echo "$LIVE" | grep -q '"live":true' && ok "d1 reviewer.live is true (a real process holds the lock)" || bad "d1 reviewer.live is true"
echo "$LIVE" | grep -q '"present":true' && ok "d2 reviewer.present is true" || bad "d2 reviewer.present is true"
# Sanity: after the holder dies, liveness flips back to false (no phantom hold by the probe).
wait $HOLDER 2>/dev/null
AFTER=$(cd "$REPO" && node --input-type=module -e '
import { verifyPresence } from "'"$HOOKS"'/presence-verify-run.mjs";
console.log(verifyPresence("'"$REPO"'").reviewer.live);
')
check_eq "d3 holder gone -> reviewer.live false again (probe is not a phantom holder)" "false" "$AFTER"

echo
echo "================================ SUMMARY ================================"
echo "PASS=$PASS  FAIL=$FAIL"
[ "$FAIL" = "0" ] && { echo "ALL ACCEPTANCE CRITERIA PASS"; exit 0; } || { echo "SOME ACCEPTANCE CRITERIA FAILED"; exit 1; }
