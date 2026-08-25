import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useCallback, useState, type FormEvent } from "react";
import { ConfirmMenuItem } from "../components/app/confirm-action.js";
import { DataCell, DataRow, DataTable, type DataColumn } from "../components/app/data-table.js";
import { PageHeader } from "../components/app/page.js";
import { RowActions } from "../components/app/row-actions.js";
import { StatusPill } from "../components/app/status-pill.js";
import { Alert, AlertDescription, AlertTitle } from "../components/ui/alert.js";
import { Button } from "../components/ui/button.js";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../components/ui/dialog.js";
import { DropdownMenuItem } from "../components/ui/dropdown-menu.js";
import { Field, FieldLabel } from "../components/ui/field.js";
import { Input } from "../components/ui/input.js";
import { Skeleton } from "../components/ui/skeleton.js";
import {
  daemonList,
  renameDaemon,
  revokeDaemon,
  type BrowserDaemon,
  type DaemonCommand,
} from "./functions.js";
import type { Result } from "../contract/respond.js";
import { DAEMON_MUTATION_KEY } from "../auth/tenant-mutation.js";
import { daemonsQueryKey, refreshDaemons } from "./status.js";

const DAEMON_COLUMNS: readonly DataColumn[] = [
  { header: "Slug" },
  { header: "ID" },
  { header: "Status" },
  { header: "Last seen" },
  { header: "Registered" },
  { header: "", align: "end" },
];
const DAEMONS_EMPTY = {
  title: "No daemons registered",
  description: "Run paseo hub connect with this Hub URL to register one.",
};

export function DaemonsPanel({
  accountId,
  organizationId,
  organizationSlug,
}: {
  accountId: string;
  organizationId: string;
  organizationSlug: string;
}) {
  const queryClient = useQueryClient();
  const queryKey = daemonsQueryKey(accountId, organizationId);
  const loadDaemons = useServerFn(daemonList);
  const snapshot = useQuery({
    queryKey,
    queryFn: () => loadDaemons({ data: { organizationSlug } }),
  });
  const rename = useMutation({
    mutationKey: DAEMON_MUTATION_KEY,
    mutationFn: useServerFn(renameDaemon) as (
      input: Parameters<typeof renameDaemon>[0],
    ) => Promise<Result<DaemonCommand>>,
    onSuccess: async (result) => {
      if (result.status !== "ok") return;
      if (result.data.state === "complete") {
        await refreshDaemons(queryClient, accountId, organizationId);
        return;
      }
      queryClient.removeQueries({ queryKey });
      await queryClient.invalidateQueries({ queryKey: ["account"] });
    },
  });
  const revoke = useMutation({
    mutationKey: DAEMON_MUTATION_KEY,
    mutationFn: useServerFn(revokeDaemon) as (
      input: Parameters<typeof revokeDaemon>[0],
    ) => Promise<Result<DaemonCommand>>,
    onSuccess: async (result) => {
      if (result.status !== "ok") return;
      if (result.data.state === "complete") {
        await refreshDaemons(queryClient, accountId, organizationId);
        return;
      }
      queryClient.removeQueries({ queryKey });
      await queryClient.invalidateQueries({ queryKey: ["account"] });
    },
  });
  const renameSelected = useCallback(
    async (daemonId: string, slug: string) => {
      try {
        const result = await rename.mutateAsync({
          data: { organizationSlug, daemonId, slug },
        });
        if (result.status === "error") return result.error.message;
        return result.data.state === "complete"
          ? undefined
          : "The daemon is no longer available in the current organization. Reload the daemon list.";
      } catch {
        return "Hub did not receive the daemon rename result. Check your connection and reload its current name.";
      }
    },
    [organizationSlug, rename],
  );
  const revokeSelected = useCallback(
    (daemonId: string) => revoke.mutate({ data: { organizationSlug, daemonId } }),
    [organizationSlug, revoke],
  );
  if (snapshot.isPending) return <DaemonLoading />;
  if (snapshot.isError || snapshot.data.status === "error") {
    return (
      <Alert variant="destructive">
        <AlertTitle>Daemons unavailable</AlertTitle>
        <AlertDescription>
          {snapshot.data?.status === "error"
            ? snapshot.data.error.message
            : "Hub did not receive the daemon list. Check your connection and reload the page."}
        </AlertDescription>
      </Alert>
    );
  }
  const daemons = snapshot.data.data;
  const failure = [revoke.data].find((result) => result?.status === "error");
  let message = failure?.status === "error" ? failure.error.message : undefined;
  if (revoke.isError)
    message =
      "Hub did not receive the daemon revocation result. Check your connection and reload its current status.";
  const busy = rename.isPending || revoke.isPending;
  return (
    <>
      <PageHeader
        id="daemons-heading"
        title="Daemons"
        description="Stable daemon identities registered to this organization."
      />
      {message === undefined ? null : (
        <Alert variant="destructive" className="mb-6">
          <AlertDescription>{message}</AlertDescription>
        </Alert>
      )}
      <DataTable
        label="Daemons"
        columns={DAEMON_COLUMNS}
        isEmpty={daemons.daemons.length === 0}
        empty={DAEMONS_EMPTY}
      >
        {daemons.daemons.map((daemon) => (
          <DaemonRow
            key={daemon.id}
            daemon={daemon}
            canManage={daemons.canManage}
            busy={busy}
            onRename={renameSelected}
            onRevoke={revokeSelected}
          />
        ))}
      </DataTable>
    </>
  );
}

