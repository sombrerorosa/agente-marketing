import { Interactive } from "remotion";
import { body, colors, display } from "./fonts";
import { Underline, Word } from "./Word";

const headline: React.CSSProperties = {
  fontFamily: display,
  fontWeight: 800,
  fontSize: 150,
  lineHeight: 1,
  letterSpacing: -4,
};

const support: React.CSSProperties = {
  fontFamily: body,
  fontWeight: 500,
  fontSize: 52,
  lineHeight: 1.25,
};

// Fills the scene and centers its lines vertically, inside the safe area.
const frame: React.CSSProperties = {
  position: "absolute",
  inset: 0,
  display: "flex",
  flexDirection: "column",
  justifyContent: "center",
  padding: "0 90px",
};

const IntroInner = () => (
  <div style={frame}>
    <Word delay={0.2} style={{ ...support, color: colors.pink, marginBottom: 24 }}>
      Reel de prueba
    </Word>
    <Word delay={0.4} style={{ ...headline, color: colors.cream, fontSize: 165 }}>
      Sombrero
    </Word>
    <Word delay={0.55} style={{ ...headline, color: colors.pink, fontSize: 165 }}>
      Rosa
    </Word>
    <div style={{ marginTop: 36 }}>
      <Underline delay={1.1} width={520} color={colors.cream} />
    </div>
  </div>
);

export const Intro = Interactive.create({
  Component: IntroInner,
  layout: "absolute-fill",
  schema: { ...Interactive.backgroundSchema },
});

const MadeWithCodeInner = () => (
  <div style={frame}>
    <Word delay={0.15} style={{ ...headline, color: colors.ink }}>
      Un reel
    </Word>
    <Word delay={0.4} style={{ ...headline, color: colors.ink }}>
      hecho
    </Word>
    <Word delay={0.65} style={{ ...headline, color: colors.ink }}>
      con código.
    </Word>
    <Word delay={1.2} style={{ ...support, color: colors.ink, marginTop: 40 }}>
      Sin editor de video. Sin plantillas.
    </Word>
  </div>
);

export const MadeWithCode = Interactive.create({
  Component: MadeWithCodeInner,
  layout: "absolute-fill",
  schema: { ...Interactive.backgroundSchema },
});

const HowInner = () => (
  <div style={frame}>
    <Word delay={0.15} style={{ ...support, color: colors.pink }}>
      1 · Claude
    </Word>
    <Word delay={0.3} style={{ ...headline, color: colors.cream, fontSize: 120, marginBottom: 60 }}>
      escribe la escena.
    </Word>
    <Word delay={0.9} style={{ ...support, color: colors.pink }}>
      2 · Remotion
    </Word>
    <Word delay={1.05} style={{ ...headline, color: colors.cream, fontSize: 120 }}>
      la convierte en video.
    </Word>
  </div>
);

export const How = Interactive.create({
  Component: HowInner,
  layout: "absolute-fill",
  schema: { ...Interactive.backgroundSchema },
});

const OutroInner = () => (
  <div style={frame}>
    <Word delay={0.15} style={{ ...headline, color: colors.ink }}>
      Tu próximo
    </Word>
    <Word delay={0.35} style={{ ...headline, color: colors.ink }}>
      reel,
    </Word>
    <Word delay={0.6} style={{ ...headline, color: colors.ink }}>
      en minutos.
    </Word>
    <div style={{ marginTop: 40 }}>
      <Underline delay={1.1} width={560} color={colors.cream} />
    </div>
  </div>
);

export const Outro = Interactive.create({
  Component: OutroInner,
  layout: "absolute-fill",
  schema: { ...Interactive.backgroundSchema },
});
