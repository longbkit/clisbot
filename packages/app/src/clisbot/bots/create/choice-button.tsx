import { useCallback, type ReactNode } from "react";
import { useIsCompactFormFactor } from "@/constants/layout";
import { Button } from "@/components/ui/button";

export function ChoiceButton<T extends string>({
  value,
  selected,
  onSelect,
  children,
}: {
  value: T;
  selected?: boolean;
  onSelect: (value: T) => void;
  children: ReactNode;
}) {
  const compact = useIsCompactFormFactor();
  const press = useCallback(() => onSelect(value), [onSelect, value]);
  return (
    <Button size={compact ? "md" : "sm"} variant={selected ? "default" : "outline"} onPress={press}>
      {children}
    </Button>
  );
}
