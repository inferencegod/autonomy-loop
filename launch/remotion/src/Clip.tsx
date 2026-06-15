import React from "react";
import {
  AbsoluteFill, Audio, staticFile, Sequence, useCurrentFrame, useVideoConfig, interpolate, spring, Easing,
} from "remotion";

const MONO = "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";
const BG = "#0b0f14";
const FG = "#e6edf3";
const DIM = "#7d8896";
const BUILD = "#36d399";
const REVIEW = "#fbbf24";
const DENY = "#f87171";
const PANEL = "#121821";
const BORDER = "#1f2a37";

// ── MUSIC ───────────────────────────────────────────────────────────────────
// track lives at launch/remotion/public/track.mp3
const HAS_AUDIO = true;
const BPM = 126; // Cloudscape ≈ driving techno. Tune to your track.

const smooth = (x: number) => x * x * (3 - 2 * x);

const FadeIn: React.FC<{ at: number; children: React.ReactNode; y?: number; dur?: number }> = ({ at, children, y = 24, dur = 16 }) => {
  const f = useCurrentFrame();
  const o = interpolate(f, [at, at + dur], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const ty = interpolate(f, [at, at + dur], [y, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: Easing.out(Easing.cubic) });
  return <div style={{ opacity: o, transform: `translateY(${ty}px)` }}>{children}</div>;
};

const Scene: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <AbsoluteFill style={{ background: BG, color: FG, fontFamily: MONO, alignItems: "center", justifyContent: "center", padding: 110 }}>
    {children}
  </AbsoluteFill>
);

// ── HOOK (cold open, ~3.7s) ───────────────────────────────────────────────────
const Hook: React.FC = () => {
  const f = useCurrentFrame(); const { fps } = useVideoConfig();
  const s = spring({ frame: f - 18, fps, config: { damping: 14, stiffness: 200 } });
  return (
    <Scene>
      <div style={{ textAlign: "center" }}>
        <FadeIn at={0} dur={14}><div style={{ fontSize: 58, color: DIM, letterSpacing: 1 }}>two AIs. one repo.</div></FadeIn>
        <div style={{ transform: `scale(${interpolate(s, [0, 1], [0.8, 1])})`, marginTop: 26 }}>
          <div style={{ fontSize: 150, fontWeight: 800, letterSpacing: -3, color: BUILD, lineHeight: 1 }}>nobody's driving.</div>
        </div>
        <FadeIn at={58} dur={16}><div style={{ fontSize: 32, color: DIM, marginTop: 46 }}>…and it still ships real, reviewed code.</div></FadeIn>
      </div>
    </Scene>
  );
};

const Panel: React.FC<{ title: string; color: string; lines: string[]; active: boolean }> = ({ title, color, lines, active }) => (
  <div style={{ width: 600, background: PANEL, border: `2px solid ${active ? color : BORDER}`, borderRadius: 14, overflow: "hidden", boxShadow: active ? `0 0 46px ${color}33` : "none", transition: "none" }}>
    <div style={{ display: "flex", gap: 8, alignItems: "center", padding: "14px 20px", background: "#0e141c", borderBottom: `1px solid ${BORDER}` }}>
      <span style={{ width: 12, height: 12, borderRadius: 9, background: "#ff5f56" }} />
      <span style={{ width: 12, height: 12, borderRadius: 9, background: "#ffbd2e" }} />
      <span style={{ width: 12, height: 12, borderRadius: 9, background: "#27c93f" }} />
      <span style={{ marginLeft: 14, color, fontWeight: 700, fontSize: 26 }}>{title}</span>
      <span style={{ marginLeft: "auto", fontSize: 18, color, opacity: active ? 1 : 0.25 }}>{active ? "● working" : "○ idle"}</span>
    </div>
    <div style={{ padding: 22, fontSize: 23, lineHeight: 1.65, color: DIM, minHeight: 200 }}>
      {lines.map((l, i) => <div key={i}>{l}</div>)}
    </div>
  </div>
);

