import { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { Player, type PlayerRef } from "@remotion/player";
import { staticFile } from "remotion";
import { Ad, AD } from "./remotion/Ad";
import { IMAGES, AUDIO } from "./remotion/assets";
import { eva } from "./remotion/theme";

/** Decode every image and buffer every audio file before the player appears,
 *  so playback starts clean instead of popping assets in mid-scene. */
const preload = async (onProgress: (done: number, total: number) => void) => {
  const total = IMAGES.length + AUDIO.length + 1;
  let done = 0;
  const tick = () => onProgress(++done, total);

  await Promise.all([
    document.fonts.ready.then(tick),
    ...IMAGES.map(
      (src) =>
        new Promise<void>((resolve) => {
          const img = new Image();
          img.onload = img.onerror = () => {
            tick();
            resolve();
          };
          img.src = staticFile(src);
        }),
    ),
    ...AUDIO.map(
      (src) =>
        new Promise<void>((resolve) => {
          const a = new Audio();
          a.preload = "auto";
          const finish = () => {
            tick();
            resolve();
          };
          a.oncanplaythrough = finish;
          a.onerror = finish;
          a.src = staticFile(src);
          a.load();
          setTimeout(finish, 8000); // never block the preview on one slow file
        }),
    ),
  ]);
};

const App = () => {
  const [ready, setReady] = useState(false);
  const [started, setStarted] = useState(false);
  const [pct, setPct] = useState(0);
  const player = useRef<PlayerRef>(null);

  // Browsers block audio until the user interacts, which made the player log an
  // autoplay error and start silent. So we wait for one click, then play with sound.
  const start = () => {
    setStarted(true);
    player.current?.seekTo(0);
    player.current?.setVolume(1);
    player.current?.play();
  };

  useEffect(() => {
    preload((d, t) => setPct(Math.round((d / t) * 100))).then(() => setReady(true));
  }, []);

  if (!ready) {
    return (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: 22,
          fontFamily: eva.font,
          color: "#fff",
        }}
      >
        <img src={staticFile("img/logo-blanco.svg")} style={{ height: 44, opacity: 0.9 }} />
        <div style={{ width: 240, height: 8, borderRadius: 999, background: "rgba(255,255,255,.15)", overflow: "hidden" }}>
          <div style={{ width: `${pct}%`, height: "100%", background: eva.greenLight, transition: "width .2s" }} />
        </div>
        <div style={{ fontSize: 13, opacity: 0.6 }}>Cargando vídeo… {pct}%</div>
      </div>
    );
  }

  return (
    <div style={{ position: "relative", width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center" }}>
      <Player
        ref={player}
        component={Ad}
        durationInFrames={AD.durationInFrames}
        fps={AD.fps}
        compositionWidth={AD.width}
        compositionHeight={AD.height}
        style={{ height: "100%", aspectRatio: `${AD.width} / ${AD.height}` }}
        controls
        loop
        clickToPlay={false}
        acknowledgeRemotionLicense
      />
      {started ? null : (
        <button
          onClick={start}
          style={{
            position: "absolute",
            inset: 0,
            margin: "auto",
            width: 260,
            height: 64,
            border: 0,
            borderRadius: 999,
            background: eva.green,
            color: "#fff",
            fontFamily: eva.font,
            fontSize: 17,
            fontWeight: 700,
            cursor: "pointer",
            boxShadow: "0 18px 40px rgba(0,0,0,.45)",
          }}
        >
          ▶  Reproducir con sonido
        </button>
      )}
    </div>
  );
};

createRoot(document.getElementById("root")!).render(<App />);
