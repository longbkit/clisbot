import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import { useQueryClient } from "@tanstack/react-query";
import type { z } from "zod";
import { Button } from "@/components/ui/button";
import { useHubAccount } from "../account-provider";
import { HubDaemonRenameResultSchema, type HubDaemonsSchema } from "../contracts";
import { hubResourceQueryKey } from "../query-keys";
import { RenameHostDialog } from "./rename-host-dialog";

interface ManagedHostRenameProps {
  daemonId: string;
  name: string;
  disabled?: boolean;
}

export function ManagedHostRename({ daemonId, name, disabled = false }: ManagedHostRenameProps) {
  const { t } = useTranslation();
  const hub = useHubAccount();
  const queryClient = useQueryClient();
  const [renaming, setRenaming] = useState(false);
  const openRename = useCallback(() => setRenaming(true), []);
  const closeRename = useCallback(() => setRenaming(false), []);
  const rename = useCallback(
    async (nextName: string) => {
      const scope = {
        origin: hub.origin,
        organizationId: hub.signedIn?.organization.id ?? null,
        accountId: hub.signedIn?.account.id ?? null,
      };
      const renamed = await hub
        .api()
        .put(
          `daemons/${encodeURIComponent(daemonId)}`,
          { slug: nextName },
          HubDaemonRenameResultSchema,
        );
      const daemonKey = hubResourceQueryKey(scope, "daemons");
      queryClient.setQueryData<z.infer<typeof HubDaemonsSchema>>(daemonKey, (current) =>
        current
          ? {
              daemons: current.daemons.map((entry) =>
                entry.id === renamed.id ? { ...entry, slug: renamed.slug } : entry,
              ),
            }
          : current,
      );
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: daemonKey }),
        queryClient.invalidateQueries({ queryKey: hubResourceQueryKey(scope, "access-catalog") }),
      ]);
    },
    [daemonId, hub, queryClient],
  );
  if (!hub.signedIn?.capabilities.manageResources) return null;
  return (
    <>
      <Button size="sm" variant="outline" disabled={disabled} onPress={openRename}>
        {t("hub.settings.hostRename.rename")}
      </Button>
      {renaming ? <RenameHostDialog name={name} onSave={rename} onClose={closeRename} /> : null}
    </>
  );
}
