// Pure decision core for the autonomy-loop gate-guard. No I/O, no side effects -> unit-testable.
// A regex denylist over shell strings can NEVER be complete (indirection, aliases, renamed binaries,
// a variable holding the branch name, `git push origin HEAD`, novel tools, symlinks all evade it).
// This is a best-effort TRIPWIRE that raises the bar on the lazy/common case; the real barriers are
// server-side branch protection, OS read-only frozen files, and a sandboxed checkout. See SECURITY.md.
const RX = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const ALLOW = { action: "allow" };
const deny = (reason) => ({ action: "deny", reason });

// ---- "parse, don't blind-substring-match" (P1-3 false-positive fix, rec 5) -------------------------
// A bare denylist over the WHOLE command text mis-fires when a dangerous-looking phrase (`reset --hard`,
// a prod-push literal, a protected-path token) appears ONLY inside DESCRIPTIVE text that is being WRITTEN,
// not executed: a log note `printf 'note: avoided reset --hard' >> tasks/ledger.jsonl`, a commit message
// `git commit -m "fix: never git push origin main"`, or an `echo '...reset --hard...' >> NOTES.md`.
// We compute an EXECUTED RESIDUE: the command with those descriptive regions BLANKED, then run the
// denylist over the residue. The genuinely-executed dangerous command always lives OUTSIDE those regions
// (it is unquoted, or after a shell separator), so it survives into the residue and is still blocked.
//
// FAIL-CLOSED is the rule: we blank a region ONLY when we can PROVE it is descriptive with a SAFE sink.
//   - A region's sink (the redirect target / heredoc file) must be a NON-protected file. If the sink IS a
//     protected path, the write itself is dangerous, so we DO NOT blank it (residue keeps `>> <protected>`
//     and the protected-path rule fires).
//   - We never cross a shell separator (&&, ||, ;, |, newline): a dangerous command chained AFTER a safe
//     write (`git commit -m "x" && git push origin main`) stays in the residue and still blocks.
//   - On ANY ambiguity we blank NOTHING (leave the raw text -> may tripwire == fail-closed, never opens a
//     real bypass). An attacker cannot smuggle a real `git push origin main` by quoting it unless the quote
//     is genuinely an echo/printf/heredoc arg whose sink is a non-protected file -- i.e. it is NOT executed.

