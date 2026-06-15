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

// MUSIC: drop an mp3 at launch/remotion/public/track.mp3, then set this true and re-render.
const HAS_AUDIO = false;

const FadeIn: React.FC<{ at: number; children: React.ReactNode; y?: number; dur?: number }> = ({ at, children, y = 24, dur = 18 }) => {
  const f = useCurrentFrame();
  const o = interpolate(f, [at, at + dur], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const ty = interpolate(f, [at, at + dur], [y, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: Easing.out(Easing.cubic) });
  return <div style={{ opacity: o, transform: `translateY(${ty}px)` }}>{children}</div>;
};

const Scene: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <AbsoluteFill style={{ background: BG, color: FG, fontFamily: MONO, alignItems: "center", justifyContent: "center", padding: 120 }}>
    {children}
  </AbsoluteFill>
);

const Title: React.FC = () => {
  const f = useCurrentFrame(); const { fps } = useVideoConfig();
  const s = spring({ frame: f, fps, config: { damping: 200 } });
  return (
    <Scene>
      <div style={{ transform: `scale(${interpolate(s, [0, 1], [0.92, 1])})`, textAlign: "center" }}>
        <div style={{ fontSize: 120, fontWeight: 800, letterSpacing: -2 }}>autonomy<span style={{ color: BUILD }}>-</span>loop</div>
        <FadeIn at={18}><div style={{ fontSize: 40, color: DIM, marginTop: 24 }}>two terminals. one repo. a git baton.</div></FadeIn>
        <FadeIn at={40}><div style={{ fontSize: 26, color: DIM, marginTop: 60 }}>a Claude Code plugin</div></FadeIn>
      </div>
    </Scene>
  );
};

const Panel: React.FC<{ title: string; color: string; lines: string[]; active: boolean }> = ({ title, color, lines, active }) => (
  <div style={{ width: 620, background: PANEL, border: `2px solid ${active ? color : BORDER}`, borderRadius: 14, overflow: "hidden" }}>
    <div style={{ display: "flex", gap: 8, alignItems: "center", padding: "16px 22px", background: "#0e141c", borderBottom: `1px solid ${BORDER}` }}>
      <span style={{ width: 13, height: 13, borderRadius: 9, background: "#ff5f56" }} />
      <span style={{ width: 13, height: 13, borderRadius: 9, background: "#ffbd2e" }} />
      <span style={{ width: 13, height: 13, borderRadius: 9, background: "#27c93f" }} />
      <span style={{ marginLeft: 14, color, fontWeight: 700, fontSize: 26 }}>{title}</span>
    </div>
    <div style={{ padding: 24, fontSize: 24, lineHeight: 1.7, color: DIM, minHeight: 220 }}>
      {lines.map((l, i) => <div key={i}>{l}</div>)}
    </div>
  </div>
);

const Terminals: React.FC = () => {
  const f = useCurrentFrame();
  const baton = (f % 120) / 120;
  const x = Math.sin(baton * Math.PI * 2) * 300;
  const toReviewer = Math.sin(baton * Math.PI * 2) > 0;
  return (
    <Scene>
      <FadeIn at={0}><div style={{ fontSize: 34, color: DIM, marginBottom: 50 }}>they never talk in chat — they pass a baton in <span style={{ color: FG }}>LOOP-STATE.md</span></div></FadeIn>
      <div style={{ display: "flex", gap: 80, alignItems: "center", position: "relative" }}>
        <Panel title="T1 · Builder" color={BUILD} active={!toReviewer} lines={["> read baton", "> write code + RED→GREEN test", "> run the gate", "> commit · push work branch"]} />
        <div style={{ position: "absolute", left: "50%", top: "50%", transform: `translate(-50%,-50%) translateX(${x}px)`, fontSize: 40 }}>🪙</div>
        <Panel title="T2 · Reviewer" color={REVIEW} active={toReviewer} lines={["> re-run the gate itself", "> 5-lens review", "> red-team the opposite", "> fix safe · flag rest"]} />
      </div>
    </Scene>
  );
};

