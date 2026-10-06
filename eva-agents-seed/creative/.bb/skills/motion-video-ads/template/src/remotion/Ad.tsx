import React from "react";
import { AbsoluteFill, Audio, Sequence, staticFile, useCurrentFrame, interpolate } from "remotion";
import { brand } from "./theme";
import { Hook } from "./scenes/Hook";
import { Pitch } from "./scenes/Pitch";
import { Proof } from "./scenes/Proof";
import { Confirm } from "./scenes/Confirm";
import { Control } from "./scenes/Control";
import { Breadth } from "./scenes/Breadth";
import { Human } from "./scenes/Human";
import { EndCard } from "./scenes/EndCard";

export const AD = { fps: 30, width: 1080, height: 1920, durationInFrames: 1328 } as const;

/** Visual scenes (30fps). */
export const SCENES = [
  { from: 0, duration: 288, Component: Hook },
  { from: 288, duration: 180, Component: Pitch },
  { from: 468, duration: 222, Component: Proof },
  { from: 690, duration: 102, Component: Confirm },
  { from: 792, duration: 144, Component: Control },
  { from: 936, duration: 200, Component: Breadth },
  { from: 1136, duration: 66, Component: Human },
  { from: 1202, duration: 126, Component: EndCard },
];

/**
 * Soundtrack: the Player stalled while buffering ~30 separate <Audio> tags, so the
 * voice-over, music and SFX below are pre-mixed into public/audio/mix.mp3 by
 * mix_audio.py and played as ONE track. Edit a timing here, then re-run:
 *   python3 mix_audio.py
 */
const VO = [
  { at: 8, src: "audio/v3/h1.mp3" },        // "[worried] Fiebre… a las tres de la mañana."
  { at: 108, src: "audio/v3/h2.mp3" },      // "[tired] Y tú, llamando a una clínica tras otra…"
  { at: 206, src: "audio/v3/h3.mp3" },      // "[frustrated] ¿En serio pedir cita tiene que ser así?"
  { at: 302, src: "audio/v3/frase.mp3" },
  { at: 480, src: "audio/v3/ia.mp3" },
  { at: 702, src: "audio/v3/notif.mp3" },
  { at: 804, src: "audio/v3/cambiar.mp3" },
  { at: 946, src: "audio/v3/espec.mp3" },
  { at: 1142, src: "audio/v3/familia.mp3" },
  { at: 1220, src: "audio/v3/cierre.mp3" },
];

/** Sound design: UI sounds only — no transition whooshes, they were noisy and
 *  added nothing. One faint dial tone under the first hook beat. */
const SFX = [
  { at: 58, src: "audio/sfx/pop.mp3", volume: 0.24 },       // fever reading
  { at: 112, src: "audio/sfx/ring.mp3", volume: 0.18 },     // dial tone while calling
  { at: 338, src: "audio/sfx/type.mp3", volume: 0.4 },      // typing in the chat
  { at: 404, src: "audio/sfx/pop.mp3", volume: 0.34 },      // Eva replies
  { at: 522, src: "audio/sfx/tap.mp3", volume: 0.36 },      // search starts
  { at: 554, src: "audio/sfx/pop.mp3", volume: 0.28 },      // doctor card 1
  { at: 572, src: "audio/sfx/pop.mp3", volume: 0.28 },      // doctor card 2
  { at: 590, src: "audio/sfx/pop.mp3", volume: 0.28 },      // doctor card 3
  { at: 618, src: "audio/sfx/success.mp3", volume: 0.34 },  // best one picked
  { at: 718, src: "audio/sfx/ping.mp3", volume: 0.5 },      // push notification
  { at: 856, src: "audio/sfx/tap.mp3", volume: 0.4 },       // tap on "Control hora"
  { at: 888, src: "audio/sfx/success.mp3", volume: 0.3 },   // appointment changed
  { at: 946, src: "audio/sfx/pop.mp3", volume: 0.26 },      // dermatología
  { at: 975, src: "audio/sfx/pop.mp3", volume: 0.26 },      // ginecología
  { at: 1011, src: "audio/sfx/pop.mp3", volume: 0.26 },     // pediatría
  { at: 1041, src: "audio/sfx/pop.mp3", volume: 0.26 },     // y muchas más
  { at: 1076, src: "audio/sfx/success.mp3", volume: 0.3 },  // "incluidas en tu suscripción"
  { at: 1258, src: "audio/sfx/success.mp3", volume: 0.3 },  // end card
];

/** Quick brand-green wipe on scene changes. */
const Wipe: React.FC<{ at: number }> = ({ at }) => {
  const frame = useCurrentFrame();
  const local = frame - at;
  if (local < -8 || local > 10) return null;
  const x = interpolate(local, [-8, 0, 10], [-1.1, 0, 1.1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  return <AbsoluteFill style={{ background: brand.primary, transform: `translateX(${x * 100}%) skewX(-6deg)`, opacity: 0.96 }} />;
};

export const Ad: React.FC = () => {
  return (
    <AbsoluteFill style={{ background: brand.white, fontFamily: brand.font }}>
      {SCENES.map(({ from, duration, Component }, i) => (
        <Sequence key={i} from={from} durationInFrames={duration} layout="none">
          <Component />
        </Sequence>
      ))}
      {SCENES.slice(1).map((s, i) => (
        <Wipe key={`w${i}`} at={s.from} />
      ))}

      <Audio src={staticFile("audio/mix.mp3")} />
    </AbsoluteFill>
  );
};
