import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { SelectField } from "@/components/ui/select-field";
import type { DirectoryOwnership } from "./directory-model";
export function DirectoryOwnershipControl({
  value,
  onChange,
  unknown,
}: {
  value: DirectoryOwnership;
  onChange: (value: DirectoryOwnership) => void;
  unknown: boolean;
}) {
  const { t } = useTranslation();
  const options = useMemo(
    () => [
      { id: "all", value: "all" as const, label: t("bots.workspace.directory.allBots") },
      { id: "mine", value: "mine" as const, label: t("bots.workspace.directory.mine") },
      { id: "shared", value: "shared" as const, label: t("bots.workspace.directory.shared") },
    ],
    [t],
  );
  const display = useMemo(
    () => ({ label: options.find((option) => option.value === value)!.label }),
    [options, value],
  );
  return (
    <SelectField
      label={t("bots.workspace.directory.show")}
      value={value}
      onChange={onChange}
      selectedDisplay={display}
      options={options}
      placeholder={t("bots.workspace.directory.allBots")}
      emptyText={t("bots.workspace.directory.noOptions")}
      size="md"
      hint={unknown ? t("bots.workspace.directory.ownershipHint") : undefined}
    />
  );
}