const Terminals: React.FC = () => {
  const f = useCurrentFrame();
  // eased baton: dwell left → glide → dwell right → glide back (no bouncing emoji)
  const C = 170;
  const t = f % C;
  let p: number;
  if (t < 40) p = 0;
  else if (t < 85) p = smooth((t - 40) / 45);
  else if (t < 125) p = 1;
  else p = 1 - smooth((t - 125) / 45);
  const SPAN = 360;
  const x = (p - 0.5) * SPAN;
  const leftActive = p < 0.5;
  const pillColor = leftActive ? BUILD : REVIEW;
  const moving = (t >= 40 && t < 85) || t >= 125;
  return (
    <Scene>
      <FadeIn at={0}><div style={{ fontSize: 32, color: DIM, marginBottom: 56 }}>no chat — they hand off a baton in <span style={{ color: FG }}>LOOP-STATE.md</span></div></FadeIn>
      <div style={{ display: "flex", gap: 110, alignItems: "center", position: "relative" }}>
        <Panel title="T1 · Builder" color={BUILD} active={leftActive} lines={["> read baton", "> code + RED→GREEN test", "> run the gate", "> commit · push"]} />
        {/* clean connector + gliding baton pill */}
        <div style={{ position: "absolute", left: "50%", top: "44%", transform: "translate(-50%,-50%)", width: SPAN, height: 2, background: BORDER }} />
        <div style={{
          position: "absolute", left: "50%", top: "44%",
          transform: `translate(-50%,-50%) translateX(${x}px)`,
          width: 60, height: 16, borderRadius: 10, background: pillColor,
          boxShadow: `0 0 ${moving ? 26 : 14}px ${pillColor}`, opacity: 0.95,
        }} />
        <Panel title="T2 · Reviewer" color={REVIEW} active={!leftActive} lines={["> re-run the gate", "> 5-lens review", "> red-team the opposite", "> fix safe · flag rest"]} />
      </div>
    </Scene>
  );
};

// SELF-IDEATION — empty queue → it invents the next feature
const Invents: React.FC = () => {
  const f = useCurrentFrame();
  const ticks = [
    "queue empty → research the next feature",
    "R-2 LIVEMOVES: surface the $0 live line-feed",
    "build it · gate green · ship · repeat",
  ];
  const active = ticks.reduce((acc, _, i) => (f >= 30 + i * 46 ? i : acc), 0);
  return (
    <Scene>
      <FadeIn at={0}><div style={{ fontSize: 50, fontWeight: 700, textAlign: "center" }}>out of tasks? it <span style={{ color: BUILD }}>invents the next one</span></div></FadeIn>
      <FadeIn at={12}><div style={{ fontSize: 26, color: DIM, marginTop: 16, marginBottom: 38, textAlign: "center", maxWidth: 1100 }}>an empty backlog isn't a stop — it researches, proposes, and builds</div></FadeIn>
      <div style={{ width: 1040, background: PANEL, border: `1px solid ${BORDER}`, borderRadius: 14, padding: "24px 32px", textAlign: "left" }}>
        <div style={{ color: DIM, fontSize: 22, marginBottom: 18 }}>LOOP-STATE.md · turn: builder</div>
        {ticks.map((t, i) => {
          const start = 30 + i * 46;
          if (f < start) return null;
          const chars = Math.round(interpolate(f, [start, start + 26], [0, t.length], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }));
          const isActive = i === active;
          return (
            <div key={i} style={{ fontSize: 24, color: isActive ? FG : DIM, opacity: isActive ? 1 : 0.5, marginBottom: 12 }}>
              <span style={{ color: REVIEW }}>pending:</span> {t.slice(0, chars)}{isActive && chars < t.length ? "▋" : ""}
            </div>
          );
        })}
      </div>
    </Scene>
  );
};

