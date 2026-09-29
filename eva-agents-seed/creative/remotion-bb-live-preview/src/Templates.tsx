import {
  AbsoluteFill,
  Easing,
  interpolate,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import type { PreviewTemplateProps } from "./preview-types";

const TEMPLATE_EASE = Easing.bezier(0.16, 1, 0.3, 1);
const TEMPLATE_FONT = "Inter, ui-sans-serif, system-ui, sans-serif";

export const SocialLaunch = ({
  headline,
  subhead,
  accent,
}: PreviewTemplateProps) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const intro = interpolate(frame, [0, 0.8 * fps], [0, 1], {
    easing: TEMPLATE_EASE,
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const rise = interpolate(frame, [0, 0.9 * fps], [72, 0], {
    easing: TEMPLATE_EASE,
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const progress = interpolate(frame, [0, 6 * fps], [0, 1], {
    easing: Easing.bezier(0.4, 0, 0.2, 1),
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  return (
    <AbsoluteFill
      style={{
        backgroundColor: "#f4efe7",
        color: "#231c2e",
        fontFamily: TEMPLATE_FONT,
        overflow: "hidden",
      }}
    >
      <div
        style={{
          position: "absolute",
          top: -180,
          right: -160,
          width: 620,
          height: 620,
          borderRadius: "50%",
          backgroundColor: accent,
          opacity: 0.18,
          scale: interpolate(frame, [0, 6 * fps], [0.72, 1.05], {
            easing: TEMPLATE_EASE,
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
            output: "perceptual-scale",
          }),
        }}
      />
      <div
        style={{
          position: "absolute",
          bottom: -260,
          left: -180,
          width: 520,
          height: 520,
          borderRadius: "50%",
          backgroundColor: "#231c2e",
          opacity: 0.08,
        }}
      />

      <div
        style={{
          position: "absolute",
          top: 72,
          left: 70,
          right: 70,
          opacity: intro,
          translate: ["0px ", String(rise), "px"].join(""),
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            color: accent,
            fontSize: 20,
            fontWeight: 700,
            letterSpacing: "0.16em",
            textTransform: "uppercase",
          }}
        >
          <span>Social launch</span>
          <span style={{ color: "rgba(35, 28, 46, 0.46)", fontSize: 16 }}>
            01 / 03
          </span>
        </div>

        <h1
          style={{
            maxWidth: 860,
            margin: "130px 0 0",
            fontSize: 106,
            lineHeight: 0.94,
            letterSpacing: "-0.07em",
            fontWeight: 750,
          }}
        >
          {headline}
        </h1>
        <p
          style={{
            maxWidth: 720,
            margin: "36px 0 0",
            color: "rgba(35, 28, 46, 0.66)",
            fontSize: 31,
            lineHeight: 1.25,
          }}
        >
          {subhead}
        </p>
      </div>

      <div
        style={{
          position: "absolute",
          right: 70,
          bottom: 122,
          width: 244,
          height: 244,
          border: "2px solid " + accent,
          borderRadius: "50%",
          opacity: interpolate(frame, [1.1 * fps, 2.1 * fps], [0, 0.9], {
            easing: TEMPLATE_EASE,
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
          }),
          rotate: [
            String(
              interpolate(frame, [0, 6 * fps], [-24, 336], {
                easing: Easing.linear,
                extrapolateLeft: "clamp",
                extrapolateRight: "clamp",
              }),
            ),
            "deg",
          ].join(""),
        }}
      >
        <div
          style={{
            position: "absolute",
            top: -8,
            left: "50%",
            width: 16,
            height: 16,
            borderRadius: "50%",
            backgroundColor: accent,
            translate: "-50% 0px",
          }}
        />
      </div>

      <div
        style={{
          position: "absolute",
          left: 70,
          right: 70,
          bottom: 68,
          height: 5,
          overflow: "hidden",
          backgroundColor: "rgba(35, 28, 46, 0.14)",
        }}
      >
        <div
          style={{
            width: "100%",
            height: "100%",
            backgroundColor: accent,
            scale: [String(progress), " 1"].join(""),
            transformOrigin: "left center",
          }}
        />
      </div>
    </AbsoluteFill>
  );
};

export const QuoteCard = ({
  headline,
  subhead,
  accent,
}: PreviewTemplateProps) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const intro = interpolate(frame, [0, 0.75 * fps], [0, 1], {
    easing: TEMPLATE_EASE,
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const quoteScale = interpolate(frame, [0, 1.1 * fps], [0.88, 1], {
    easing: TEMPLATE_EASE,
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    output: "perceptual-scale",
  });
  const exit = interpolate(frame, [4.2 * fps, 5 * fps], [1, 0], {
    easing: TEMPLATE_EASE,
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  return (
    <AbsoluteFill
      style={{
        backgroundColor: "#f8f5ef",
        color: "#24211f",
        fontFamily: TEMPLATE_FONT,
        overflow: "hidden",
      }}
    >
      <div
        style={{
          position: "absolute",
          inset: 48,
          border: "1px solid rgba(36, 33, 31, 0.18)",
          opacity: intro,
        }}
      />
      <div
        style={{
          position: "absolute",
          top: 92,
          left: 92,
          width: 94,
          height: 94,
          borderTop: "8px solid " + accent,
          borderLeft: "8px solid " + accent,
          opacity: intro,
        }}
      />

      <div
        style={{
          position: "absolute",
          top: 106,
          left: 112,
          color: accent,
          fontSize: 18,
          fontWeight: 700,
          letterSpacing: "0.2em",
          textTransform: "uppercase",
          opacity: intro,
        }}
      >
        Field note
      </div>

      <div
        style={{
          position: "absolute",
          top: 245,
          left: 112,
          right: 112,
          opacity: intro * exit,
          scale: quoteScale,
          transformOrigin: "left top",
        }}
      >
        <div
          style={{
            color: accent,
            fontSize: 104,
            lineHeight: 0.7,
            fontWeight: 700,
          }}
        >
          “
        </div>
        <h1
          style={{
            maxWidth: 830,
            margin: "30px 0 0",
            fontSize: 78,
            lineHeight: 1.02,
            letterSpacing: "-0.055em",
            fontWeight: 700,
          }}
        >
          {headline}
        </h1>
        <p
          style={{
            maxWidth: 680,
            margin: "38px 0 0",
            color: "rgba(36, 33, 31, 0.62)",
            fontSize: 27,
            lineHeight: 1.35,
          }}
        >
          {subhead}
        </p>
      </div>

      <div
        style={{
          position: "absolute",
          left: 112,
          right: 112,
          bottom: 108,
          display: "flex",
          alignItems: "center",
          gap: 16,
          color: "rgba(36, 33, 31, 0.5)",
          fontSize: 15,
          letterSpacing: "0.12em",
          textTransform: "uppercase",
          opacity: intro,
        }}
      >
        <div style={{ width: 54, height: 2, backgroundColor: accent }} />
        <span>VISUAL STUDY / 03</span>
      </div>
    </AbsoluteFill>
  );
};
