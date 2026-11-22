import { loadFont } from "@remotion/fonts";
import { staticFile } from "remotion";

// Fonts ship in public/fonts so renders never depend on Google Fonts being
// reachable. Both are SIL Open Font License.
export const display = "Bricolage Grotesque";
export const body = "Inter";

loadFont({
  family: display,
  url: staticFile("fonts/Bricolage-800.woff2"),
  weight: "800",
});

loadFont({
  family: body,
  url: staticFile("fonts/Inter-500.woff2"),
  weight: "500",
});

export const colors = {
  ink: "#141014",
  pink: "#FF5C9D",
  cream: "#FFF4EC",
};
