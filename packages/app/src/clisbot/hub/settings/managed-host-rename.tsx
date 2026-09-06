import { useState } from "react";
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
  const hub = useHubAccount();
  const queryClient = useQueryClient();
  const [renaming, setRenaming] = useState(false);
  if (!hub.signedIn?.capabilities.manageResources) return null;
  async function rename(nextName: string) {
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
  }
  return (
    <>
      <Button size="sm" variant="outline" disabled={disabled} onPress={() => setRenaming(true)}>
        Rename
      </Button>
      {renaming ? (
        <RenameHostDialog name={name} onSave={rename} onClose={() => setRenaming(false)} />
      ) : null}
    </>
  );
}