// Is `target` (a redirect destination or heredoc filename, quotes already stripped) a protected path?
// Reuses the same substring semantics decide() uses elsewhere (protectedPaths entries are path fragments).
function sinkIsProtected(target, protectedPaths) {
  if (!target) return false;
  const t = target.replace(/['"]/g, "");
  return protectedPaths.some((p) => p && t.includes(p));
}

// Return the executed residue of `cmd`: descriptive regions with PROVABLY-SAFE sinks blanked to spaces
// (length-preserving so offsets/structure stay intuitive). Conservative: blanks only what it can prove.
export function executedResidue(cmd, protectedPaths = []) {
  let s = String(cmd);

  // (c) Heredoc bodies: `cmd [> file] <<'TAG' \n ...body... \n TAG`. The body is data written to wherever the
  // command's stdout goes. We blank the BODY only when the heredoc command's redirect sink is a NON-protected
  // file (or there is no redirect at all -> stdout, not a file write). The head line (the command + redirect)
  // and the closing delimiter are kept, so any executed danger on the command line is still seen. The opening
  // `<<TAG` line is matched up to its newline; we capture the head (incl. its redirect) to inspect the sink.
  s = s.replace(/([^\n]*<<-?\s*['"]?([A-Za-z_][A-Za-z0-9_]*)['"]?[^\n]*\n)([\s\S]*?)(\n[ \t]*\2(?=\s|$))/g,
    (m, head, _tag, body, tail) => {
      const redir = /[0-9]*>>?\s*([^\s|;&<]+)/.exec(head); // a `> file` / `>> file` on the head line (if any)
      const sink = redir ? redir[1] : "";
      if (sink && sinkIsProtected(sink, protectedPaths)) return m; // writing INTO a protected file -> keep (dangerous)
      return head + body.replace(/[^\n]/g, " ") + tail;            // blank body chars, keep newlines + structure
    });

  // (b) Commit messages: `-m "..."` / `-m '...'` / `-m=...` and `-F <file>` / `--file=<file>`. The message
  // text is data recorded in the commit, never executed. Blank the quoted value (keep the flag). `-F`/`--file`
  // names a file we do not read here; the danger would be in that file's content, out of scope for this line.
  // We blank the message value in-place so an executed command AFTER the message (post-quote) is untouched.
  s = blankCommitMessages(s);

  // (a) echo / printf whose quoted argument is redirected to a NON-protected file (a ledger/log/doc). The
  // quoted arg is data appended to that file. We blank the quoted arg ONLY when, within the SAME shell
  // segment (no separator crossed), there is a redirect to a non-protected sink. The redirect operator and
  // target stay, so a redirect to a protected sink (handled by NOT entering this branch) still trips.
  s = blankEchoArgsToSafeSink(s, protectedPaths);

  return s;
}

// Blank the VALUE of git commit message flags, preserving the flag token and overall length.
function blankCommitMessages(s) {
  // -m / --message with a quoted value (handles escaped quotes inside via non-greedy + backref delimiter).
  let out = s.replace(/(\s-m\b\s*|\s--message(?:=|\s+))(['"])((?:\\.|(?!\2)[\s\S])*)\2/g,
    (_m, flag, q, val) => flag + q + val.replace(/[^\n]/g, " ") + q);
  // -m=VALUE / --message=VALUE unquoted up to a shell separator or whitespace boundary (bare one-word msg).
  out = out.replace(/(\s-m=|\s--message=)([^\s|;&]+)/g, (_m, flag, val) => flag + val.replace(/[^\n]/g, " "));
  return out;
}

// Blank quoted echo/printf arguments that are redirected to a NON-protected sink within the same segment.
// Split on shell separators (capturing them so they are preserved) and process each segment independently,
// so a redirect's effect never spills across `&&`/`||`/`;`/`|`/newline. Robust vs. an exec-loop (no zero-
// width stalls); the separators are restored verbatim by the alternating split layout.
function blankEchoArgsToSafeSink(s, protectedPaths) {
  const parts = s.split(/(&&|\|\||;|\||\n)/); // even idx = segment, odd idx = separator
  for (let i = 0; i < parts.length; i += 2) parts[i] = maybeBlankEchoSegment(parts[i], protectedPaths);
  return parts.join("");
}

function maybeBlankEchoSegment(seg, protectedPaths) {
  if (!/\b(?:echo|printf)\b/.test(seg)) return seg;
  // Find a redirect in THIS segment and capture its target. No redirect -> stdout (not a file) -> we do NOT
  // blank (descriptive text going to stdout is harmless to keep, and keeping it is the fail-closed choice).
  const redir = /[0-9]*>>?\s*([^\s|;&]+)/.exec(seg);
  if (!redir) return seg;
  const sink = redir[1];
  if (sinkIsProtected(sink, protectedPaths)) return seg; // redirect to a protected file -> keep (dangerous)
  // Safe sink: blank the contents of each quoted region in this segment (the data being written).
  return seg.replace(/(['"])((?:\\.|(?!\1)[\s\S])*)\1/g, (_m, q, val) => q + val.replace(/[^\n]/g, " ") + q);
}

export function decide(tool, input = {}, cfg = {}) {
  const prodBranch = cfg.prodBranch || "main";
  const protectedPaths = Array.isArray(cfg.protectedPaths) ? cfg.protectedPaths : [];
  const pb = RX(prodBranch);

  if (tool === "Bash") {
    const rawCmd = String(input.command || "");
    // Run the denylist over the EXECUTED RESIDUE (descriptive quoted text with safe sinks blanked), not the
    // raw text, so a git verb / prod-push literal / protected-path token that appears ONLY inside a log note,
    // commit message, or heredoc-to-safe-file is not mistaken for an executed command. Genuinely-executed
    // danger survives into the residue (it is outside the blanked regions) and is still blocked. See above.
    const cmd = executedResidue(rawCmd, protectedPaths);
    const isGit = /\bgit\b/.test(cmd);
    const isPush = isGit && /\bpush\b/.test(cmd);

    // Push to the prod branch, REMOTE-AGNOSTIC + refspec/HEAD-ref forms. NOTE the documented limits: a
    // branch name held in a shell variable (`B=main; git push origin $B`) or a tracking `git push origin
    // HEAD` carry no literal branch token and CANNOT be caught here. Server-side branch protection is the
    // barrier for those; this regex only stops the literal-branch case.
    const q = `["']?`;
    const prodTarget = new RegExp(
      `(^|\\s)${q}${pb}${q}(\\s|$)`
      + `|:${q}${pb}${q}(\\s|$)`
      + `|:refs/heads/${pb}(\\s|$)`
      + `|(^|\\s)refs/heads/${pb}(\\s|$)`
    );
    if (isPush && prodTarget.test(cmd))
      return deny(`push/fast-forward to '${prodBranch}' (production)`);

    if (/\bgh\b/.test(cmd) && /\b(pr\s+merge|release\s+(create|edit|delete)|workflow\s+run|repo\s+delete)\b/.test(cmd))
      return deny("shipping/destructive gh CLI is owner-gated");

    if (isPush && /(--force\b|--force-with-lease\b|(^|\s)-[A-Za-z]*f[A-Za-z]*(\s|$)|\s\+[\w./-]+:|--delete\b|(^|\s)-[A-Za-z]*d[A-Za-z]*(\s|$))/.test(cmd))
      return deny("force-push or remote-branch deletion is destructive");

    if (isGit && /(filter-repo|filter-branch|\breset\s+--hard\b|--mirror|\brebase\b[^\n]*--root|\bupdate-ref\s+-d\b|\bbranch\s+-D\b|\breflog\s+expire\b|\bcheckout\s+--orphan\b)/.test(cmd))
      return deny("git history rewrite / ref destruction is destructive");

    // Shell writes/deletes to a protected path (best-effort verb/redirect/in-place list, quote-stripped).
    const cmdNoQ = cmd.replace(/['"]/g, "");
    for (const p of protectedPaths) {
      if (!p) continue;
      const pe = RX(p);
      const verb = new RegExp(`\\b(?:rm|rmdir|unlink|mv|cp|dd|tee|truncate|install|ln|patch|shred|chmod|chown)\\b[^\\n]*${pe}`);
      const inplace = new RegExp(`\\b(?:sed|perl)\\b[^\\n]*-i[^\\n]*${pe}`);
      const redir = new RegExp(`[0-9]*>>?\\s*[^\\n|;&]*${pe}`);
      if (verb.test(cmd) || verb.test(cmdNoQ) || inplace.test(cmd) || inplace.test(cmdNoQ) || redir.test(cmd) || redir.test(cmdNoQ))
        return deny(`shell write/delete targeting a protected path (${p})`);
    }

    // CONTROL-PLANE basenames: the gate's own files plus any FILE entry in protectedPaths, matched by
    // BASENAME so `cd hooks && cat > decide.mjs` (a different cwd, no path prefix) or an interpreter write
    // (`python -c "open('hooks/decide.mjs','w')"`, `node -e "writeFileSync(...)"`) cannot disable the guard.
    // Still best-effort (a renamed binary or an exec of a written script evades it); read-only files are the fix.
    const fileBn = protectedPaths.filter((p) => p && !p.endsWith("/")).map((p) => p.split("/").pop());
    const critical = [...new Set(["decide.mjs", "gate-guard.mjs", ...fileBn])].filter(Boolean);
    const interp = /\b(?:python3?|node|deno|bun|ruby|perl|php)\b[^\n]*(?:\s-(?:c|e)\b|open\s*\(|writeFile|>>?)/.test(cmd);
    for (const b of critical) {
      const be = RX(b);
      const writeNear = new RegExp(`(?:\\b(?:rm|rmdir|unlink|mv|cp|dd|tee|truncate|install|ln|patch|shred|chmod|chown)\\b[^\\n]*|>>?\\s*[^\\n|;&]*|\\b(?:sed|perl)\\b[^\\n]*-i[^\\n]*)${be}`);
      if (writeNear.test(cmd) || writeNear.test(cmdNoQ)) return deny(`shell write to a control-plane file (${b})`);
      if (interp && (cmd.includes(b) || cmdNoQ.includes(b))) return deny(`interpreter write touching a control-plane file (${b})`);
    }
    return ALLOW;
  }
  if (["Edit", "Write", "MultiEdit", "NotebookEdit"].includes(tool)) {
    const fp = String(input.file_path || input.notebook_path || "").replace(/\\/g, "/").replace(/\/+/g, "/");
    for (const p of protectedPaths) if (p && fp.includes(p)) return deny(`editing a protected path (${fp})`);
  }
  return ALLOW;
}
