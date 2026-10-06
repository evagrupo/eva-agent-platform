import React from "react";
import { AbsoluteFill, Img, interpolate, spring, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import { brand } from "../theme";
import { Arrow, Backdrop, Headline, Logo, Pop, Reveal } from "../ui";

/** 35.8–40.2s · "Brand name. The slogan." End card: the only
 *  centred layout in the ad, with the store badges under the call to action. */
export const EndCard: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const logo = spring({ frame: frame - 4, fps, config: { damping: 13, stiffness: 130, mass: 0.7 } });
  const glowPulse = 1 + Math.sin(frame / 18) * 0.012;

  return (
    <AbsoluteFill>
      {/* single decorative leaf lives below — the backdrop must not add a second one */}
      <Backdrop tone="green" leaf={false} />
      {/* brand logo stays top-left here too */}
      <AbsoluteFill style={{ padding: 80, alignItems: "flex-start", pointerEvents: "none" }}>
        <div style={{ opacity: logo, transform: `translateY(${interpolate(logo, [0, 1], [-18, 0])}px)` }}>
          <Logo white height={70} />
        </div>
      </AbsoluteFill>

      <AbsoluteFill style={{ padding: 80, alignItems: "center", justifyContent: "center", textAlign: "center" }}>
        <div style={{ marginTop: 52 }}>
          <Headline white size={96}>
            <Reveal delay={20}>Your headline,</Reveal>
            <Reveal delay={27}>on two balanced lines.</Reveal>
          </Headline>
        </div>

        <div style={{ marginTop: 26, fontSize: 44, color: "rgba(255,255,255,.92)", lineHeight: 1.3 }}>
          <Reveal delay={34}>One short supporting line</Reveal>
          <Reveal delay={39}>under the headline.</Reveal>
        </div>

        {/* CTA: white pill, brand-green label, arrow in a filled circle */}
        <Pop delay={52} style={{ marginTop: 64 }}>
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 26,
              background: brand.white,
              color: brand.primaryDark,
              fontWeight: 700,
              fontSize: 52,
              padding: "22px 22px 22px 56px",
              borderRadius: 999,
              transform: `scale(${glowPulse})`,
            }}
          >
            Download the app
            <span
              style={{
                width: 76,
                height: 76,
                borderRadius: 999,
                background: brand.primary,
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                flexShrink: 0,
              }}
            >
              <Arrow size={42} />
            </span>
          </span>
        </Pop>

        <Pop delay={66} style={{ marginTop: 34 }}>
          <div style={{ display: "flex", gap: 20, justifyContent: "center" }}>
            {[
              { icon: "img/badges/app-store.png", label: "App Store" },
              { icon: "img/badges/google-play.png", label: "Google Play" },
            ].map((b) => (
              <span
                key={b.label}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 16,
                  background: brand.white,
                  color: brand.dark,
                  borderRadius: 24,
                  padding: "16px 28px 16px 20px",
                  fontSize: 32,
                  fontWeight: 700,
                }}
              >
                <Img src={staticFile(b.icon)} style={{ height: 54, width: 54, objectFit: "contain" }} />
                {b.label}
              </span>
            ))}
          </div>
        </Pop>

        <Img
          src={staticFile("img/symbol-white.svg")}
          style={{ position: "absolute", right: -190, bottom: -140, height: 1080, opacity: 0.1 }}
        />
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
