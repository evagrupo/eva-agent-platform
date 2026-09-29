import {
  AbsoluteFill,
  Easing,
  interpolate,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import type { PreviewTemplateProps } from "./preview-types";

export const COMPOSITION_ID = "BBLivePreview";

export type BBLivePreviewProps = PreviewTemplateProps;

export const DEFAULT_BB_LIVE_PREVIEW_PROPS: BBLivePreviewProps = {
  headline: "Make it move.",
  subhead: "A living canvas for ideas in motion.",
  accent: "#6ee7f2",
};

const clampEase = Easing.bezier(0.16, 1, 0.3, 1);

export const BBLivePreview = ({
  headline,
  subhead,
  accent,
}: BBLivePreviewProps) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  return (
    <AbsoluteFill
      style={{
        backgroundColor: "#0b1020",
        color: "#f7f8fb",
        fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif",
        overflow: "hidden",
      }}
    >
      <AbsoluteFill
        style={{
          backgroundImage:
            "linear-gradient(rgba(255,255,255,0.055) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.055) 1px, transparent 1px)",
          backgroundSize: "64px 64px",
          opacity: 0.52,
        }}
      />

      <div
        style={{
          position: "absolute",
          width: 530,
          height: 530,
          borderRadius: "50%",
          background:
            "radial-gradient(circle, " +
            accent +
            " 0%, rgba(110, 231, 242, 0.12) 42%, transparent 72%)",
          filter: "blur(3px)",
          opacity: interpolate(frame, [0, 1.2 * fps], [0, 0.82], {
            easing: clampEase,
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
          }),
          translate: [
            String(
              interpolate(frame, [0, 4 * fps, 8 * fps], [-210, 250, 720], {
                easing: [clampEase, Easing.bezier(0.7, 0, 0.84, 0)],
                extrapolateLeft: "clamp",
                extrapolateRight: "clamp",
              }),
            ),
            "px ",
            String(
              interpolate(frame, [0, 4 * fps, 8 * fps], [520, -90, 470], {
                easing: [clampEase, Easing.bezier(0.7, 0, 0.84, 0)],
                extrapolateLeft: "clamp",
                extrapolateRight: "clamp",
              }),
            ),
            "px",
          ].join(""),
        }}
      />

      <div
        style={{
          position: "absolute",
          top: 78,
          left: 82,
          right: 82,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          opacity: interpolate(frame, [0, 0.8 * fps], [0, 1], {
            easing: clampEase,
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
          }),
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
          <div
            style={{
              width: 28,
              height: 28,
              backgroundColor: accent,
              rotate: [
                String(
                  interpolate(frame, [0, 8 * fps], [-22, 338], {
                    easing: clampEase,
                    extrapolateLeft: "clamp",
                    extrapolateRight: "clamp",
                  }),
                ),
                "deg",
              ].join(""),
              scale: interpolate(frame, [0, 0.8 * fps], [0.4, 1], {
                easing: clampEase,
                extrapolateLeft: "clamp",
                extrapolateRight: "clamp",
                output: "perceptual-scale",
              }),
            }}
          />
          <span
            style={{
              fontSize: 18,
              fontWeight: 700,
              letterSpacing: "0.18em",
            }}
          >
            MOTION STUDY
          </span>
        </div>
        <span
          style={{
            color: "rgba(247, 248, 251, 0.62)",
            fontSize: 16,
            letterSpacing: "0.14em",
            textTransform: "uppercase",
          }}
        >
          VISUAL STUDY
        </span>
      </div>

      <div
        style={{
          position: "absolute",
          top: 220,
          left: 82,
          right: 82,
          opacity: interpolate(frame, [0.35 * fps, 1.8 * fps], [0, 1], {
            easing: clampEase,
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
          }),
          translate: [
            "0px ",
            String(
              interpolate(frame, [0.35 * fps, 1.8 * fps], [48, 0], {
                easing: clampEase,
                extrapolateLeft: "clamp",
                extrapolateRight: "clamp",
              }),
            ),
            "px",
          ].join(""),
        }}
      >
        <div
          style={{
            color: accent,
            fontSize: 18,
            fontWeight: 700,
            letterSpacing: "0.22em",
            textTransform: "uppercase",
          }}
        >
          A quiet rhythm of light and type.
        </div>
        <h1
          style={{
            maxWidth: 930,
            margin: "22px 0 0",
            fontSize: 92,
            lineHeight: 0.98,
            letterSpacing: "-0.055em",
            fontWeight: 700,
          }}
        >
          {headline}
        </h1>
        <p
          style={{
            maxWidth: 650,
            margin: "30px 0 0",
            color: "rgba(247, 248, 251, 0.68)",
            fontSize: 26,
            lineHeight: 1.35,
          }}
        >
          {subhead}
        </p>
      </div>

      <div
        style={{
          position: "absolute",
          right: 82,
          bottom: 88,
          width: 250,
          height: 250,
          border: "1px solid " + accent,
          borderRadius: "50%",
          opacity: interpolate(frame, [2.2 * fps, 3.4 * fps], [0, 0.72], {
            easing: clampEase,
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
          }),
          rotate: [
            String(
              interpolate(frame, [0, 8 * fps], [-18, 342], {
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
            top: -6,
            left: "50%",
            width: 12,
            height: 12,
            borderRadius: "50%",
            backgroundColor: accent,
            translate: "-50% 0px",
          }}
        />
        <div
          style={{
            position: "absolute",
            inset: 22,
            border: "1px solid rgba(247, 248, 251, 0.16)",
            borderRadius: "50%",
          }}
        />
      </div>

      <div
        style={{
          position: "absolute",
          right: 82,
          bottom: 62,
          width: 190,
          height: 3,
          overflow: "hidden",
          backgroundColor: "rgba(247, 248, 251, 0.18)",
        }}
      >
        <div
          style={{
            width: "100%",
            height: "100%",
            backgroundColor: accent,
            transformOrigin: "left center",
            scale: [
              String(
                interpolate(frame, [0, 8 * fps], [0, 1], {
                  easing: Easing.bezier(0.4, 0, 0.2, 1),
                  extrapolateLeft: "clamp",
                  extrapolateRight: "clamp",
                }),
              ),
              " 1",
            ].join(""),
          }}
        />
      </div>
    </AbsoluteFill>
  );
};

