import React from "react";
import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { eva } from "../theme";
import { Backdrop, Card, Check, Headline, Logo, Pop, Reveal, Rise } from "../ui";

/**
 * 10.2–17.6s · "Su asistente con IA busca los mejores médicos cerca de ti,
 * compara huecos y reserva por ti."  The agent scans clinics, compares slots
 * and books — the user does nothing.
 */
const DOCTORS = [
  { name: "Dra. Marta Ruiz", spec: "Dermatología", dist: "1,2 km", slot: "Hoy 18:30", score: 4.9 },
  { name: "Dr. Iván Soler", spec: "Dermatología", dist: "2,8 km", slot: "Mañana 9:15", score: 4.7 },
  { name: "Clínica Aurora", spec: "Dermatología", dist: "3,4 km", slot: "Jueves 11:00", score: 4.6 },
];

export const IaBusca: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const scan = interpolate(frame, [0, 60], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const scanned = Math.round(interpolate(frame, [6, 62], [0, 128], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }));
  const pick = spring({ frame: frame - 150, fps, config: { damping: 14, stiffness: 150, mass: 0.6 } });
  const booking = spring({ frame: frame - 176, fps, config: { damping: 15, stiffness: 140, mass: 0.7 } });

  return (
    <AbsoluteFill>
      <Backdrop tone="navy" />
      <AbsoluteFill style={{ padding: 80 }}>
        <Rise delay={2} distance={14}>
          <Logo white height={70} />
        </Rise>

        <div style={{ marginTop: 40 }}>
          <Headline white size={112}>
            <Reveal delay={4}>Eva busca,</Reveal>
            <Reveal delay={10}>
              compara y <span style={{ color: eva.greenLight }}>reserva.</span>
            </Reveal>
          </Headline>
        </div>

        {/* scanning bar */}
        <div style={{ marginTop: 44 }}>
          <div style={{ color: "rgba(255,255,255,.78)", fontSize: 34, marginBottom: 14 }}>
            Buscando médicos cerca de ti · <b style={{ color: eva.greenLight }}>{scanned}</b> consultas revisadas
          </div>
          <div style={{ height: 14, borderRadius: 999, background: "rgba(255,255,255,.12)", overflow: "hidden" }}>
            <div style={{ width: `${scan * 100}%`, height: "100%", background: eva.greenLight, borderRadius: 999 }} />
          </div>
        </div>

        <div style={{ marginTop: 40, display: "flex", flexDirection: "column", gap: 22 }}>
          {DOCTORS.map((d, i) => {
            const delay = 70 + i * 18;
            const isPick = i === 0;
            const lift = isPick ? pick : 0;
            const dim = isPick ? 1 : 1 - pick * 0.55;
            return (
              <Pop key={d.name} delay={delay}>
                <Card
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 24,
                    opacity: dim,
                    transform: `scale(${1 + lift * 0.03})`,
                    border: `4px solid ${isPick && pick > 0.3 ? eva.green : "transparent"}`,
                  }}
                >
                  <div
                    style={{
                      width: 78,
                      height: 78,
                      borderRadius: 999,
                      background: eva.mint,
                      color: eva.greenDark,
                      fontSize: 34,
                      fontWeight: 700,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    {d.name.split(" ")[1]?.[0] ?? "E"}
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 40, fontWeight: 700 }}>{d.name}</div>
                    <div style={{ fontSize: 28, color: eva.ink3 }}>
                      {d.spec} · {d.dist} · ★ {d.score.toString().replace(".", ",")}
                    </div>
                  </div>
                  <div
                    style={{
                      fontSize: 30,
                      fontWeight: 700,
                      color: isPick && pick > 0.3 ? eva.white : eva.greenDark,
                      background: isPick && pick > 0.3 ? eva.green : eva.mint,
                      padding: "16px 24px",
                      borderRadius: 999,
                      whiteSpace: "nowrap",
                    }}
                  >
                    {d.slot}
                  </div>
                </Card>
              </Pop>
            );
          })}
        </div>

        <div
          style={{
            marginTop: 40,
            opacity: booking,
            transform: `translateY(${interpolate(booking, [0, 1], [26, 0])}px)`,
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 22,
              background: "rgba(95,208,138,.14)",
              border: `3px solid ${eva.greenLight}66`,
              borderRadius: 32,
              padding: "28px 34px",
              color: eva.white,
              fontSize: 40,
              fontWeight: 700,
            }}
          >
            <Check size={56} color={eva.greenLight} /> Eva reserva por ti. Tú no llamas a nadie.
          </div>
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
