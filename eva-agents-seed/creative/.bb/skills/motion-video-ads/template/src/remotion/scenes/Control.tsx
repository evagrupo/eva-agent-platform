import React from "react";
import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { brand } from "../theme";
import { Backdrop, Card, Check, Headline, Logo, Pop, Reveal, Sub } from "../ui";

/**
 * 25–29s · "Not convenient? Change it or cancel it in one tap."
 *
 * Everything enters in the order the voice says it (line starts at frame 12 of
 * this scene; word boundaries measured with ffmpeg silencedetect):
 *   "Not convenient?"        0.00s → headline + the booked appointment
 *   "Change it"             1.40s → "Change time" button, then the tap
 *   "o cancélala…"          2.45s → "Cancel" button
 *   then the time swaps and the change is confirmed.
 */
export const Control: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const tap = spring({ frame: frame - 64, fps, config: { damping: 14, stiffness: 180, mass: 0.5 } });
  const swap = spring({ frame: frame - 96, fps, config: { damping: 15, stiffness: 140, mass: 0.7 } });
  const ripple = interpolate(frame, [64, 92], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });

  return (
    <AbsoluteFill>
      <Backdrop tone="light" />
      <AbsoluteFill style={{ padding: 80 }}>
        <Logo height={70} />

        <div style={{ marginTop: 36 }}>
          <Headline size={116}>
            <Reveal delay={8}>Not convenient?</Reveal>
            <Reveal delay={15}>
              <span style={{ color: brand.primary }}>Change or cancel it.</span>
            </Reveal>
          </Headline>
        </div>
        <div style={{ marginTop: 22 }}>
          <Reveal delay={22}>
            <Sub>You stay in control: change or cancel in one tap.</Sub>
          </Reveal>
        </div>

        <Pop delay={26} style={{ marginTop: 56 }}>
          <Card>
            <div style={{ fontSize: 34, color: brand.ink3, marginBottom: 10 }}>Category · Option One</div>
            <div style={{ display: "flex", alignItems: "baseline", gap: 20 }}>
              <span
                style={{
                  fontSize: 62,
                  fontWeight: 700,
                  color: swap > 0.5 ? brand.ink3 : brand.dark,
                  textDecoration: swap > 0.5 ? "line-through" : "none",
                }}
              >
                Today 18:30
              </span>
              {swap > 0.15 ? (
                <span style={{ fontSize: 62, fontWeight: 700, color: brand.primary, opacity: swap }}>
                  → Tomorrow 9:15
                </span>
              ) : null}
            </div>
          </Card>
        </Pop>

        <div style={{ display: "flex", gap: 22, marginTop: 34 }}>
          {/* "Change it" — appears on the word, then the tap lands here */}
          <Pop delay={54} style={{ position: "relative" }}>
            <div
              style={{
                background: brand.primary,
                color: brand.white,
                fontSize: 42,
                fontWeight: 700,
                padding: "30px 46px",
                borderRadius: 999,
                transform: `scale(${1 - tap * 0.04 + swap * 0.04})`,
              }}
            >
              Control hora
            </div>
            <div
              style={{
                position: "absolute",
                inset: 0,
                borderRadius: 999,
                border: `4px solid ${brand.primary}`,
                opacity: (1 - ripple) * 0.7,
                transform: `scale(${1 + ripple * 0.35})`,
                pointerEvents: "none",
              }}
            />
          </Pop>

          {/* "or cancel it" — the second option enters on its own words */}
          <Pop delay={85}>
            <div
              style={{
                background: brand.white,
                color: brand.dark,
                border: `3px solid ${brand.line}`,
                fontSize: 42,
                fontWeight: 700,
                padding: "30px 46px",
                borderRadius: 999,
              }}
            >
              Cancel
            </div>
          </Pop>
        </div>

        <div style={{ marginTop: 40, opacity: interpolate(swap, [0, 0.4], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }), transform: `translateY(${interpolate(swap, [0, 1], [24, 0])}px)` }}>
          <Card style={{ display: "flex", alignItems: "center", gap: 24 }}>
            <Check size={58} />
            <div>
              <div style={{ fontSize: 42, fontWeight: 700 }}>Booking changed</div>
              <div style={{ fontSize: 32, color: brand.ink3 }}>Tomorrow 9:15 · no phone calls</div>
            </div>
          </Card>
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
