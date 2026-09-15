import { ShieldCheck } from "lucide-react-native";
import { withUnistyles } from "react-native-unistyles";
import type { Theme } from "@/styles/theme";
import { MANAGED_ACCESS_HOST_LABEL } from "@/hosts/managed-access";

const ThemedShieldCheck = withUnistyles(ShieldCheck);

const mutedMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });

/**
 * The managed access glyph for Host surfaces without an identity color (Host picker, Host
 * overview). Muted like other secondary metadata: managed access is how a Host is reached, not a
 * status, so it never borrows a status color.
 */
export function ManagedAccessIcon({ size, testID }: { size: number; testID?: string }) {
  return (
    <ThemedShieldCheck
      size={size}
      uniProps={mutedMapping}
      accessibilityLabel={MANAGED_ACCESS_HOST_LABEL}
      {...(testID === undefined ? {} : { testID })}
    />
  );
}
