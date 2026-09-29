import { Composition } from "remotion";
import "./index.css";
import { COMPOSITION_CATALOG } from "./composition-registry";

export const RemotionRoot = () => {
  return (
    <>
      {COMPOSITION_CATALOG.map((definition) => (
        <Composition
          key={definition.id}
          id={definition.id}
          component={definition.component}
          durationInFrames={definition.durationInFrames}
          fps={definition.fps}
          width={definition.width}
          height={definition.height}
          defaultProps={definition.inputProps}
        />
      ))}
    </>
  );
};
