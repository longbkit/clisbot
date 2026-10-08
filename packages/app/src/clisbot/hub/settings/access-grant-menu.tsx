import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { DropdownTrigger } from "@/components/ui/dropdown-trigger";

/** Someone a grant can go to: an Access entry, or a Team or Member from People. */
export interface GrantChoice {
  key: string;
  title: string;
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
  const { t } = useTranslation();
  return (
    <DropdownMenu compactMode="sheet">
      <DropdownTrigger
        accessibilityRole="button"
        accessibilityLabel={t("hub.access.form.grantAccessEllipsis")}
        disabled={disabled}
      >
        {t("hub.access.form.grantAccessEllipsis")}
      </DropdownTrigger>
      <DropdownMenuContent align="end" width={300} sheetTitle={t("hub.access.form.grantAccess")}>
        <DropdownMenuLabel>{t("hub.access.grantMenu.recommended")}</DropdownMenuLabel>
        {teams.map((team) => (
          <GrantItem
            key={team.key}
            entry={team}
            label={t("hub.access.rows.viaTeam", { name: team.title })}
            description={t("hub.access.grantMenu.teamDescription")}
            grantTo={grantTo}
          />
        ))}
        <DropdownMenuSeparator />
        <GrantItem
          entry={member}
          label={t("hub.access.grantMenu.only", { name: member.title })}
          description={t("hub.access.grantMenu.onlyDescription")}
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
