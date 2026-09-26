import { useCallback, type ReactNode } from "react";
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
  const press = useCallback(() => onSelect(value), [onSelect, value]);
  return (
    <Button variant={selected ? "default" : "outline"} onPress={press}>
      {children}
    </Button>
  );
}
