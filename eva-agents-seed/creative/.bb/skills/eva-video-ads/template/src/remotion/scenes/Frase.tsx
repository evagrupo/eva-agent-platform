import React from "react";
import { AbsoluteFill, interpolate, useCurrentFrame } from "remotion";
import { eva } from "../theme";
import { Backdrop, Bubble, Headline, Logo, Phone, Pill, Pop, Reveal, Rise } from "../ui";

/** 4–10.2s · "Con Eva Salud basta una frase. A cualquier hora, los siete días." */
export const Frase: React.FC = () => {
  const frame = useCurrentFrame();
  const typed = "Necesito un dermatólogo cerca de casa";
  const chars = Math.round(interpolate(frame, [44, 88], [0, typed.length], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }));
  const dots = Math.floor(frame / 8) % 4;

  return (
    <AbsoluteFill>
      <Backdrop tone="light" />
      <AbsoluteFill style={{ padding: 80 }}>
        <Rise delay={2} distance={14}>
          <Logo height={70} />
        </Rise>
        <div style={{ marginTop: 40 }}>
          <Rise delay={5}>
            <Pill>Asistente con IA · 24/7</Pill>
          </Rise>
        </div>
        <div style={{ marginTop: 26 }}>
          <Headline size={124}>
            <Reveal delay={8}>Basta con</Reveal>
            <Reveal delay={14}>
              <span style={{ color: eva.green }}>una frase.</span>
            </Reveal>
          </Headline>
        </div>
        <div style={{ marginTop: 34, display: "flex", gap: 16 }}>
          {["Cualquier hora", "7 días", "Sin llamadas"].map((t, i) => (
            <Rise key={t} delay={14 + i * 5} distance={16}>
              <span
                style={{
                  fontSize: 30,
                  fontWeight: 700,
                  color: eva.greenDark,
                  background: eva.mint,
                  padding: "16px 26px",
                  borderRadius: 999,
                  display: "inline-block",
                }}
              >
                {t}
              </span>
            </Rise>
          ))}
        </div>
      </AbsoluteFill>

      <AbsoluteFill style={{ alignItems: "center", justifyContent: "flex-end" }}>
        <Pop delay={16}>
          <Phone style={{ marginBottom: -300 }}>
            {/* app chrome, so the screen reads as the real product instead of an empty sheet */}
            <div
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                right: 0,
                paddingTop: 110,
                paddingBottom: 22,
                display: "flex",
                alignItems: "center",
                gap: 16,
                justifyContent: "center",
                background: eva.white,
                borderBottom: `2px solid ${eva.line}`,
              }}
            >
              <span style={{ width: 16, height: 16, borderRadius: 999, background: eva.green }} />
              <span style={{ fontSize: 30, fontWeight: 700, color: eva.navy }}>Eva · asistente</span>
            </div>
            <div style={{ padding: "210px 36px 36px", display: "flex", flexDirection: "column", gap: 20 }}>
              <Bubble me delay={40}>
                {typed.slice(0, chars)}
                <span style={{ opacity: frame % 20 < 10 ? 1 : 0 }}>|</span>
              </Bubble>
              {frame > 96 ? (
                <Bubble delay={96}>
                  {frame < 118 ? (
                    <span style={{ letterSpacing: 4 }}>{".".repeat(dots || 1)}</span>
                  ) : (
                    <>
                      Voy a buscarte <b style={{ color: eva.green }}>dermatólogos cerca</b> con hueco esta semana.
                    </>
                  )}
                </Bubble>
              ) : null}
            </div>
            <div
              style={{
                position: "absolute",
                left: 28,
                right: 28,
                bottom: 40,
                height: 84,
                borderRadius: 999,
                background: eva.white,
                border: `2px solid ${eva.line}`,
                display: "flex",
                alignItems: "center",
                padding: "0 30px",
                color: eva.ink3,
                fontSize: 28,
              }}
            >
              Escribe a Eva…
            </div>
          </Phone>
        </Pop>
      </AbsoluteFill>

    </AbsoluteFill>
  );
};
