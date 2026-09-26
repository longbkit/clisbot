import { useCallback } from "react";
import { Text } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { createControlGeometry } from "@/components/ui/control-geometry";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { DropdownTrigger } from "@/components/ui/dropdown-trigger";
import type { MenuTriggerState } from "@/components/ui/menu";

/** Someone a grant can go to: an Access entry, or a Team or Member from People. */
export interface GrantChoice {
  key: string;
  title: string;
}

function triggerStyle({ hovered, pressed, open }: MenuTriggerState) {
  return [styles.trigger, (hovered || pressed || open) && styles.highlight];
}

/**
 * Grant access… for a Member in Teams. Access is easier to keep straight when it is granted to a
 * Team, so the menu offers the Member's Teams first and a grant to the Member alone last.
 */
export function GrantAccessMenu<T extends GrantChoice>({
  member,
  teams,
  disabled,
  grantTo,
}: {
  member: T;
  /** The Member's Teams; at least one, or the plain Grant access… button is enough. */
  teams: readonly T[];
  disabled: boolean;
  grantTo(choice: T): void;
}) {
  return (
    <DropdownMenu compactMode="sheet">
      <DropdownTrigger
        accessibilityRole="button"
        accessibilityLabel="Grant access…"
        disabled={disabled}
        style={triggerStyle}
      >
        <Text style={styles.label}>Grant access…</Text>
      </DropdownTrigger>
      <DropdownMenuContent align="end" width={300} sheetTitle="Grant access">
        <DropdownMenuLabel>Recommended: grant to a Team</DropdownMenuLabel>
        {teams.map((team) => (
          <GrantItem
            key={team.key}
            entry={team}
            label={`Team ${team.title}`}
            description="Everyone in the Team gets it, including people added later."
            grantTo={grantTo}
          />
        ))}
        <DropdownMenuSeparator />
        <GrantItem
          entry={member}
          label={`Only ${member.title}`}
          description="A direct grant, kept even if they leave their Teams."
          grantTo={grantTo}
        />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function GrantItem<T extends GrantChoice>({
  entry,
  label,
  description,
  grantTo,
}: {
  entry: T;
  label: string;
  description: string;
  grantTo(choice: T): void;
}) {
  const select = useCallback(() => grantTo(entry), [entry, grantTo]);
  return (
    <DropdownMenuItem description={description} onSelect={select}>
      {label}
    </DropdownMenuItem>
  );
}

// Drawn as the outline button it replaces, so the header does not change shape.
const styles = StyleSheet.create((theme) => {
  const geometry = createControlGeometry(theme);
  return {
    trigger: {
      ...geometry.buttonSm,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      borderRadius: theme.borderRadius.lg,
      borderWidth: 1,
      borderColor: theme.colors.borderAccent,
    },
    highlight: { backgroundColor: theme.colors.interactionHighlight },
    label: { color: theme.colors.foreground, ...geometry.buttonText },
  };
});
