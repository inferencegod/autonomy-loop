// Pure decision core for the autonomy-loop gate-guard. No I/O, no side effects → unit-testable.
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
    if (isPush && new RegExp(`(\\borigin\\s+${pb}\\b|:${pb}\\b|\\b${pb}\\s*:|\\bpush\\s+${pb}\\b|HEAD:(?:refs/heads/)?${pb}\\b|refs/heads/${pb}\\b)`).test(cmd))
      return deny(`push/fast-forward to '${prodBranch}' (production)`);
    if (/\bgh\b/.test(cmd) && /\b(pr\s+merge|release\s+create|workflow\s+run)\b/.test(cmd))
      return deny("shipping via the gh CLI is owner-gated");
    if (isPush && /(--force\b|--force-with-lease\b|(^|\s)-f(\s|$)|\s\+[\w./-]+:)/.test(cmd))
      return deny("force-push is destructive");
    if (isGit && /(filter-repo|filter-branch|\breset\s+--hard\b|--mirror|\brebase\b[^\n]*--root)/.test(cmd))
      return deny("git history rewrite / hard reset is destructive");
    for (const p of protectedPaths) {
      if (!p) continue;
      const pe = RX(p);
      if (new RegExp(`\\b(?:rm|mv|cp|tee|truncate)\\b[^\\n]*${pe}`).test(cmd)
        || new RegExp(`\\bsed\\b[^\\n]*-i[^\\n]*${pe}`).test(cmd)
        || new RegExp(`>>?\\s*[^\\n|;&]*${pe}`).test(cmd))
        return deny(`shell write/delete targeting a protected path (${p})`);
    }
    return ALLOW;
  }
  if (["Edit", "Write", "MultiEdit", "NotebookEdit"].includes(tool)) {
    const fp = String(input.file_path || input.notebook_path || "").replace(/\\/g, "/");
    for (const p of protectedPaths) if (p && fp.includes(p)) return deny(`editing a protected path (${fp})`);
  }
  return ALLOW;
}
