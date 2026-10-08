import { useCallback, useMemo, useState } from "react";
import { Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Field, FormTextInput } from "@/components/ui/form-field";
import { SelectField } from "@/components/ui/select-field";
import { Switch } from "@/components/ui/switch";
import { useIsCompactFormFactor } from "@/constants/layout";
import { settingsStyles } from "@/styles/settings";
import { record, type AutomationWorkflowModel } from "../automation-workflow-model";
import { workflowStyles as styles } from "./automation-workflow-styles";

interface ParameterRow {
  key: number;
  name: string;
  definition: Record<string, unknown>;
}
type ChangeRow = (key: number, change: (row: ParameterRow) => ParameterRow) => void;

const PARAMETER_TYPES = ["string", "number", "boolean"].map((type) => ({
  id: type,
  value: type,
  label: type,
}));

export function WorkflowParameters({
  model,
  pending,
}: {
  model: AutomationWorkflowModel;
  pending: boolean;
}) {
  const { t } = useTranslation();
  const [rows, setRows] = useState<ParameterRow[]>(() =>
    Object.entries(record(model.getState().value.inputs)).map(([name, definition], key) => ({
      key,
      name,
      definition: record(definition),
    })),
  );
  const [nextKey, setNextKey] = useState(rows.length);
  const update = useCallback(
    (next: ParameterRow[]) => {
      setRows(next);
      const names = next.map((row) => row.name);
      const valid =
        names.every((name) => /^[A-Za-z][A-Za-z0-9_]*$/.test(name)) &&
        new Set(names).size === names.length;
      model.setError("parameters", valid ? null : t("hub.automations.workflow.parameterNames"));
      if (valid)
        model.set(["inputs"], Object.fromEntries(next.map((row) => [row.name, row.definition])));
    },
    [model, t],
  );
  const changeRow = useCallback<ChangeRow>(
    (key, change) => update(rows.map((item) => (item.key === key ? change(item) : item))),
    [rows, update],
  );
  const removeRow = useCallback(
    (key: number) => update(rows.filter((item) => item.key !== key)),
    [rows, update],
  );
  const addRow = useCallback(() => {
    let name = `parameter_${nextKey + 1}`;
    while (rows.some((row) => row.name === name)) name += "_";
    update([...rows, { key: nextKey, name, definition: { type: "string" } }]);
    setNextKey(nextKey + 1);
  }, [nextKey, rows, update]);
  return (
    <View style={styles.form}>
      <Text style={settingsStyles.rowTitle}>{t("hub.automations.form.parameters")}</Text>
      <Text style={settingsStyles.rowHint}>{t("hub.automations.workflow.parametersHint")}</Text>
      {rows.map((row, index) => (
        <ParameterFields
          key={row.key}
          row={row}
          number={index + 1}
          pending={pending}
          onChange={changeRow}
          onRemove={removeRow}
        />
      ))}
      <Button size="sm" variant="outline" disabled={pending} onPress={addRow}>
        {t("hub.automations.form.addParameter")}
      </Button>
    </View>
  );
}

function ParameterFields({
  row,
  number,
  pending,
  onChange,
  onRemove,
}: {
  row: ParameterRow;
  number: number;
  pending: boolean;
  onChange: ChangeRow;
  onRemove(key: number): void;
}) {
  const { t } = useTranslation();
  const size = useIsCompactFormFactor() ? "md" : "sm";
  const type = String(row.definition.type ?? "string");
  const selectedType = useMemo(() => ({ label: type }), [type]);
  const rename = useCallback(
    (name: string) => onChange(row.key, (item) => ({ ...item, name })),
    [onChange, row.key],
  );
  const changeType = useCallback(
    (value: string) =>
      onChange(row.key, (item) => ({ ...item, definition: { ...item.definition, type: value } })),
    [onChange, row.key],
  );
  const changeRequired = useCallback(
    (required: boolean) =>
      onChange(row.key, (item) => ({ ...item, definition: { ...item.definition, required } })),
    [onChange, row.key],
  );
  const remove = useCallback(() => onRemove(row.key), [onRemove, row.key]);
  return (
    <View style={styles.form}>
      <Field label={t("hub.automations.workflow.parameterNumber", { number })}>
        <FormTextInput
          size={size}
          initialValue={row.name}
          editable={!pending}
          onChangeText={rename}
        />
      </Field>
      <SelectField
        label={t("hub.automations.inputEditor.type")}
        value={type}
        selectedDisplay={selectedType}
        options={PARAMETER_TYPES}
        placeholder={t("hub.automations.workflow.chooseType")}
        emptyText={t("hub.automations.workflow.noTypes")}
        disabled={pending}
        onChange={changeType}
      />
      <View style={settingsStyles.row}>
        <Text style={settingsStyles.rowTitle}>{t("hub.automations.inputEditor.required")}</Text>
        <Switch
          accessibilityLabel={t("hub.automations.workflow.requireParameter", { number })}
          disabled={pending}
          value={row.definition.required === true}
          onValueChange={changeRequired}
        />
      </View>
      <Button size="sm" variant="ghost" disabled={pending} onPress={remove}>
        {t("hub.automations.workflow.removeParameter")}
      </Button>
    </View>
  );
}
