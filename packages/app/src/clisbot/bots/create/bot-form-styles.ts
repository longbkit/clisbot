import { StyleSheet } from "react-native-unistyles";
export const botFormStyles = StyleSheet.create((theme) => ({
  footerMobile: { gap: theme.spacing[2] },
  footerDesktop: { flexDirection: "row-reverse", gap: theme.spacing[2] },
  form: { padding: theme.spacing[4], gap: theme.spacing[3] },
  title: { color: theme.colors.foreground, fontSize: theme.fontSize.lg },
  text: { color: theme.colors.foreground },
  input: {
    color: theme.colors.foreground,
    borderColor: theme.colors.surface2,
    borderWidth: 1,
    borderRadius: 8,
    padding: theme.spacing[3],
  },
  hint: { color: theme.colors.foregroundMuted, fontSize: theme.fontSize.sm },
  summary: { color: theme.colors.foreground, fontSize: theme.fontSize.base },
  configuration: {
    padding: theme.spacing[3],
    gap: theme.spacing[1],
    borderRadius: theme.borderRadius.lg,
    backgroundColor: theme.colors.surface1,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  configurationHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  profileList: { gap: theme.spacing[2] },
  row: { flexDirection: "row", flexWrap: "wrap", gap: theme.spacing[2] },
}));
