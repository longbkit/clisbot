import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import type { MultiSelectCreate } from "../multi-select-field";
import type { TeamActions } from "./use-team-actions";

/**
 * The "Create Team" choice of a Teams picker, for people who may create Teams: the typed name
 * becomes a Team at once and is chosen, the way a label picker creates a label. Undefined for
 * everyone else, so their picker offers only the Teams that exist.
 */
export function useCreateTeamChoice(
  actions: TeamActions,
  canCreate: boolean,
  choose: (teamId: string) => void,
): MultiSelectCreate | undefined {
  const { t } = useTranslation();
  const { run, createTeam } = actions;
  return useMemo(
    () =>
      canCreate
        ? {
            label: t("hub.team.teamPicker.createLabel"),
            description: t("hub.team.teamPicker.createDescription"),
            onCreate: (name: string) =>
              void run(async () => {
                choose((await createTeam(name)).id);
              }),
          }
        : undefined,
    [canCreate, choose, createTeam, run, t],
  );
}
