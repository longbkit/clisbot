import { useMemo } from "react";
import { SelectField } from "@/components/ui/select-field";
import type { DirectoryOwnership } from "./directory-model";
const options = [
  { id: "all", value: "all" as const, label: "All bots" },
  { id: "mine", value: "mine" as const, label: "Mine" },
  { id: "shared", value: "shared" as const, label: "Shared" },
];
export function DirectoryOwnershipControl({
  value,
  onChange,
  unknown,
}: {
  value: DirectoryOwnership;
  onChange: (value: DirectoryOwnership) => void;
  unknown: boolean;
}) {
  const display = useMemo(
    () => ({ label: options.find((option) => option.value === value)!.label }),
    [value],
  );
  return (
    <SelectField
      label="Show"
      value={value}
      onChange={onChange}
      selectedDisplay={display}
      options={options}
      placeholder="All bots"
      emptyText="No options"
      size="md"
      hint={
        unknown
          ? "Some Hosts do not report ownership yet. Those bots appear only in All bots."
          : undefined
      }
    />
  );
}
