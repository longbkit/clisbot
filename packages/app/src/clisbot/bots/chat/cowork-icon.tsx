import type { LucideProps } from "lucide-react-native";
import Svg, { Path } from "react-native-svg";

/** Project folder and agent face share one outline, matching the header icon set. */
export function CoworkIcon({
  size = 20,
  color = "currentColor",
  strokeWidth = 1.7,
  ...props
}: LucideProps) {
  return (
    <Svg
      {...props}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <Path d="M20 20H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2Z" />
      <Path d="M9 11.5v2m6-2v2M9 16q3 3 6 0" />
    </Svg>
  );
}
