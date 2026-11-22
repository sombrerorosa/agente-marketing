import type React from "react";
import { Easing, interpolate, useCurrentFrame, useVideoConfig } from "remotion";

// One line of text that rises into place. `delay` is in seconds from the
// start of its scene, so lines stagger without nesting extra sequences.
export const Word: React.FC<{
  readonly children: React.ReactNode;
  readonly delay: number;
  readonly style: React.CSSProperties;
}> = ({ children, delay, style }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  return (
    <div style={{ overflow: "hidden", paddingBottom: 12 }}>
      <div
        style={{
          ...style,
          translate: interpolate(
            frame,
            [delay * fps, (delay + 0.7) * fps],
            ["0px 110%", "0px 0%"],
            {
              extrapolateLeft: "clamp",
              extrapolateRight: "clamp",
              easing: Easing.bezier(0.16, 1, 0.3, 1),
            },
          ),
          opacity: interpolate(frame, [delay * fps, (delay + 0.3) * fps], [0, 1], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
          }),
        }}
      >
        {children}
      </div>
    </div>
  );
};

// A pink bar that draws from left to right under a headline.
export const Underline: React.FC<{
  readonly delay: number;
  readonly width: number;
  readonly color: string;
}> = ({ delay, width, color }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  return (
    <div
      style={{
        height: 18,
        backgroundColor: color,
        borderRadius: 9,
        width: interpolate(frame, [delay * fps, (delay + 0.8) * fps], [0, width], {
          extrapolateLeft: "clamp",
          extrapolateRight: "clamp",
          easing: Easing.bezier(0.65, 0, 0.35, 1),
        }),
      }}
    />
  );
};
