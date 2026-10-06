import { Composition } from "remotion";
import { Ad, AD } from "./Ad";

/**
 * Register one composition per cut. Freeze an approved version by copying it to
 * src/remotion/vN/ (own scenes + ui + audio mix) and registering it here too —
 * see references/versioning.md.
 */
export const RemotionRoot = () => (
  <Composition
    id="Ad"
    component={Ad}
    durationInFrames={AD.durationInFrames}
    fps={AD.fps}
    width={AD.width}
    height={AD.height}
  />
);
