import { useCallback, useMemo } from "react";
import { Text, View } from "react-native";
import type { BotLaunchDefaults } from "@clisbot/protocol/bots/types";
import type { AgentFeature } from "@clisbot/protocol/agent-types";
import type { FieldControlSize } from "@/components/ui/control-geometry";
import { useFetchQuery } from "@/data/query";
import { useHostRuntimeClient, useHostRuntimeIsConnected } from "@/runtime/host-runtime";
import { useResourcePrincipalScope } from "@/clisbot/bots/data/resource-principal-scope";
import { SelectField } from "@/components/ui/select-field";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { useQuickStartPicker } from "./picker-scope";
import { styles } from "./styles";
export function ProviderFeatureFields({
  serverId,
  cwd,
  config,
  onChange,
  size,
  disabled,
}: {
  serverId: string;
  cwd?: string;
  config: BotLaunchDefaults;
  onChange: (config: BotLaunchDefaults) => void;
  size: FieldControlSize;
  disabled: boolean;
}) {
  const client = useHostRuntimeClient(serverId);
  const online = useHostRuntimeIsConnected(serverId);
  const principal = useResourcePrincipalScope();
  const { featureValues, ...selection } = config;
  const request = { ...selection, cwd: cwd ?? "~" };
  const query = useFetchQuery({
    dataShape: "value",
    queryKey: ["quick-start-features", serverId, principal, request],
    enabled: !!client && online && !!config.provider,
    staleTimeMs: 300000,
    queryFn: async () => {
      const response = await client!.listProviderFeatures(request);
      if (response.error) throw new Error(response.error);
      return response.features ?? [];
    },
  });
  const retry = useCallback(() => {
    void query.refetch();
  }, [query]);
  return (
    <>
      {query.error ? (
        <View>
          <Text style={styles.error}>Could not load agent options</Text>
          <Button variant="ghost" onPress={retry}>
            Try again
          </Button>
        </View>
      ) : null}
      {(query.data ?? []).map((feature) => (
        <FeatureField
          key={feature.id}
          feature={feature}
          values={featureValues ?? EMPTY_VALUES}
          config={config}
          onChange={onChange}
          size={size}
          disabled={disabled}
        />
      ))}
    </>
  );
}
function FeatureField({
  feature,
  values,
  config,
  onChange,
  size,
  disabled,
}: {
  feature: AgentFeature;
  values: Record<string, unknown>;
  config: BotLaunchDefaults;
  onChange: (config: BotLaunchDefaults) => void;
  size: FieldControlSize;
  disabled: boolean;
}) {
  const picker = useQuickStartPicker(`feature:${feature.id}`);
  const change = useCallback(
    (value: string | boolean) =>
      onChange({
        ...config,
        featureValues: { ...values, [feature.id]: value },
      }),
    [onChange, config, values, feature.id],
  );
  const value = values[feature.id] ?? feature.value;
  const options = (feature.type === "select" ? feature.options : []).map((o) => ({
    id: o.id,
    value: o.id,
    label: o.label,
  }));
  const display = useMemo(
    () =>
      typeof value === "string"
        ? { label: options.find((o) => o.id === value)?.label ?? value }
        : null,
    [value, options],
  );
  if (feature.type === "toggle")
    return (
      <View style={styles.row}>
        <Text style={[styles.text, styles.grow]}>{feature.label}</Text>
        <Switch
          value={value === true}
          onValueChange={change}
          disabled={disabled}
          accessibilityLabel={feature.label}
        />
      </View>
    );
  return (
    <SelectField
      {...picker}
      label={feature.label}
      title={feature.label}
      value={typeof value === "string" ? value : null}
      selectedDisplay={display}
      options={options}
      onChange={change}
      placeholder="Default"
      emptyText="No options available"
      size={size}
      disabled={disabled}
    />
  );
}

const EMPTY_VALUES: Record<string, unknown> = {};
