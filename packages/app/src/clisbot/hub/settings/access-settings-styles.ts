import { StyleSheet } from "react-native-unistyles";

export const accessSettingsStyles = StyleSheet.create((theme) => ({
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[3],
  },
  form: {
    padding: theme.spacing[4],
    gap: theme.spacing[4],
  },
  // The grant form sits in a sheet, which already pads its body.
  sheetForm: {
    gap: theme.spacing[4],
  },
  switchRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[3],
  },
  configurationList: {
    gap: theme.spacing[3],
  },
  configurationCard: {
    gap: theme.spacing[3],
    borderWidth: theme.borderWidth[1],
    borderColor: theme.colors.border,
    borderRadius: theme.borderRadius.lg,
    padding: theme.spacing[3],
  },
  configurationSummary: {
    flex: 1,
    minWidth: 0,
  },
  configurationHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: theme.spacing[3],
  },
}));
