import React from "react";
import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { eva } from "../theme";
import { Backdrop, Card, Check, Headline, Logo, Pop, Reveal, Sub } from "../ui";

/**
 * 25–29s · "¿No te encaja? Cambia la cita o cancélala con un toque."
 *
 * Everything enters in the order the voice says it (line starts at frame 12 of
 * this scene; word boundaries measured with ffmpeg silencedetect):
 *   "¿No te encaja?"        0.00s → headline + the booked appointment
 *   "Cambia la cita"        1.40s → "Cambiar hora" button, then the tap
 *   "o cancélala…"          2.45s → "Cancelar" button
 *   then the time swaps and the change is confirmed.
 */
export const Cambiar: React.FC = () => {
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
            <Reveal delay={8}>¿No te encaja?</Reveal>
            <Reveal delay={15}>
              <span style={{ color: eva.green }}>Cámbiala o cancélala.</span>
            </Reveal>
          </Headline>
        </div>
        <div style={{ marginTop: 22 }}>
          <Reveal delay={22}>
            <Sub>Tú mandas: la cita se cambia o se cancela en un toque.</Sub>
          </Reveal>
        </div>

        <Pop delay={26} style={{ marginTop: 56 }}>
          <Card>
            <div style={{ fontSize: 34, color: eva.ink3, marginBottom: 10 }}>Dermatología · Dra. Marta Ruiz</div>
            <div style={{ display: "flex", alignItems: "baseline", gap: 20 }}>
              <span
                style={{
                  fontSize: 62,
                  fontWeight: 700,
                  color: swap > 0.5 ? eva.ink3 : eva.navy,
                  textDecoration: swap > 0.5 ? "line-through" : "none",
                }}
              >
                Hoy 18:30
              </span>
              {swap > 0.15 ? (
                <span style={{ fontSize: 62, fontWeight: 700, color: eva.green, opacity: swap }}>
                  → Mañana 9:15
                </span>
              ) : null}
            </div>
          </Card>
        </Pop>

        <div style={{ display: "flex", gap: 22, marginTop: 34 }}>
          {/* "Cambia la cita" — appears on the word, then the tap lands here */}
          <Pop delay={54} style={{ position: "relative" }}>
            <div
              style={{
                background: eva.green,
                color: eva.white,
                fontSize: 42,
                fontWeight: 700,
                padding: "30px 46px",
                borderRadius: 999,
                transform: `scale(${1 - tap * 0.04 + swap * 0.04})`,
              }}
            >
              Cambiar hora
            </div>
            <div
              style={{
                position: "absolute",
                inset: 0,
                borderRadius: 999,
                border: `4px solid ${eva.green}`,
                opacity: (1 - ripple) * 0.7,
                transform: `scale(${1 + ripple * 0.35})`,
                pointerEvents: "none",
              }}
            />
          </Pop>

          {/* "o cancélala" — the second option enters on its own words */}
          <Pop delay={85}>
            <div
              style={{
                background: eva.white,
                color: eva.navy,
                border: `3px solid ${eva.line}`,
                fontSize: 42,
                fontWeight: 700,
                padding: "30px 46px",
                borderRadius: 999,
              }}
            >
              Cancelar
            </div>
          </Pop>
        </div>

        <div style={{ marginTop: 40, opacity: interpolate(swap, [0, 0.4], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }), transform: `translateY(${interpolate(swap, [0, 1], [24, 0])}px)` }}>
          <Card style={{ display: "flex", alignItems: "center", gap: 24 }}>
            <Check size={58} />
            <div>
              <div style={{ fontSize: 42, fontWeight: 700 }}>Cita cambiada</div>
              <div style={{ fontSize: 32, color: eva.ink3 }}>Mañana 9:15 · sin llamar a nadie</div>
            </div>
          </Card>
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
