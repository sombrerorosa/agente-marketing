import { Composition } from "remotion";
import { Reel } from "./Reel";

// 13.6 s of scenes minus three 0.4 s transitions = 12.4 s at 30 fps.
export const RemotionRoot = () => {
  return (
    <Composition
      id="ReelPrueba"
      component={Reel}
      durationInFrames={372}
      fps={30}
      width={1080}
      height={1920}
    />
  );
};
