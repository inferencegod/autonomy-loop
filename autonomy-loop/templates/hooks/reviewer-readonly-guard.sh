#!/usr/bin/env bash
# autonomy-loop: reviewer-readonly-guard (single-CLI spec). PreToolUse Bash hook for the REVIEWER
# subagent. Defense in depth: permissionMode cannot loosen a stricter parent and worktree isolation is
# filesystem-only, so a git checkout/switch/reset/branch -D/push from inside the reviewer worktree can
# still mutate the parent HEAD (#55708). This hook is the hard stop. It also blocks shell write verbs so
# a read-only reviewer cannot mutate the tree even though Write/Edit are already disallowed at the tool
# layer. Exit 2 = BLOCK the tool call (Claude Code convention). Exit 0 = allow. No deps, no em dashes.
#
# Input: the PreToolUse JSON event on stdin. We pull the command string out of tool_input.command. If
# `jq` is present we use it; otherwise a portable grep/sed fallback extracts the field. Fail-closed: if
# we cannot read the command at all, we still scan whatever stdin we got.

set -u

raw="$(cat 2>/dev/null || true)"

cmd=""
if command -v jq >/dev/null 2>&1; then
  cmd="$(printf '%s' "$raw" | jq -r '.tool_input.command // .tool_input.cmd // empty' 2>/dev/null || true)"
fi
if [ -z "${cmd}" ]; then
  # Portable fallback: grab the "command":"..." value (best-effort) and also keep the whole payload so a
  # banned verb anywhere in the event still trips the guard. Unescape \" so quoted args are visible.
  cmd="$(printf '%s' "$raw" | sed -n 's/.*"command"[[:space:]]*:[[:space:]]*"\(.*\)/\1/p' | sed 's/\\"/"/g')"
  cmd="${cmd}
${raw}"
fi

# Normalize for matching: lower-case is NOT applied (git subcommands and verbs are lower-case already,
# and we want to catch redirections literally). We match on word boundaries where it matters.

block() {
  # Message goes to stderr so Claude Code surfaces the reason on a blocking (exit 2) hook.
  printf 'reviewer-readonly-guard: BLOCKED (%s). The reviewer is read-only and must never mutate git state or the tree.\n' "$1" >&2
  exit 2
}

# 1. Destructive / state-moving git operations (the parent-HEAD escape, #55708, plus push).
#    Match "git ... <verb>" allowing flags between git and the subcommand.
case "$cmd" in
  *git*checkout*)        block "git checkout" ;;
  *git*switch*)          block "git switch" ;;
  *git*reset*)           block "git reset" ;;
  *push*)                : ;;  # handled below with a git-scoped check too
esac

# branch -D (force delete) and git push, scoped to git to avoid false hits on unrelated words.
if printf '%s' "$cmd" | grep -Eq 'git[^;|&]*branch[[:space:]]+-D'; then block "git branch -D"; fi
if printf '%s' "$cmd" | grep -Eq 'git[^;|&]*push'; then block "git push"; fi

# 2. Shell WRITE verbs. A read-only reviewer may inspect and run the gate, never mutate files.
#    rm, mv, cp, tee, truncate as commands; output redirection (> and >>); and in-place sed (sed -i).
if printf '%s' "$cmd" | grep -Eq '(^|[;|&[:space:]])(rm|mv|cp|tee|truncate)([[:space:]]|$)'; then
  block "shell write verb (rm/mv/cp/tee/truncate)"
fi
if printf '%s' "$cmd" | grep -Eq '(>>?)'; then
  block "output redirection (> or >>)"
fi
if printf '%s' "$cmd" | grep -Eq 'sed[[:space:]]+[^;|&]*-i'; then
  block "sed -i (in-place edit)"
fi

# Nothing matched: allow the command.
exit 0
