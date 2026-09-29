import { StyleSheet } from "react-native-unistyles";
export const botFormStyles = StyleSheet.create((theme) => ({
  footerMobile: { gap: theme.spacing[2] },
  footerDesktop: { flexDirection: "row-reverse", gap: theme.spacing[2] },
  text: { color: theme.colors.foreground },
}));
