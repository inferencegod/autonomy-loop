// autonomy-loop: convergence-core (Convergence Terminator, doc 07). Pure decision core. The no-progress
// breaker catches FROZEN loops (HEAD tree-SHA unchanged); it MISSES productive-looking non-convergence
// (builder fixes A breaks B, reviewer flags B, builder fixes B breaks A) because the tree-SHA changes
// every wave. This detects oscillation keyed on the gate-failure SIGNATURE (not the diff), enforces a
// per-task attempt budget, and recommends a rung on the escalation ladder = the deterministic "third
// vote". Fail-closed: an unparseable gate signature counts as a failed wave, never a free pass. No deps.
// Rungs: 0 continue, 1 planner re-scope, 2 stronger-model reviewer, 3 park-to-human.
const RUNG = { 0: "continue", 1: "rescope", 2: "escalate-model", 3: "park" };
const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));

// decideConvergence(input) -> { rung, action, reason, attempts, oscillation }
//   input.waves: ordered waves for ONE task: [{ passed:boolean, signature:string|null, treeSha?:string }]
//     passed=true ends the struggle (rung 0). signature=null|"" => UNPARSEABLE (a failed wave, fail-closed).
//   input.maxAttemptsPerTask: consecutive non-passing waves tolerated before the ladder engages (default 5).
//   input.oscillationK: recurrences of a signature (or a 2-cycle) that declare oscillation (default 2).
export function decideConvergence(input = {}) {
  const waves = Array.isArray(input.waves) ? input.waves : [];
  const maxAttempts = Number.isInteger(input.maxAttemptsPerTask) ? input.maxAttemptsPerTask : 5;
  const K = Number.isInteger(input.oscillationK) ? input.oscillationK : 2;
  if (waves.length === 0) return mk(0, "no-waves", 0, false);
  if (waves[waves.length - 1] && waves[waves.length - 1].passed === true) return mk(0, "last-wave-passed", 0, false);
  // trailing run of consecutive non-passing waves = the current struggle on this task
  const trail = [];
  for (let i = waves.length - 1; i >= 0; i--) { if (waves[i] && waves[i].passed === true) break; trail.push(waves[i]); }
  trail.reverse();
  const attempts = trail.length;
  const sigs = trail.map((w) => (w && w.signature ? String(w.signature) : "UNPARSEABLE")); // fail-closed token
  const osc = detectOscillation(sigs, K);
  const budgetBreaches = attempts >= maxAttempts ? (attempts - maxAttempts + 1) : 0;
  const oscBreaches = osc.detected ? osc.extraCycles + 1 : 0;
  const breaches = Math.max(budgetBreaches, oscBreaches);
  if (breaches <= 0) return mk(0, "within-budget-no-oscillation", attempts, false);
  const why = osc.detected
    ? `oscillation: ${osc.kind} over ${attempts} attempts`
    : `attempt budget: ${attempts} consecutive non-passing waves on this task`;
  return mk(clamp(breaches, 1, 3), why, attempts, osc.detected);
}
function mk(rung, reason, attempts, oscillation) { return { rung, action: RUNG[rung], reason, attempts, oscillation }; }
function detectOscillation(sigs, K) {
  const counts = {}; let maxCount = 0, maxSig = null;
  for (const s of sigs) { counts[s] = (counts[s] || 0) + 1; if (counts[s] > maxCount) { maxCount = counts[s]; maxSig = s; } }
  if (maxCount >= K) return { detected: true, kind: `repeat(${maxSig})`, extraCycles: maxCount - K };
  if (sigs.length >= 4) {
    const a = sigs[sigs.length - 1], b = sigs[sigs.length - 2];
    if (a !== b) {
      let cyc = 0, ok = true;
      for (let i = sigs.length - 1; i >= 0; i--) { const expect = ((sigs.length - 1 - i) % 2 === 0) ? a : b; if (sigs[i] !== expect) { ok = false; break; } cyc++; }
      const full = Math.floor(cyc / 2);
      if (ok && full >= K) return { detected: true, kind: `2cycle(${a}<->${b})`, extraCycles: full - K };
    }
  }
  return { detected: false, kind: null, extraCycles: 0 };
}
