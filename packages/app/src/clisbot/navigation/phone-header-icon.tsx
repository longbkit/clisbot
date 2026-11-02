import type { ComponentType } from "react";
import { withUnistyles } from "react-native-unistyles";
import type { LucideProps } from "lucide-react-native";
import { ICON_STROKE_WIDTH, type Theme } from "@/styles/theme";

/** A phone's header buttons are the thumb's: Telegram-sized icons in 44px targets. */
export const PHONE_HEADER_ICON_SIZE = 24;
export const PHONE_HEADER_TARGET_SIZE = 44;

/** The same icon in every phone header: section headers and the session header's right side. */
export const PhoneHeaderIcon = withUnistyles(
  ({ Icon, color }: { Icon: ComponentType<LucideProps>; color?: string }) => (
    <Icon size={PHONE_HEADER_ICON_SIZE} color={color} strokeWidth={ICON_STROKE_WIDTH} />
  ),
  (theme: Theme) => ({ color: theme.colors.foreground }),
);
