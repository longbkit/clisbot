import type { ReactNode } from "react";
import { Text, View } from "react-native";
import { Field, FormTextInput } from "@/components/ui/form-field";
import { Switch } from "@/components/ui/switch";
import { settingsStyles } from "@/styles/settings";
import type { ChannelRouteBehavior } from "../channel-configuration";

/** Label left, control right — the one row shape the behavior block is built from. */
export function SettingRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <View style={settingsStyles.formRow}>
      <Text style={[settingsStyles.rowTitle, settingsStyles.formRowContent]}>{label}</Text>
      <View style={settingsStyles.formRowControls}>{children}</View>
    </View>
  );
}

export function RouteBehaviorSwitch({
  label,
  value,
  onChange,
  disabled,
}: {
  label: string;
  value: boolean;
  onChange(value: boolean): void;
  disabled: boolean;
}) {
  return (
    <SettingRow label={label}>
      <Switch
        value={value}
        onValueChange={onChange}
        disabled={disabled}
        accessibilityLabel={label}
      />
    </SettingRow>
  );
}

/**
 * Follow-up policy for a mention-gated group Route. The caller renders it only
 * when the Route is not a DM and "Require a mention" is on.
 */
export function RouteFollowUpFields({
  behavior,
  followUpTtlDraft,
  followUpTtlError,
  pending,
  changeFollowUpAuto,
  changeFollowUpTtlMinutes,
}: {
  behavior: ChannelRouteBehavior;
  followUpTtlDraft: string;
  followUpTtlError: string | null;
  pending: boolean;
  changeFollowUpAuto(value: boolean): void;
  changeFollowUpTtlMinutes(value: string): void;
}) {
  const auto = behavior.followUpMode === "auto";
  return (
    <>
      <RouteBehaviorSwitch
        label="Continue without a mention"
        value={auto}
        onChange={changeFollowUpAuto}
        disabled={pending}
      />
      {auto ? (
        <Field
          label="Minutes without a mention"
          hint="After the app's last turn, messages here continue without a mention for this many minutes. After that, a new mention is needed."
          error={followUpTtlError}
        >
          <FormTextInput
            initialValue={followUpTtlDraft}
            onChangeText={changeFollowUpTtlMinutes}
            keyboardType="number-pad"
            accessibilityLabel="Minutes without a mention"
            editable={!pending}
          />
        </Field>
      ) : null}
    </>
  );
}