const Lenses: React.FC = () => {
  const lenses = [["⊹", "Correctness"], ["✓", "Honesty / no-fabrication"], ["♻", "Regression + frozen-drift"], ["🔒", "Security / secrets"], ["▦", "UX / render"]];
  return (
    <Scene>
      <FadeIn at={0}><div style={{ fontSize: 46, fontWeight: 700, marginBottom: 12 }}>the reviewer is <span style={{ color: REVIEW }}>adversarial by design</span></div></FadeIn>
      <FadeIn at={10}><div style={{ fontSize: 28, color: DIM, marginBottom: 44 }}>5 lenses — every one must pass</div></FadeIn>
      <div style={{ display: "flex", flexDirection: "column", gap: 16, width: 760 }}>
        {lenses.map(([icon, label], i) => (
          <FadeIn key={i} at={22 + i * 18} y={16} dur={12}>
            <div style={{ display: "flex", alignItems: "center", gap: 22, background: PANEL, border: `1px solid ${BORDER}`, borderRadius: 12, padding: "18px 28px", fontSize: 31 }}>
              <span style={{ fontSize: 28 }}>{icon}</span><span style={{ flex: 1 }}>{label}</span><span style={{ color: BUILD, fontWeight: 700 }}>PASS</span>
            </div>
          </FadeIn>
        ))}
      </div>
    </Scene>
  );
};

