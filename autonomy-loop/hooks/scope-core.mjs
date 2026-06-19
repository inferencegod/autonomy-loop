// autonomy-loop: scope-core (Scope Ceiling, doc 07). Pure decision core. Earlier feedback WITHOUT a
// shared mutable context: the PLAN GATE emits a deterministic scope ceiling (maxFiles/maxLines/
// maxNewPublicSymbols); this forces a mandatory handoff (commit + yield) when the builder hits it,
// before it goes too deep down one path. Preserves single-writer + reviewer independence. Fail-closed:
// a ceiling set but its measurement missing -> handoff (you cannot prove you are under it). No deps.
const KEYS = [["maxFiles", "files"], ["maxLines", "lines"], ["maxNewPublicSymbols", "newPublicSymbols"]];

// decideScope(input) -> { action, reason, breaches:[{metric,current,ceiling}] }
//   action: "continue" | "warn" (advisory, >= warnRatio of a ceiling) | "handoff" (mandatory yield)
//   input.ceiling: { maxFiles?, maxLines?, maxNewPublicSymbols? }  (absent key = no limit on that metric)
//   input.current: { files, lines, newPublicSymbols }     input.warnRatio: advisory band (default 0.8)
export function decideScope(input = {}) {
  const ceiling = input.ceiling || {}, current = input.current || {};
  const warnRatio = typeof input.warnRatio === "number" ? input.warnRatio : 0.8;
  const breaches = [], warns = [];
  for (const [ck, mkey] of KEYS) {
    const lim = ceiling[ck];
    if (lim == null) continue; // no ceiling on this metric
    const cur = current[mkey];
    if (!Number.isFinite(cur)) { breaches.push({ metric: mkey, current: null, ceiling: lim }); continue; } // fail-closed
    if (cur > lim) breaches.push({ metric: mkey, current: cur, ceiling: lim });
    else if (cur >= Math.floor(lim * warnRatio)) warns.push({ metric: mkey, current: cur, ceiling: lim });
  }
  if (breaches.length)
    return { action: "handoff", reason: `scope ceiling reached (${breaches.map((x) => `${x.metric} ${x.current ?? "unmeasured"}/${x.ceiling}`).join(", ")}); commit and yield`, breaches };
  if (warns.length)
    return { action: "warn", reason: `approaching scope ceiling (${warns.map((x) => `${x.metric} ${x.current}/${x.ceiling}`).join(", ")})`, breaches: warns };
  return { action: "continue", reason: "within scope ceiling", breaches: [] };
}
