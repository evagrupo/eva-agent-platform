import React from "react";
import { AbsoluteFill, Img, staticFile } from "remotion";
import { eva } from "../theme";
import { Headline, Logo, PhotoZoom, Pop, Reveal } from "../ui";

/** 32.8–35.8s · "Para ti y para los tuyos." */
export const Familia: React.FC = () => (
  // solid brand base behind the photo so the cut never flashes white while the
  // image paints
  <AbsoluteFill style={{ background: eva.greenDark }}>
    <PhotoZoom src="img/abuela-nieta-movil.jpg" from={1.06} to={1.14} />
    <AbsoluteFill
      style={{
        background:
          "linear-gradient(0deg, rgba(0,107,41,.94) 0%, rgba(0,107,41,.6) 40%, rgba(0,107,41,0) 70%), linear-gradient(180deg, rgba(0,0,0,.4) 0%, rgba(0,0,0,0) 20%)",
      }}
    />
    <AbsoluteFill style={{ padding: 80, justifyContent: "space-between" }}>
      <Logo white height={70} />
      <div>
        <Pop delay={4} style={{ marginBottom: 28 }}>
          <Img src={staticFile("img/hoja-blanca.svg")} style={{ height: 110, opacity: 0.9 }} />
        </Pop>
        <Headline white size={126}>
          <Reveal delay={8}>Para ti y para</Reveal>
          <Reveal delay={14}>
            <span style={{ color: "#d9f5e4" }}>los tuyos.</span>
          </Reveal>
        </Headline>
      </div>
    </AbsoluteFill>
  </AbsoluteFill>
);
