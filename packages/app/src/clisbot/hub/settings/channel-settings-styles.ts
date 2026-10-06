import { StyleSheet } from "react-native-unistyles";

/** Row layout shared by a Connection's header and its Route rows. */
export const channelRowStyles = StyleSheet.create((theme) => ({
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[3],
  },
  stackedRow: {
    flexDirection: "column",
    alignItems: "stretch",
    gap: theme.spacing[3],
  },
}));
