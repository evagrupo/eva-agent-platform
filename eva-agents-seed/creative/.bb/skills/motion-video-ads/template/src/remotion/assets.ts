/** Every static asset the ad uses — all of these are decoded/buffered before the
 *  Player mounts (see src/main.tsx), so nothing pops in mid-scene. */
export const IMAGES = [
  "img/logo.svg",
  "img/logo-white.svg",
  "img/symbol.svg",
  "img/symbol-white.svg",
  "img/hook-1.jpg",
  "img/hook-2.jpg",
  "img/hook-3.jpg",
  "img/hook-4.jpg",
  "img/cat-1.jpg",
  "img/cat-2.jpg",
  "img/cat-3.jpg",
  "img/human.jpg",
  // optional store badges used by the end card — drop them if the ad is not for an app
  "img/badges/app-store.png",
  "img/badges/google-play.png",
];

/** One pre-mixed soundtrack — never a list of separate audio files (see references). */
export const AUDIO = ["audio/mix.mp3"];
