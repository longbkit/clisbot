import { useMemo } from "react";
import { type StyleProp, Text, type TextStyle, View } from "react-native";
import { ProjectIconImage } from "@/components/project-icon-image";
import { deriveIdentityColorName, identityColor, identityTint } from "@/styles/identity-colors";

const FALLBACK_LAYOUT = { alignItems: "center", justifyContent: "center" } as const;

/**
 * Corner radius of the *generated* project icon — the colored square with an initial — as a
 * fraction of the box, so it reads as the same shape at 16pt in the sidebar and 40pt in the edit
 * sheet. Fixed tokens did not give that: the radius scale is coarse at the bottom, so small icons
 * landed on 2pt and looked square while large ones were visibly rounder.
 *
 * This is ours to shape. A **user-uploaded icon is never rounded** — it is someone's mark, and
 * clipping its corners distorts branding we don't own. A square logo stays square, a round one is
 * already round.
 */
const RADIUS_RATIO = 0.25;

export function projectIconRadius(size: number): number {
  return Math.round(size * RADIUS_RATIO);
}

/**
 * A project's icon: its chosen image, or a tinted square carrying its initial in the
 * project's identity color — the same mark as a Bot's face (`BotFace`).
 *
 * Geometry lives here, not at the call site. It used to be five copies of the same
 * width/height/radius/centering block, which is how the radius drifted apart in the first
 * place — pass a `size` and the shape follows.
 */

export function ProjectIconView({
  iconDataUri,
  initial,
  projectViewKey,
  size,
  textStyle,
}: {
  iconDataUri: string | null;
  initial: string;
  projectViewKey: string;
  size: number;
  textStyle: StyleProp<TextStyle>;
}) {
  // The uploaded image is sized but never clipped — see projectIconRadius.
  const box = useMemo(() => ({ width: size, height: size }), [size]);
  const colorName = deriveIdentityColorName(projectViewKey);
  const fallbackStyles = useMemo(
    () => [
      box,
      { borderRadius: projectIconRadius(size) },
      FALLBACK_LAYOUT,
      { backgroundColor: identityTint(colorName) },
    ],
    [box, size, colorName],
  );
  const textStyles = useMemo(
    () => [textStyle, { color: identityColor(colorName), fontWeight: "600" as const }],
    [textStyle, colorName],
  );

  const fallback = useMemo(
    () => (
      <View style={fallbackStyles}>
        <Text style={textStyles}>{initial}</Text>
      </View>
    ),
    [fallbackStyles, initial, textStyles],
  );

  return iconDataUri ? (
    <ProjectIconImage dataUri={iconDataUri} fallback={fallback} style={box} />
  ) : (
    fallback
  );
}
