import React from "react";
import {
  AbsoluteFill,
  Img,
  interpolate,
  spring,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { eva } from "./theme";

/** Spring-based entrance: fade + rise, optional delay in frames. */
export const useEnter = (delay = 0, damping = 200) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const s = spring({ frame: frame - delay, fps, config: { damping, mass: 0.6, stiffness: 120 } });
  return { progress: s, opacity: s, y: interpolate(s, [0, 1], [40, 0]) };
};

export const Rise: React.FC<{
  delay?: number;
  children: React.ReactNode;
  style?: React.CSSProperties;
  distance?: number;
}> = ({ delay = 0, children, style, distance = 40 }) => {
  const { progress } = useEnter(delay);
  return (
    <div
      style={{
        opacity: progress,
        transform: `translateY(${interpolate(progress, [0, 1], [distance, 0])}px)`,
        ...style,
      }}
    >
      {children}
    </div>
  );
};

export const Pop: React.FC<{ delay?: number; children: React.ReactNode; style?: React.CSSProperties }> = ({
  delay = 0,
  children,
  style,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const s = spring({ frame: frame - delay, fps, config: { damping: 14, mass: 0.7, stiffness: 140 } });
  return (
    <div style={{ opacity: Math.min(1, s * 1.4), transform: `scale(${interpolate(s, [0, 1], [0.86, 1])})`, ...style }}>
      {children}
    </div>
  );
};

/**
 * Line reveal: the text slides up from behind a mask instead of just fading in.
 * Used for headlines so the type feels deliberate rather than floaty.
 */
export const Reveal: React.FC<{ delay?: number; children: React.ReactNode; style?: React.CSSProperties }> = ({
  delay = 0,
  children,
  style,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const s = spring({ frame: frame - delay, fps, config: { damping: 18, mass: 0.7, stiffness: 110 } });
  return (
    <span style={{ display: "block", overflow: "hidden", paddingBottom: "0.08em", ...style }}>
      <span
        style={{
          display: "block",
          transform: `translateY(${interpolate(s, [0, 1], [110, 0])}%)`,
          opacity: interpolate(s, [0, 0.25], [0, 1], { extrapolateRight: "clamp" }),
        }}
      >
        {children}
      </span>
    </span>
  );
};

/** Soft brand background: navy or white with a large watermark leaf drifting slowly. */
export const Backdrop: React.FC<{ tone?: "light" | "navy" | "green"; leaf?: boolean }> = ({
  tone = "light",
  leaf = true,
}) => {
  const frame = useCurrentFrame();
  const bg =
    tone === "navy"
      ? `linear-gradient(160deg, ${eva.navy} 0%, ${eva.navyDeep} 100%)`
      : tone === "green"
        ? `linear-gradient(160deg, ${eva.green} 0%, ${eva.greenDark} 100%)`
        : `linear-gradient(170deg, #ffffff 0%, ${eva.mint} 100%)`;
  return (
    <AbsoluteFill style={{ background: bg }}>
      {leaf ? (
        <Img
          src={staticFile(tone === "light" ? "img/hoja.svg" : "img/hoja-blanca.svg")}
          style={{
            position: "absolute",
            right: -260,
            top: 380 + Math.sin(frame / 90) * 18,
            height: 1500,
            opacity: tone === "light" ? 0.06 : 0.1,
          }}
        />
      ) : null}
    </AbsoluteFill>
  );
};

/**
 * Brand logo — always top-left, always the same size.
 * `alignSelf`/`width:auto` matter: inside a flex column the image would
 * otherwise stretch to the full width and the SVG would centre itself in it,
 * which is what made the logo look centred in some scenes.
 */
export const Logo: React.FC<{ white?: boolean; height?: number; style?: React.CSSProperties }> = ({
  white,
  height = 70,
  style,
}) => (
  <Img
    src={staticFile(white ? "img/logo-blanco.svg" : "img/logo.svg")}
    style={{ height, width: "auto", alignSelf: "flex-start", flexShrink: 0, ...style }}
  />
);

export const Pill: React.FC<{ children: React.ReactNode; tone?: "mint" | "glass" }> = ({ children, tone = "mint" }) => (
  <span
    style={{
      display: "inline-block",
      fontSize: 34,
      fontWeight: 700,
      letterSpacing: "0.14em",
      textTransform: "uppercase",
      padding: "18px 34px",
      borderRadius: 999,
      background: tone === "mint" ? eva.mint : "rgba(255,255,255,.14)",
      color: tone === "mint" ? eva.greenDark : eva.greenLighter,
    }}
  >
    {children}
  </span>
);

export const Headline: React.FC<{ children: React.ReactNode; white?: boolean; size?: number }> = ({
  children,
  white,
  size = 118,
}) => (
  <h1
    style={{
      margin: 0,
      fontSize: size,
      lineHeight: 1.02,
      letterSpacing: "-0.035em",
      fontWeight: 700,
      color: white ? eva.white : eva.navy,
    }}
  >
    {children}
  </h1>
);

export const Sub: React.FC<{ children: React.ReactNode; white?: boolean }> = ({ children, white }) => (
  <p style={{ margin: 0, fontSize: 46, lineHeight: 1.3, color: white ? "rgba(255,255,255,.9)" : eva.ink2 }}>
    {children}
  </p>
);

/** Phone frame with a screen; children render inside the screen.
 *  Sized and proportioned like a current iPhone: bigger body (less dead space
 *  under the headline) and a taller pill-shaped notch. */
export const Phone: React.FC<{ children: React.ReactNode; style?: React.CSSProperties }> = ({ children, style }) => (
  <div
    style={{
      width: 720,
      height: 1440,
      borderRadius: 88,
      background: "#0d0d24",
      padding: 18,
      boxShadow: "0 60px 120px rgba(15,15,46,.45)",
      ...style,
    }}
  >
    <div
      style={{
        width: "100%",
        height: "100%",
        borderRadius: 72,
        background: "#f5f6f9",
        overflow: "hidden",
        position: "relative",
      }}
    >
      <div
        style={{
          position: "absolute",
          top: 26,
          left: "50%",
          transform: "translateX(-50%)",
          width: 196,
          height: 56,
          borderRadius: 999,
          background: "#0d0d24",
          zIndex: 3,
        }}
      />
      {children}
    </div>
  </div>
);

export const Bubble: React.FC<{ me?: boolean; children: React.ReactNode; delay: number }> = ({
  me,
  children,
  delay,
}) => (
  <Pop delay={delay} style={{ alignSelf: me ? "flex-end" : "flex-start", maxWidth: "86%" }}>
    <div
      style={{
        background: me ? eva.navy : eva.white,
        color: me ? eva.white : eva.navy,
        fontSize: 30,
        lineHeight: 1.3,
        padding: "22px 28px",
        borderRadius: 30,
        borderBottomRightRadius: me ? 8 : 30,
        borderBottomLeftRadius: me ? 30 : 8,
        boxShadow: "0 14px 30px rgba(35,34,99,.14)",
      }}
    >
      {children}
    </div>
  </Pop>
);

export const Card: React.FC<{ children: React.ReactNode; style?: React.CSSProperties }> = ({ children, style }) => (
  <div
    style={{
      background: eva.white,
      borderRadius: 40,
      padding: "34px 40px",
      boxShadow: "0 30px 70px rgba(35,34,99,.16)",
      color: eva.navy,
      ...style,
    }}
  >
    {children}
  </div>
);

export const Check: React.FC<{ size?: number; color?: string }> = ({ size = 44, color = eva.green }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
    <circle cx="12" cy="12" r="11" fill={color} />
    <path d="M7 12.5l3.2 3.2L17 9" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

/** Arrow as geometry, not a text glyph: a "→" character sits on its baseline and
 *  drifts low inside a circle, which is visible once rendered at 1080p. */
export const Arrow: React.FC<{ size?: number; color?: string }> = ({ size = 40, color = "#fff" }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" style={{ display: "block" }}>
    <path d="M4 12h15" stroke={color} strokeWidth="2.4" strokeLinecap="round" />
    <path d="M13 6l6 6-6 6" stroke={color} strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

export const Cta: React.FC<{ children: React.ReactNode; white?: boolean }> = ({ children, white }) => (
  <span
    style={{
      display: "inline-flex",
      alignItems: "center",
      gap: 18,
      background: white ? eva.white : eva.green,
      color: white ? eva.greenDark : eva.white,
      fontWeight: 700,
      fontSize: 46,
      padding: "30px 54px",
      borderRadius: 999,
    }}
  >
    {children}
    <Arrow size={44} color={white ? eva.greenDark : eva.white} />
  </span>
);

/** Full-bleed photo with a subtle slow zoom (Ken Burns). */
export const PhotoZoom: React.FC<{ src: string; from?: number; to?: number; style?: React.CSSProperties }> = ({
  src,
  from = 1.05,
  to = 1.16,
  style,
}) => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  const scale = interpolate(frame, [0, durationInFrames], [from, to], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  return (
    <AbsoluteFill style={{ overflow: "hidden", ...style }}>
      <Img src={staticFile(src)} style={{ width: "100%", height: "100%", objectFit: "cover", transform: `scale(${scale})` }} />
    </AbsoluteFill>
  );
};
