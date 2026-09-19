import { ArrowLeft } from "lucide-react-native";
import { View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { Button } from "@/components/ui/button";

/**
 * The way back from a detail page: "← Where you came from", first on the page,
 * above its title. One shape for every Hub detail, instead of a boxed
 * "Back to …" button among the page's own actions.
 */
export function BackLink({
  to,
  onPress,
  disabled = false,
}: {
  /** The page it returns to, as its title reads ("People", "Connections"). */
  to: string;
  onPress(): void;
  disabled?: boolean;
}) {
  return (
    <View style={styles.row}>
      <Button
        size="sm"
        variant="ghost"
        leftIcon={ArrowLeft}
        disabled={disabled}
        onPress={onPress}
        accessibilityLabel={`Back to ${to}`}
      >
        {to}
      </Button>
    </View>
  );
}

const styles = StyleSheet.create({ row: { alignItems: "flex-start" } });
