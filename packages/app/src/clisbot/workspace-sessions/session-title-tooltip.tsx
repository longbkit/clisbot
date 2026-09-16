import { useCallback, useState, type ReactElement, type RefObject } from "react";
import { Text } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { isWeb } from "@/constants/platform";

/**
 * The full title of a session line whose title is cut to one line, on hover.
 *
 * It opens only when the title is actually cut, so a short title does not repeat itself in a
 * bubble. Only the web can tell: the title is a DOM node there and overflows its box. Native has
 * no hover to open it with, so it never opens.
 */
export function SessionTitleTooltip({
  label,
  titleRef,
  children,
}: {
  label: string;
  titleRef: RefObject<Text | null>;
  children: ReactElement;
}): ReactElement {
  const [open, setOpen] = useState(false);
  const handleOpenChange = useCallback(
    (next: boolean) => setOpen(next && isTitleCut(titleRef.current)),
    [titleRef],
  );
  return (
    <Tooltip
      open={open}
      onOpenChange={handleOpenChange}
      delayDuration={300}
      enabledOnDesktop
      enabledOnMobile={false}
    >
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent side="right" align="center" offset={8}>
        <Text style={styles.text}>{label}</Text>
      </TooltipContent>
    </Tooltip>
  );
}

function isTitleCut(title: Text | null): boolean {
  if (!isWeb || title === null) return false;
  const element = title as unknown as HTMLElement;
  return element.scrollWidth > element.clientWidth;
}

const styles = StyleSheet.create((theme) => ({
  text: {
    color: theme.colors.popoverForeground,
    fontSize: theme.fontSize.base,
  },
}));
