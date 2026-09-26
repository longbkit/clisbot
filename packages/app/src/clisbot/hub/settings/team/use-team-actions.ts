import { useCallback, useState } from "react";
import { confirmDialog } from "@/utils/confirm-dialog";
import { HubTeamMembershipSchema, HubTeamSchema } from "../../contracts";
import type { HubAccount, HubRun, HubTeam, TeamResources } from "./types";

export interface TeamActions {
  pending: boolean;
  mutationError: string | null;
  setMutationError(value: string | null): void;
  run: HubRun;
  addTeamMember(teamId: string, userId: string): Promise<void>;
  removeTeamMember(teamId: string, userId: string): void;
  addTeamMembers(teamId: string, userIds: string[]): Promise<string[]>;
  /** Joins one Member to `add` and takes them out of `remove`; false when the Hub refused one. */
  setMemberTeams(userId: string, changes: { add: string[]; remove: string[] }): Promise<boolean>;
  /** Creates a Team and reloads the list; rejects with the Hub's reason. */
  createTeam(name: string): Promise<HubTeam>;
  /** Rejects with the Hub's reason, so a dialog can keep it in front of the person. */
  renameTeam(teamId: string, name: string): Promise<void>;
  removeTeam(teamId: string, name: string): Promise<boolean>;
  removeMember(memberId: string, name: string): Promise<boolean>;
}

/** Runs one Hub mutation at a time and keeps its failure for the screen to show. */
export function useHubRun() {
  const [pending, setPending] = useState(false);
  const [mutationError, setMutationError] = useState<string | null>(null);
  /** Shows the failure on the screen and passes it on, for a caller that shows it too. */
  const runOrThrow = useCallback(async (operation: () => Promise<void>) => {
    setMutationError(null);
    setPending(true);
    try {
      await operation();
    } catch (error) {
      const failure = error instanceof Error ? error : new Error("Hub request failed.");
      setMutationError(failure.message);
      throw failure;
    } finally {
      setPending(false);
    }
  }, []);
  const run = useCallback<HubRun>(
    async (operation) => {
      try {
        await runOrThrow(operation);
        return true;
      } catch {
        return false;
      }
    },
    [runOrThrow],
  );
  return { pending, mutationError, setMutationError, run, runOrThrow };
}

export function useTeamActions(hub: HubAccount, resources: TeamResources): TeamActions {
  const runner = useHubRun();
  const { run } = runner;
  const { members, teams, identities, assignments } = resources;
  const addTeamMember = useCallback(
    async (teamId: string, userId: string) => {
      await hub
        .api()
        .post(`teams/${encodeURIComponent(teamId)}/members`, { userId }, HubTeamMembershipSchema);
    },
    [hub],
  );
  const removeTeamMember = useCallback(
    (teamId: string, userId: string) =>
      void run(async () => {
        await hub
          .api()
          .delete(`teams/${encodeURIComponent(teamId)}/members/${encodeURIComponent(userId)}`);
        await Promise.all([teams.refetch(), assignments.refetch()]);
      }),
    [assignments, hub, run, teams],
  );
  const addTeamMembers = useAddTeamMembers(runner.run, addTeamMember, resources);
  const setMemberTeams = useSetMemberTeams(hub, runner.run, addTeamMember, resources);
  const createTeam = useCallback(
    async (name: string) => {
      const team = await hub.api().post("teams", { name: name.trim() }, HubTeamSchema);
      await teams.refetch();
      return team;
    },
    [hub, teams],
  );
  const renameTeam = useCallback(
    (teamId: string, name: string) =>
      runner.runOrThrow(async () => {
        await hub.api().put(`teams/${encodeURIComponent(teamId)}`, { name }, HubTeamSchema);
        await teams.refetch();
      }),
    [hub, runner, teams],
  );
  const removeTeam = useCallback(
    async (teamId: string, name: string) => {
      const confirmed = await confirmDialog({
        title: `Delete ${name}?`,
        message: "The Team and its access assignments will be removed.",
        confirmLabel: "Delete Team",
        destructive: true,
      });
      if (!confirmed) return false;
      return run(async () => {
        await hub.api().delete(`teams/${encodeURIComponent(teamId)}`);
        await Promise.all([teams.refetch(), assignments.refetch(), hub.refresh()]);
      });
    },
    [assignments, hub, run, teams],
  );
  const removeMember = useCallback(
    async (memberId: string, name: string) => {
      const confirmed = await confirmDialog({
        title: `Remove ${name}?`,
        message:
          "This removes the Member from the organization, every Team, and all direct resource access.",
        confirmLabel: "Remove Member",
        destructive: true,
      });
      if (!confirmed) return false;
      return run(async () => {
        await hub.removeMember(memberId);
        await Promise.all([
          members.refetch(),
          teams.refetch(),
          identities.refetch(),
          assignments.refetch(),
        ]);
      });
    },
    [assignments, hub, identities, members, run, teams],
  );
  return {
    ...runner,
    addTeamMember,
    removeTeamMember,
    addTeamMembers,
    setMemberTeams,
    createTeam,
    renameTeam,
    removeTeam,
    removeMember,
  };
}

/** Adds each picked Member in turn and returns the ones Hub refused, so they stay picked. */
function useAddTeamMembers(
  run: HubRun,
  addTeamMember: (teamId: string, userId: string) => Promise<void>,
  { members, teams, assignments }: TeamResources,
) {
  return useCallback(
    async (teamId: string, userIds: string[]) => {
      const notAdded: string[] = [];
      await run(async () => {
        let reason = "Hub request failed.";
        for (const userId of userIds) {
          try {
            await addTeamMember(teamId, userId);
          } catch (error) {
            notAdded.push(userId);
            if (error instanceof Error) reason = error.message;
          }
        }
        // Members too: a refusal can mean the person left the organization, and they should
        // leave the picker instead of staying selected for a retry that cannot succeed.
        await Promise.all([
          teams.refetch(),
          assignments.refetch(),
          ...(notAdded.length > 0 ? [members.refetch()] : []),
        ]);
        if (notAdded.length > 0) {
          const added = userIds.length - notAdded.length;
          throw new Error(
            `Added ${String(added)} of ${String(userIds.length)} Members. ${reason} The rest are still selected.`,
          );
        }
      });
      return notAdded;
    },
    [addTeamMember, assignments, members, run, teams],
  );
}

/**
 * Applies every join and leave, even after a refusal, then refetches once: the dialog closes
 * only when all of them landed, and otherwise shows the Teams as the Hub now has them.
 */
function useSetMemberTeams(
  hub: HubAccount,
  run: HubRun,
  addTeamMember: (teamId: string, userId: string) => Promise<void>,
  { teams, assignments }: TeamResources,
) {
  return useCallback(
    (userId: string, { add, remove }: { add: string[]; remove: string[] }) =>
      run(async () => {
        const leave = (teamId: string) =>
          hub
            .api()
            .delete(`teams/${encodeURIComponent(teamId)}/members/${encodeURIComponent(userId)}`);
        const results = await Promise.allSettled([
          ...add.map((teamId) => addTeamMember(teamId, userId)),
          ...remove.map(leave),
        ]);
        await Promise.all([teams.refetch(), assignments.refetch()]);
        const refused = results.find((result) => result.status === "rejected");
        if (refused !== undefined) {
          const reason = refused.reason instanceof Error ? refused.reason.message : "";
          throw new Error(`Some Team changes were not saved. ${reason}`.trim());
        }
      }),
    [addTeamMember, assignments, hub, run, teams],
  );
}