// GATE-GUARD DENY
const Gate: React.FC = () => {
  const f = useCurrentFrame(); const { fps } = useVideoConfig();
  const cmd = "$ git push --force origin main";
  const shown = cmd.slice(0, Math.round(interpolate(f, [8, 46], [0, cmd.length], { extrapolateLeft: "clamp", extrapolateRight: "clamp" })));
  const blink = Math.floor(f / 8) % 2 === 0;
  const stamp = spring({ frame: f - 52, fps, config: { damping: 11, stiffness: 220 } });
  const stampO = interpolate(f, [52, 60], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  return (
    <Scene>
      <FadeIn at={0}><div style={{ fontSize: 30, color: DIM, marginBottom: 32 }}>a safety tripwire on every tool call</div></FadeIn>
      <div style={{ fontFamily: MONO, fontSize: 30, background: PANEL, border: `1px solid ${BORDER}`, borderRadius: 12, padding: "24px 32px", color: FG, minWidth: 540 }}>
        {shown}<span style={{ opacity: blink ? 1 : 0, color: DENY }}>▋</span>
      </div>
      <div style={{ height: 160, display: "flex", alignItems: "center", justifyContent: "center", marginTop: 24 }}>
        <div style={{ transformOrigin: "center", transform: `scale(${interpolate(stamp, [0, 1], [1.5, 1])}) rotate(${interpolate(stamp, [0, 1], [-13, -7])}deg)`, opacity: stampO, border: `5px solid ${DENY}`, color: DENY, borderRadius: 14, padding: "14px 46px", textAlign: "center" }}>
          <div style={{ fontWeight: 800, fontSize: 70, letterSpacing: 5, lineHeight: 1 }}>DENIED</div>
          <div style={{ fontSize: 22, letterSpacing: 1, marginTop: 8 }}>main is production</div>
        </div>
      </div>
      <FadeIn at={70}><div style={{ fontSize: 25, color: DIM, marginTop: 22 }}>blocks prod push · force-push · history rewrite · protected files</div></FadeIn>
    </Scene>
  );
};

const Honesty: React.FC = () => (
  <Scene>
    <FadeIn at={0}><div style={{ fontSize: 64, fontWeight: 800, textAlign: "center", lineHeight: 1.25 }}>no fabricated numbers.<br /><span style={{ color: BUILD }}>ever.</span></div></FadeIn>
    <FadeIn at={20}><div style={{ fontSize: 30, color: DIM, marginTop: 36, textAlign: "center", maxWidth: 1080 }}>every figure carries its sample size — or says <span style={{ color: FG }}>"building — N/30."</span></div></FadeIn>
  </Scene>
);

// PROOF — real shipped commits
const Proof: React.FC = () => {
  const f = useCurrentFrame();
  const rows: [string, string, string][] = [
    ["a984280", "ACC-2 · auto-track accuracy evidence", "reviewed-PASS"],
    ["a76ab7c", "WAVE 1 §E · live-watch firewall", "golden byte-identical"],
    ["ccf2d6e", "WAVE 3b · /api/stream $0 live feed", "reviewed-PASS"],
    ["d1b70de", "WAVE 4 §G · scorecard (money-path)", "PASS · no re-baseline"],
    ["fc4d673", "R-2 LIVEMOVES · it proposed this itself", "shipped"],
  ];
  return (
    <Scene>
      <FadeIn at={0}><div style={{ fontSize: 42, fontWeight: 700, marginBottom: 30 }}>one afternoon. <span style={{ color: BUILD }}>zero humans.</span></div></FadeIn>
      <div style={{ width: 1240, fontFamily: MONO, textAlign: "left" }}>
        {rows.map((r, i) => {
          const at = 16 + i * 22;
          const o = interpolate(f, [at, at + 12], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
          const ty = interpolate(f, [at, at + 12], [18, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: Easing.out(Easing.cubic) });
          return (
            <div key={i} style={{ opacity: o, transform: `translateY(${ty}px)`, display: "flex", alignItems: "center", gap: 18, padding: "13px 24px", marginBottom: 10, background: PANEL, border: `1px solid ${BORDER}`, borderRadius: 10, fontSize: 23 }}>
              <span style={{ color: REVIEW }}>{r[0]}</span>
              <span style={{ flex: 1, color: FG }}>{r[1]}</span>
              <span style={{ color: BUILD, fontWeight: 700 }}>{r[2]}</span>
            </div>
          );
        })}
      </div>
      <FadeIn at={140}><div style={{ fontSize: 30, color: FG, marginTop: 28 }}>1242 tests · 0 fail · golden byte-identical</div></FadeIn>
    </Scene>
  );
};

const CTA: React.FC = () => {
  const f = useCurrentFrame(); const { fps } = useVideoConfig();
  const s = spring({ frame: f, fps, config: { damping: 200 } });
  return (
    <Scene>
      <div style={{ textAlign: "center", transform: `scale(${interpolate(s, [0, 1], [0.92, 1])})` }}>
        <div style={{ fontSize: 96, fontWeight: 800 }}>autonomy<span style={{ color: BUILD }}>-</span>loop</div>
        <FadeIn at={16}><div style={{ marginTop: 36, fontSize: 32, background: PANEL, border: `1px solid ${BORDER}`, borderRadius: 12, padding: "20px 32px", color: FG, display: "inline-block" }}>claude plugin marketplace add <span style={{ color: BUILD }}>inferencegod/autonomy-loop</span></div></FadeIn>
        <FadeIn at={34}><div style={{ marginTop: 34, fontSize: 27, color: DIM }}>MIT · a Claude Code plugin</div></FadeIn>
      </div>
    </Scene>
  );
};

// subtle on-beat pulse
const BeatPulse: React.FC = () => {
  const f = useCurrentFrame(); const { fps } = useVideoConfig();
  const fpb = (fps * 60) / BPM;
  const phase = (f % fpb) / fpb;
  const o = 0.05 * (1 - phase);
  return <AbsoluteFill style={{ background: "#ffffff", opacity: o, pointerEvents: "none", mixBlendMode: "overlay" }} />;
};

// timeline (30fps): Hook 110 · Terminals 190 · Invents 220 · Lenses 170 · Gate 160 · Honesty 120 · Proof 200 · CTA 140 = 1310 (~43.7s)
export const Clip: React.FC = () => (
  <AbsoluteFill style={{ background: BG }}>
    {HAS_AUDIO && <Audio src={staticFile("track.mp3")} volume={(f) => interpolate(f, [0, 28, 1250, 1310], [0, 0.6, 0.6, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" })} />}
    <Sequence durationInFrames={110}><Hook /></Sequence>
    <Sequence from={110} durationInFrames={190}><Terminals /></Sequence>
    <Sequence from={300} durationInFrames={220}><Invents /></Sequence>
    <Sequence from={520} durationInFrames={170}><Lenses /></Sequence>
    <Sequence from={690} durationInFrames={160}><Gate /></Sequence>
    <Sequence from={850} durationInFrames={120}><Honesty /></Sequence>
    <Sequence from={970} durationInFrames={200}><Proof /></Sequence>
    <Sequence from={1170} durationInFrames={140}><CTA /></Sequence>
    <BeatPulse />
  </AbsoluteFill>
);
