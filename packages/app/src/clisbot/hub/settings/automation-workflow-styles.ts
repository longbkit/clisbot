import { StyleSheet } from "react-native-unistyles";

export const workflowStyles = StyleSheet.create((theme) => ({
  secondarySettings: { gap: theme.spacing[3], marginBottom: theme.spacing[4] },
  desktopActions: { flexDirection: "row", justifyContent: "flex-end", gap: theme.spacing[3] },
  hidden: { display: "none" },
  sheetContent: { padding: theme.spacing[6], gap: theme.spacing[4] },
  form: { gap: theme.spacing[4] },
}));
