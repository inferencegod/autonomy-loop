// Pure decision core for the autonomy-loop gate-guard. No I/O, no side effects -> unit-testable.
// A regex denylist over shell strings can NEVER be complete (indirection, aliases, renamed binaries,
// a variable holding the branch name, `git push origin HEAD`, novel tools, symlinks all evade it).
// This is a best-effort TRIPWIRE that raises the bar on the lazy/common case; the real barriers are
// server-side branch protection, OS read-only frozen files, and a sandboxed checkout. See SECURITY.md.
const RX = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const ALLOW = { action: "allow" };
const deny = (reason) => ({ action: "deny", reason });

export function decide(tool, input = {}, cfg = {}) {
  const prodBranch = cfg.prodBranch || "main";
  const protectedPaths = Array.isArray(cfg.protectedPaths) ? cfg.protectedPaths : [];
  const pb = RX(prodBranch);

  if (tool === "Bash") {
    const cmd = String(input.command || "");
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
