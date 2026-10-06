import React from "react";
import { AbsoluteFill, Img, interpolate, staticFile, useCurrentFrame } from "remotion";
import { eva } from "../theme";
import { Backdrop, Cta, Headline, Logo, Pop, Reveal } from "../ui";

/**
 * 29–34.8s · Voice-over: "Dermatología, ginecología, pediatría y muchas más,
 * incluidas en tu suscripción."
 *
 * The three specialties are the ones the business says matter most; dental is
 * deliberately absent because it is not part of the subscription. Each card
 * appears on its word — delays measured from the voice file with ffmpeg
 * silencedetect (scene starts at 870, the line at 880):
 *   dermatología 0.00s · ginecología 0.95s · pediatría 2.15s
 *   "y muchas más" 3.18s · "incluidas en tu suscripción" 4.34s
 */
const CARDS = [
  { label: "Dermatología", photo: "img/dermatologa-consulta.jpg", delay: 10 },
  { label: "Ginecología", photo: "img/ginecologia-consulta.png", delay: 39 },
  { label: "Pediatría", photo: "img/madre-bebe-noche.jpg", delay: 75 },
];

const ROW_A = ["Medicina general", "Traumatología", "Nutrición", "Cardiología", "Alergología"];
const ROW_B = ["Fisioterapia", "Oftalmología", "Endocrino", "Urología", "Otorrino"];

const Chip: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <span
    style={{
      fontSize: 36,
      fontWeight: 700,
      color: eva.white,
      background: "rgba(255,255,255,.1)",
      border: "2px solid rgba(255,255,255,.18)",
      padding: "18px 32px",
      borderRadius: 999,
      whiteSpace: "nowrap",
    }}
  >
    {children}
  </span>
);

/** Rows drift steadily; the list is long enough that no wrap point is on screen. */
const Marquee: React.FC<{ items: string[]; speed: number; start: number }> = ({ items, speed, start }) => {
  const frame = useCurrentFrame();
  return (
    <div style={{ display: "flex", gap: 18, width: "max-content", transform: `translateX(${start + frame * speed}px)` }}>
      {[...items, ...items].map((t, i) => (
        <Chip key={`${t}-${i}`}>{t}</Chip>
      ))}
    </div>
  );
};

export const Especialidades: React.FC = () => {
  const frame = useCurrentFrame();
  const chipsIn = interpolate(frame, [111, 130], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });

  return (
    <AbsoluteFill>
      <Backdrop tone="navy" />
      <AbsoluteFill style={{ padding: "80px 0" }}>
        <div style={{ padding: "0 80px" }}>
          <Logo white height={70} />
          <div style={{ marginTop: 34 }}>
            <Headline white size={112}>
              <Reveal delay={2}>Las especialidades</Reveal>
              <Reveal delay={8}>
                <span style={{ color: eva.greenLight }}>que más se usan.</span>
              </Reveal>
            </Headline>
          </div>

          <div style={{ marginTop: 40, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 22 }}>
            {CARDS.map((c) => {
              const float = Math.sin((frame - c.delay) / 40) * 4;
              return (
                <Pop key={c.label} delay={c.delay}>
                  <div
                    style={{
                      borderRadius: 34,
                      overflow: "hidden",
                      background: "rgba(255,255,255,.08)",
                      transform: `translateY(${float}px)`,
                    }}
                  >
                    <Img
                      src={staticFile(c.photo)}
                      style={{ width: "100%", height: 258, objectFit: "cover", display: "block" }}
                    />
                    <div style={{ padding: "20px 26px", fontSize: 38, fontWeight: 700, color: eva.white }}>{c.label}</div>
                  </div>
                </Pop>
              );
            })}

            {/* the catalogue does not stop at three */}
            <Pop delay={105}>
              <div
                style={{
                  borderRadius: 34,
                  height: 334,
                  background: "rgba(95,208,138,.14)",
                  border: `3px solid ${eva.greenLight}55`,
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 10,
                  color: eva.white,
                  textAlign: "center",
                  padding: 20,
                }}
              >
                <Img src={staticFile("img/hoja-blanca.svg")} style={{ height: 96, opacity: 0.85 }} />
                <div style={{ fontSize: 40, fontWeight: 700 }}>y muchas más</div>
              </div>
            </Pop>
          </div>
        </div>

        <div style={{ marginTop: 28, display: "flex", flexDirection: "column", gap: 16, overflow: "hidden", opacity: chipsIn }}>
          <Marquee items={ROW_A} speed={-2.2} start={0} />
          <Marquee items={ROW_B} speed={1.9} start={-620} />
        </div>

        {/* lands on "incluidas en tu suscripción" — only the specialties shown are covered,
            so the wording stays specific and points to the app for the rest */}
        <div style={{ padding: "0 80px", marginTop: 34 }}>
          <Pop delay={140}>
            <Cta>Incluidas en tu suscripción</Cta>
          </Pop>
          <div
            style={{
              marginTop: 18,
              fontSize: 28,
              color: "rgba(255,255,255,.62)",
              opacity: interpolate(frame, [146, 160], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }),
            }}
          >
            Otros servicios, con precio cerrado en la app.
          </div>
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
