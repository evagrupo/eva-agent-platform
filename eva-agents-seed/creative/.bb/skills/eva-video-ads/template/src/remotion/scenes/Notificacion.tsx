import React from "react";
import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { eva } from "../theme";
import { Backdrop, Check, Headline, Logo, Phone, Pop, Reveal } from "../ui";

/** 17.6–21.2s · "Tú solo recibes la confirmación en el móvil." Push notification lands. */
export const Notificacion: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const push = spring({ frame: frame - 26, fps, config: { damping: 13, stiffness: 170, mass: 0.6 } });
  const ring = interpolate(frame, [26, 56], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });

  return (
    <AbsoluteFill>
      <Backdrop tone="light" />
      <AbsoluteFill style={{ padding: 80 }}>
        <Logo height={70} />
        <div style={{ marginTop: 36 }}>
          <Headline size={118}>
            <Reveal delay={2}>Y te llega la</Reveal>
            <Reveal delay={8}>
              <span style={{ color: eva.green }}>confirmación.</span>
            </Reveal>
          </Headline>
        </div>
      </AbsoluteFill>

      <AbsoluteFill style={{ alignItems: "center", justifyContent: "flex-end" }}>
        <Pop delay={4}>
          <Phone style={{ marginBottom: -380 }}>
            <AbsoluteFill
              style={{
                background: `linear-gradient(170deg, ${eva.navy} 0%, ${eva.navyDeep} 100%)`,
                alignItems: "center",
                paddingTop: 150,
              }}
            >
              <div style={{ color: "rgba(255,255,255,.8)", fontSize: 88, fontWeight: 700 }}>18:30</div>
              <div style={{ color: "rgba(255,255,255,.45)", fontSize: 28, marginTop: 6 }}>jueves, 12 de marzo</div>

              <div
                style={{
                  marginTop: 60,
                  width: "88%",
                  background: "rgba(255,255,255,.96)",
                  borderRadius: 34,
                  padding: "26px 28px",
                  display: "flex",
                  gap: 20,
                  alignItems: "center",
                  opacity: push,
                  transform: `translateY(${interpolate(push, [0, 1], [-90, 0])}px) scale(${interpolate(push, [0, 1], [0.94, 1])})`,
                  boxShadow: `0 24px 50px rgba(0,0,0,.35), 0 0 0 ${ring * 16}px rgba(0,152,58,${0.18 * (1 - ring)})`,
                }}
              >
                <Check size={56} />
                <div>
                  <div style={{ fontSize: 30, fontWeight: 700, color: eva.navy }}>Cita confirmada</div>
                  <div style={{ fontSize: 26, color: eva.ink3, lineHeight: 1.3 }}>
                    Dra. Marta Ruiz · Dermatología
                    <br />
                    Hoy 18:30 · a 1,2 km de casa
                  </div>
                </div>
              </div>
            </AbsoluteFill>
          </Phone>
        </Pop>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
