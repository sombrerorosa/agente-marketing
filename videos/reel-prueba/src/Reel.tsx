import { linearTiming, TransitionSeries } from "@remotion/transitions";
import { fade } from "@remotion/transitions/fade";
import { slide } from "@remotion/transitions/slide";
import { useVideoConfig } from "remotion";
import { colors } from "./fonts";
import { How, Intro, MadeWithCode, Outro } from "./Scenes";

export const Reel = () => {
  const { fps } = useVideoConfig();

  return (
    <TransitionSeries>
      <TransitionSeries.Sequence name="Intro" durationInFrames={Math.round(3.5 * fps)}>
        <Intro
          style={{ backgroundColor: colors.ink, justifyContent: "center" }}
        />
      </TransitionSeries.Sequence>
      <TransitionSeries.Transition
        presentation={slide({ direction: "from-bottom" })}
        timing={linearTiming({ durationInFrames: Math.round(0.4 * fps) })}
      />
      <TransitionSeries.Sequence name="Hecho con código" durationInFrames={Math.round(3.2 * fps)}>
        <MadeWithCode
          style={{ backgroundColor: colors.pink, justifyContent: "center" }}
        />
      </TransitionSeries.Sequence>
      <TransitionSeries.Transition
        presentation={slide({ direction: "from-right" })}
        timing={linearTiming({ durationInFrames: Math.round(0.4 * fps) })}
      />
      <TransitionSeries.Sequence name="Cómo" durationInFrames={Math.round(3.4 * fps)}>
        <How style={{ backgroundColor: colors.ink, justifyContent: "center" }} />
      </TransitionSeries.Sequence>
      <TransitionSeries.Transition
        presentation={fade()}
        timing={linearTiming({ durationInFrames: Math.round(0.4 * fps) })}
      />
      <TransitionSeries.Sequence name="Cierre" durationInFrames={Math.round(3.5 * fps)}>
        <Outro
          style={{ backgroundColor: colors.pink, justifyContent: "center" }}
        />
      </TransitionSeries.Sequence>
    </TransitionSeries>
  );
};
