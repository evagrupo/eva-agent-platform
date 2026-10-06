import React from "react";
import { AbsoluteFill, Img, interpolate, spring, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import { brand } from "../theme";
import { Logo } from "../ui";

/**
 * Hook · 0–9.6s. Problem first: the ad opens on the pain the product removes,
 * so the viewer understands it in the first second, before any product talk.
 *
 *   0.0–1.6s  first problem shot                          · "Late."
 *   1.6–3.3s  supporting detail graphic                   · voice-over continues
 *   3.3–6.5s  the failed attempts                         · "Still waiting."
 *   6.5–9.6s  the counter and the closing question
 *
 * Everything is centred on one axis, and each beat clears its own text before
 * the next begins.
 */
type Beat = {
  photo: string;
  word?: string;
  temp?: { value: string; time: string };
  calls?: { name: string; status: string }[];
  from: number;
  to: number;
  focus: string;
};

const BEATS: Beat[] = [
  { photo: "img/hook-1.jpg", word: "Late.", from: 0, to: 48, focus: "55% 35%" },
  { photo: "img/hook-2.jpg", temp: { value: "39.2 °C", time: "03:10" }, from: 48, to: 100, focus: "50% 40%" },
  {
    photo: "img/hook-3.jpg",
    word: "Still waiting.",
    calls: [
      { name: "Provider A", status: "Line busy…" },
      { name: "Provider B", status: "Nothing until Tuesday" },
    ],
    from: 100,
    to: 196,
    focus: "70% 40%",
  },
  { photo: "img/hook-4.jpg", from: 196, to: 288, focus: "55% 55%" },
];

/** Supporting detail — the concrete signal that makes the problem real. */
const TempCard: React.FC<{ value: string; time: string; progress: number }> = ({ value, time, progress }) => (
  <div
    style={{
      display: "flex",
      alignItems: "center",
      gap: 28,
      background: "rgba(255,255,255,.96)",
      borderRadius: 34,
      padding: "28px 44px",
      opacity: progress,
      transform: `scale(${interpolate(progress, [0, 1], [0.9, 1])})`,
    }}
  >
    <span style={{ fontSize: 92, fontWeight: 700, color: "#d64545", lineHeight: 1 }}>{value}</span>
    <span style={{ textAlign: "left", color: brand.ink3, fontSize: 30, lineHeight: 1.25 }}>
      temperature
      <br />
      <b style={{ color: brand.dark, fontSize: 34 }}>{time} h</b>
    </span>
  </div>
);

/** A failed attempt: red cross, who, what went wrong. */
const FailedCall: React.FC<{ name: string; status: string; progress: number }> = ({ name, status, progress }) => (
  <div
    style={{
      display: "flex",
      alignItems: "center",
      gap: 24,
      background: "rgba(96,20,28,.8)",
      border: "3px solid rgba(255,138,138,.5)",
      borderRadius: 28,
      padding: "20px 34px",
      opacity: progress,
      transform: `translateY(${interpolate(progress, [0, 1], [-24, 0])}px)`,
    }}
  >
    <div
      style={{
        width: 58,
        height: 58,
        borderRadius: 999,
        background: "#d64545",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        flexShrink: 0,
      }}
    >
      <svg width="28" height="28" viewBox="0 0 24 24" fill="none">
        <path d="M6 6l12 12M18 6L6 18" stroke="#fff" strokeWidth="3" strokeLinecap="round" />
      </svg>
    </div>
    <div style={{ textAlign: "left" }}>
      <div style={{ color: brand.white, fontSize: 33, fontWeight: 700, lineHeight: 1.15 }}>{name}</div>
      <div style={{ color: "#ffb3b3", fontSize: 28, lineHeight: 1.2 }}>{status}</div>
    </div>
  </div>
);

export const Hook: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const counter = Math.max(
    0,
    Math.min(7, Math.floor(interpolate(frame, [104, 190], [0, 7], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }))),
  );
  const question = spring({ frame: frame - 206, fps, config: { damping: 15, stiffness: 150, mass: 0.6 } });
  const counterIn = interpolate(frame, [198, 212], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });

  return (
    <AbsoluteFill style={{ background: brand.darkDeep }}>
      {BEATS.map((b) => {
        const local = frame - b.from;
        const len = b.to - b.from;
        if (local < 0 || local > len) return null;
        const zoom = interpolate(local, [0, len], [1.04, 1.12], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
        const photoIn = b.from === 0 ? 1 : interpolate(local, [0, 6], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
        const textIn = spring({ frame: local - 6, fps, config: { damping: 14, stiffness: 170, mass: 0.6 } });
        const cardIn = spring({ frame: local - 10, fps, config: { damping: 15, stiffness: 150, mass: 0.6 } });
        const textOut = interpolate(local, [len - 10, len - 2], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });

        return (
          <AbsoluteFill key={b.photo} style={{ opacity: photoIn }}>
            <AbsoluteFill style={{ overflow: "hidden" }}>
              <Img
                src={staticFile(b.photo)}
                style={{ width: "100%", height: "100%", objectFit: "cover", objectPosition: b.focus, transform: `scale(${zoom})` }}
              />
            </AbsoluteFill>
            <AbsoluteFill
              style={{
                background:
                  "linear-gradient(0deg, rgba(20,20,60,.9) 0%, rgba(20,20,60,.72) 28%, rgba(20,20,60,.3) 56%, rgba(20,20,60,.12) 78%), linear-gradient(180deg, rgba(20,20,60,.7) 0%, rgba(20,20,60,.08) 24%)",
              }}
            />

            <AbsoluteFill
              style={{
                padding: 80,
                paddingBottom: 500,
                alignItems: "center",
                justifyContent: "flex-end",
                textAlign: "center",
                opacity: textOut,
                gap: 22,
              }}
            >
              {b.calls?.map((c, i) => (
                <FailedCall
                  key={c.name}
                  name={c.name}
                  status={c.status}
                  progress={spring({ frame: local - 14 - i * 12, fps, config: { damping: 15, stiffness: 150, mass: 0.6 } })}
                />
              ))}
              {b.temp ? <TempCard value={b.temp.value} time={b.temp.time} progress={cardIn} /> : null}
              {b.word ? (
                <div
                  style={{
                    marginTop: 18,
                    fontSize: 132,
                    fontWeight: 700,
                    letterSpacing: "-0.035em",
                    lineHeight: 1.02,
                    color: brand.white,
                    opacity: textIn,
                    transform: `translateY(${interpolate(textIn, [0, 1], [40, 0])}px)`,
                  }}
                >
                  {b.word}
                </div>
              ) : null}
            </AbsoluteFill>
          </AbsoluteFill>
        );
      })}

      {/* the logo is always top-left, same size, in every scene */}
      <AbsoluteFill style={{ padding: 80, alignItems: "flex-start", pointerEvents: "none" }}>
        <Logo white height={70} />
      </AbsoluteFill>

      <AbsoluteFill
        style={{
          padding: 80,
          paddingBottom: 420,
          alignItems: "center",
          justifyContent: "flex-end",
          textAlign: "center",
          pointerEvents: "none",
        }}
      >
        <div style={{ display: "flex", alignItems: "baseline", gap: 20, marginBottom: 26, opacity: counterIn }}>
          <span style={{ fontSize: 132, fontWeight: 700, color: brand.primaryLight, lineHeight: 1 }}>{counter}</span>
          <span style={{ fontSize: 42, color: "rgba(255,255,255,.82)" }}>attempts, still nothing</span>
        </div>
        <h1
          style={{
            margin: 0,
            fontSize: 104,
            lineHeight: 1.02,
            letterSpacing: "-0.035em",
            fontWeight: 700,
            color: brand.white,
            opacity: question,
            transform: `translateY(${interpolate(question, [0, 1], [40, 0])}px)`,
          }}
        >
          Does it really
          <br />
          <span style={{ color: brand.primaryLight }}>have to be this hard?</span>
        </h1>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
