/**
 * Brand tokens for the ad. Replace every value with the client's real ones —
 * take them from the brand manual or a brand skill, never from a screenshot.
 *
 * Keep the shape: scenes read `brand.primary`, `brand.dark`, etc., so swapping
 * a brand is a one-file change.
 */
export const brand = {
  primary: "#00983a",      // action colour: CTAs, highlights
  primaryDark: "#006b29",  // text/hover version of the primary (must pass 4.5:1 on white)
  primaryLight: "#5fd08a", // highlighted words on dark backgrounds
  dark: "#232263",         // headlines, body text, dark surfaces
  darkDeep: "#14143c",     // photo scrims, deepest background
  accent: "#ab49cc",       // one accent, used sparingly
  soft: "#e6f4eb",         // soft surface for pills and panels
  white: "#ffffff",
  ink2: "#4a4a7d",         // secondary text
  ink3: "#6b6b95",         // muted text
  line: "#e3e3ec",         // borders
  font: '"Noto Sans", system-ui, sans-serif',
} as const;