// PROMPT WRITES ITSELF
const PromptEvolves: React.FC = () => {
  const f = useCurrentFrame();
  const ticks = [
    "ship ACC-1 + RED→GREEN test",
    "reviewer caught a null-odds path → fix it, re-gate",
    "tier-accuracy green · next: wire the calibration report",
  ];
  const active = ticks.reduce((acc, _, i) => (f >= 30 + i * 40 ? i : acc), 0);
  return (
    <Scene>
      <FadeIn at={0}><div style={{ fontSize: 46, fontWeight: 700 }}>the loop writes its <span style={{ color: BUILD }}>own next move</span></div></FadeIn>
      <FadeIn at={12}><div style={{ fontSize: 28, color: DIM, marginBottom: 40, textAlign: "center", maxWidth: 1100 }}>every tick it appends the next prompt to the baton — you never re-prompt</div></FadeIn>
      <div style={{ width: 1040, background: PANEL, border: `1px solid ${BORDER}`, borderRadius: 14, padding: "24px 30px", fontFamily: MONO, textAlign: "left" }}>
        <div style={{ color: DIM, fontSize: 22, marginBottom: 18 }}>LOOP-STATE.md · turn: builder</div>
        {ticks.map((t, i) => {
          const start = 30 + i * 40;
          if (f < start) return null;
          const chars = Math.round(interpolate(f, [start, start + 26], [0, t.length], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }));
          const isActive = i === active;
          return (
            <div key={i} style={{ fontSize: 24, color: isActive ? FG : DIM, opacity: isActive ? 1 : 0.45, marginBottom: 12 }}>
              <span style={{ color: REVIEW }}>pending-for-builder:</span> {t.slice(0, chars)}{isActive && chars < t.length ? "▋" : ""}
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
      <FadeIn at={0}><div style={{ fontSize: 48, fontWeight: 700, marginBottom: 16 }}>the reviewer is <span style={{ color: REVIEW }}>adversarial by construction</span></div></FadeIn>
      <FadeIn at={12}><div style={{ fontSize: 30, color: DIM, marginBottom: 56 }}>5 lenses — every one must pass</div></FadeIn>
      <div style={{ display: "flex", flexDirection: "column", gap: 18, width: 760 }}>
        {lenses.map(([icon, label], i) => (
          <FadeIn key={i} at={24 + i * 16} y={16}>
            <div style={{ display: "flex", alignItems: "center", gap: 22, background: PANEL, border: `1px solid ${BORDER}`, borderRadius: 12, padding: "20px 28px", fontSize: 32 }}>
              <span style={{ fontSize: 30 }}>{icon}</span><span style={{ flex: 1 }}>{label}</span><span style={{ color: BUILD, fontWeight: 700 }}>PASS</span>
            </div>
          </FadeIn>
        ))}
      </div>
    </Scene>
  );
};

// EFFORT SCALES TO RISK (ultrathink / token-aware)
const EffortScales: React.FC = () => {
  const f = useCurrentFrame();
  const w1 = interpolate(f, [24, 44], [0, 200], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const w2 = interpolate(f, [46, 88], [0, 720], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  return (
    <Scene>
      <FadeIn at={0}><div style={{ fontSize: 48, fontWeight: 700 }}>thinking <span style={{ color: REVIEW }}>scales to the risk</span></div></FadeIn>
      <FadeIn at={12}><div style={{ fontSize: 28, color: DIM, marginBottom: 54, textAlign: "center", maxWidth: 1120 }}>cheap effort on trivial diffs · ultrathink only when it's dangerous — token-aware and tunable per project</div></FadeIn>
      <div style={{ width: 940, textAlign: "left", fontFamily: MONO }}>
        <div style={{ marginBottom: 34 }}>
          <div style={{ fontSize: 26, color: DIM, marginBottom: 12 }}>trivial diff → quick pass · low tokens</div>
          <div style={{ height: 28, width: w1, background: BUILD, borderRadius: 6 }} />
        </div>
        <div>
          <div style={{ fontSize: 26, color: FG, marginBottom: 12 }}>frozen-drift / protected path → <span style={{ color: REVIEW }}>ultrathink, deep</span></div>
          <div style={{ height: 28, width: w2, background: REVIEW, borderRadius: 6 }} />
        </div>
      </div>
    </Scene>
  );
};

// GATE-GUARD DENY
const Gate: React.FC = () => {
  const f = useCurrentFrame(); const { fps } = useVideoConfig();
  const cmd = "$ git push --force origin main";
  const shown = cmd.slice(0, Math.round(interpolate(f, [6, 42], [0, cmd.length], { extrapolateLeft: "clamp", extrapolateRight: "clamp" })));
  const blink = Math.floor(f / 8) % 2 === 0;
  const stamp = spring({ frame: f - 46, fps, config: { damping: 11, stiffness: 220 } });
  const stampO = interpolate(f, [46, 54], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  return (
    <Scene>
      <FadeIn at={0}><div style={{ fontSize: 32, color: DIM, marginBottom: 34 }}>a safety tripwire on every tool call</div></FadeIn>
      <div style={{ fontFamily: MONO, fontSize: 30, background: PANEL, border: `1px solid ${BORDER}`, borderRadius: 12, padding: "26px 34px", color: FG, minWidth: 540 }}>
        {shown}<span style={{ opacity: blink ? 1 : 0, color: DENY }}>▋</span>
      </div>
      <div style={{ height: 170, display: "flex", alignItems: "center", justifyContent: "center", marginTop: 24 }}>
        <div style={{ transformOrigin: "center", transform: `scale(${interpolate(stamp, [0, 1], [1.5, 1])}) rotate(${interpolate(stamp, [0, 1], [-13, -7])}deg)`, opacity: stampO, border: `5px solid ${DENY}`, color: DENY, borderRadius: 14, padding: "16px 48px", textAlign: "center", maxWidth: 660 }}>
          <div style={{ fontWeight: 800, fontSize: 72, letterSpacing: 5, lineHeight: 1 }}>DENIED</div>
          <div style={{ fontSize: 22, letterSpacing: 1, marginTop: 8 }}>main is production</div>
        </div>
      </div>
      <FadeIn at={62}><div style={{ fontSize: 26, color: DIM, marginTop: 26 }}>blocks prod push · force-push · history rewrite · protected files</div></FadeIn>
    </Scene>
  );
};

const Honesty: React.FC = () => (
  <Scene>
    <FadeIn at={0}><div style={{ fontSize: 64, fontWeight: 800, textAlign: "center", lineHeight: 1.3 }}>no fabricated numbers.<br /><span style={{ color: BUILD }}>ever.</span></div></FadeIn>
    <FadeIn at={20}><div style={{ fontSize: 34, color: DIM, marginTop: 40, textAlign: "center", maxWidth: 1100 }}>every figure carries its sample size — or says <span style={{ color: FG }}>"building — N/30."</span> a capability with no real data abstains, visibly.</div></FadeIn>
  </Scene>
);

const CTA: React.FC = () => (
  <Scene>
    <div style={{ textAlign: "center" }}>
      <FadeIn at={0}><div style={{ fontSize: 88, fontWeight: 800 }}>autonomy<span style={{ color: BUILD }}>-</span>loop</div></FadeIn>
      <FadeIn at={16}><div style={{ marginTop: 44, fontSize: 34, background: PANEL, border: `1px solid ${BORDER}`, borderRadius: 12, padding: "22px 34px", color: FG, display: "inline-block" }}>claude plugin marketplace add <span style={{ color: BUILD }}>inferencegod/autonomy-loop</span></div></FadeIn>
      <FadeIn at={34}><div style={{ marginTop: 40, fontSize: 28, color: DIM }}>MIT · github.com/inferencegod/autonomy-loop</div></FadeIn>
    </div>
  </Scene>
);

export const Clip: React.FC = () => (
  <AbsoluteFill style={{ background: BG }}>
    {HAS_AUDIO && <Audio src={staticFile("track.mp3")} volume={(f) => interpolate(f, [0, 30], [0, 0.55], { extrapolateRight: "clamp" })} />}
    <Sequence durationInFrames={100}><Title /></Sequence>
    <Sequence from={100} durationInFrames={180}><Terminals /></Sequence>
    <Sequence from={280} durationInFrames={170}><PromptEvolves /></Sequence>
    <Sequence from={450} durationInFrames={150}><Lenses /></Sequence>
    <Sequence from={600} durationInFrames={150}><EffortScales /></Sequence>
    <Sequence from={750} durationInFrames={140}><Gate /></Sequence>
    <Sequence from={890} durationInFrames={100}><Honesty /></Sequence>
    <Sequence from={990} durationInFrames={130}><CTA /></Sequence>
  </AbsoluteFill>
);
