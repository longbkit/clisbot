import type { ComponentProps } from "react";
import type { TextStyle } from "react-native";
import { withUnistyles } from "react-native-unistyles";
import { CODE_SURFACE_DATASET } from "@/styles/code-surface";
import { FormTextInput } from "@/components/ui/form-field";

// FormTextInput splits text and chrome styles; supply resolved values, not a style proxy.
function ResolvedYamlInput({
  inputStyle,
  ...props
}: ComponentProps<typeof FormTextInput> & { inputStyle: TextStyle }) {
  return <FormTextInput dataSet={CODE_SURFACE_DATASET} {...props} style={inputStyle} />;
}
export const ConfigurationYamlInput = withUnistyles(ResolvedYamlInput, (theme) => ({
  inputStyle: {
    height: Math.round(theme.fontSize.base * 1.5) * 16 + theme.spacing[6],
    fontFamily: theme.fontFamily.mono,
    lineHeight: Math.round(theme.fontSize.base * 1.5),
    textAlignVertical: "top" as const,
  },
}));