function DaemonRow({
  daemon,
  canManage,
  busy,
  onRename,
  onRevoke,
}: {
  daemon: BrowserDaemon;
  canManage: boolean;
  busy: boolean;
  onRename: (daemonId: string, slug: string) => Promise<string | undefined>;
  onRevoke: (daemonId: string) => void;
}) {
  const [renaming, setRenaming] = useState(false);
  const requestRename = useCallback((event: Event) => {
    event.preventDefault();
    setRenaming(true);
  }, []);
  const revoke = useCallback(() => onRevoke(daemon.id), [daemon.id, onRevoke]);

  return (
    <DataRow>
      <DataCell className="min-w-0">
        <span className="block truncate">{daemon.slug}</span>
      </DataCell>
      <DataCell muted>
        <span className="font-mono text-xs">{daemon.id.slice(0, 8)}</span>
      </DataCell>
      <DataCell>
        <DaemonStatus daemon={daemon} />
      </DataCell>
      <DataCell muted>{formatDate(daemon.lastSeenAt)}</DataCell>
      <DataCell muted>{formatDate(daemon.registeredAt)}</DataCell>
      <DataCell align="end">
        {canManage ? (
          <>
            <RowActions label={`Actions for ${daemon.slug}`}>
              <DropdownMenuItem disabled={busy} onSelect={requestRename}>
                Rename
              </DropdownMenuItem>
              {daemon.status === "revoked" ? null : (
                <ConfirmMenuItem
                  busy={busy}
                  destructive
                  label="Revoke"
                  title={`Revoke ${daemon.slug}?`}
                  description="The daemon will disconnect and its credential cannot reconnect."
                  cancelLabel="Cancel"
                  confirmLabel="Revoke daemon"
                  onConfirm={revoke}
                />
              )}
            </RowActions>
            <RenameDaemonDialog
              daemon={daemon}
              busy={busy}
              onRename={onRename}
              open={renaming}
              onOpenChange={setRenaming}
            />
          </>
        ) : null}
      </DataCell>
    </DataRow>
  );
}

function RenameDaemonDialog({
  daemon,
  busy,
  onRename,
  open,
  onOpenChange,
}: {
  daemon: BrowserDaemon;
  busy: boolean;
  onRename: (daemonId: string, slug: string) => Promise<string | undefined>;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [error, setError] = useState<string>();
  const changeOpen = useCallback(
    (nextOpen: boolean) => {
      if (!nextOpen) setError(undefined);
      onOpenChange(nextOpen);
    },
    [onOpenChange],
  );
  const completeRename = useCallback(
    async (slug: string) => {
      const failure = await onRename(daemon.id, slug);
      setError(failure);
      if (failure === undefined) changeOpen(false);
    },
    [changeOpen, daemon.id, onRename],
  );
  const submit = useCallback(
    (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      const slug = new FormData(event.currentTarget).get("slug");
      if (typeof slug !== "string") return;
      void completeRename(slug);
    },
    [completeRename],
  );

  return (
    <Dialog open={open} onOpenChange={changeOpen}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Rename daemon</DialogTitle>
        </DialogHeader>
        <form
          onSubmit={submit}
          aria-label={`Rename ${daemon.slug}`}
          className="grid gap-6 text-left"
        >
          <Field>
            <FieldLabel htmlFor={`daemon-slug-${daemon.id}`}>Daemon slug</FieldLabel>
            <Input
              id={`daemon-slug-${daemon.id}`}
              name="slug"
              defaultValue={daemon.slug}
              maxLength={100}
              required
              disabled={busy}
            />
          </Field>
          {error === undefined ? null : (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
          <DialogFooter>
            <Button type="submit" disabled={busy}>
              Rename
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function DaemonStatus({ daemon }: { daemon: BrowserDaemon }) {
  if (daemon.status === "revoked") return <StatusPill tone="danger">Revoked</StatusPill>;
  if (daemon.presence === "connected") return <StatusPill tone="success">Connected</StatusPill>;
  return <StatusPill tone="neutral">Offline</StatusPill>;
}

function DaemonLoading() {
  return (
    <section aria-label="Loading daemons" className="grid gap-6">
      <Skeleton className="h-12 w-64" />
      <Skeleton className="h-64 w-full" />
    </section>
  );
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}
