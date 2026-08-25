import { Copy, KeyRound } from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type FormEvent,
  type FocusEvent,
} from "react";
import { ConfirmMenuItem } from "../components/app/confirm-action.js";
import { DataCell, DataRow, DataTable } from "../components/app/data-table.js";
import { PageHeader } from "../components/app/page.js";
import { RowActions } from "../components/app/row-actions.js";
import { StatusPill } from "../components/app/status-pill.js";
import { Alert, AlertDescription, AlertTitle } from "../components/ui/alert.js";
import { Button } from "../components/ui/button.js";
import { CheckboxInput } from "../components/ui/checkbox.js";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../components/ui/dialog.js";
import { Field, FieldDescription, FieldLabel, FieldSet } from "../components/ui/field.js";
import { Input } from "../components/ui/input.js";
import type { Result } from "../contract/respond.js";
import { apiKeyScopeSchema, type ApiKeyScope } from "./api-key-contract.js";
import { createApiKey, listApiKeys, revokeApiKey, revokeCliCredential } from "./functions.js";
import { useActiveAccount } from "./active-account.js";
import { API_KEY_MUTATION_KEY } from "./tenant-mutation.js";

interface ApiKeyRecord {
  id: string;
  name: string;
  prefix: string;
  scopes: ApiKeyScope[];
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
}

interface CliCredentialRecord {
  id: string;
  prefix: string;
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
}

type ListResult = Result<{ keys: ApiKeyRecord[]; cliCredentials: CliCredentialRecord[] }>;
type CreateResult = Result<{ key: ApiKeyRecord; secret: string }>;

const SCOPE_OPTIONS = [
  {
    value: "projects:read",
    label: "List projects",
    description: "List active projects in the organization.",
  },
  {
    value: "configuration:validate",
    label: "Validate configuration",
    description: "Validate configuration without creating a revision.",
  },
  {
    value: "configuration:install",
    label: "Install configuration",
    description: "Replace and activate a project's configuration.",
  },
  {
    value: "runs:dispatch",
    label: "Start runs",
    description: "Dispatch manual runs for a project.",
  },
  {
    value: "daemons:enroll",
    label: "Enroll daemons",
    description: "Issue a daemon enrollment token.",
  },
] as const;

const TABLE_COLUMNS = [
  { header: "Name" },
  { header: "Prefix" },
  { header: "Scopes" },
  { header: "Created" },
  { header: "Last used" },
  { header: "Status" },
  { header: "", align: "end" as const },
];

const EMPTY_TABLE = {
  title: "No API keys",
  description:
    "Create a key to install configuration, start runs, or enroll daemons from automation.",
};
const EMPTY_CLI_TABLE = {
  title: "No CLI logins",
  description: "Run paseo hub login to create one.",
};
const CLI_COLUMNS = [
  { header: "Prefix" },
  { header: "Created" },
  { header: "Last used" },
  { header: "Status" },
  { header: "", align: "end" as const },
];

export function ApiKeys() {
  const account = useActiveAccount();
  const queryClient = useQueryClient();
  const [creating, setCreating] = useState(false);
  const [secret, setSecret] = useState<string>();
  const load = useServerFn(listApiKeys) as (
    input: Parameters<typeof listApiKeys>[0],
  ) => Promise<ListResult>;
  const snapshot = useQuery({
    queryKey: ["api-keys", account.organization.id],
    queryFn: () => load({}),
    enabled: account.capabilities.manageResources,
  });
  const create = useMutation({
    mutationKey: API_KEY_MUTATION_KEY,
    mutationFn: useServerFn(createApiKey) as (
      input: Parameters<typeof createApiKey>[0],
    ) => Promise<CreateResult>,
    onSuccess: (result) => {
      if (result.status === "ok") setSecret(result.data.secret);
    },
  });
  const revoke = useMutation({
    mutationKey: API_KEY_MUTATION_KEY,
    mutationFn: useServerFn(revokeApiKey) as (
      input: Parameters<typeof revokeApiKey>[0],
    ) => Promise<Result<Record<string, never>>>,
    onSuccess: async (result) => {
      if (result.status === "ok") {
        await queryClient.invalidateQueries({ queryKey: ["api-keys", account.organization.id] });
      }
    },
  });
  const revokeCli = useMutation({
    mutationKey: API_KEY_MUTATION_KEY,
    mutationFn: useServerFn(revokeCliCredential) as (
      input: Parameters<typeof revokeCliCredential>[0],
    ) => Promise<Result<Record<string, never>>>,
    onSuccess: async (result) => {
      if (result.status === "ok") {
        await queryClient.invalidateQueries({ queryKey: ["api-keys", account.organization.id] });
      }
    },
  });
  const openCreate = useCallback(() => setCreating(true), []);
  const close = useCallback(
    (open: boolean) => {
      setCreating(open);
      if (!open) {
        setSecret(undefined);
        create.reset();
        void queryClient.invalidateQueries({ queryKey: ["api-keys", account.organization.id] });
      }
    },
    [account.organization.id, create, queryClient],
  );
  const submit = useCallback(
    (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      const form = new FormData(event.currentTarget);
      const nameValue = form.get("name");
      const name = typeof nameValue === "string" ? nameValue : "";
      const scopes = form.getAll("scopes").flatMap((value): ApiKeyScope[] => {
        if (typeof value !== "string") return [];
        const parsed = apiKeyScopeSchema.safeParse(value);
        return parsed.success ? [parsed.data] : [];
      });
      create.mutate({ data: { name, scopes } });
    },
    [create],
  );
  if (!account.capabilities.manageResources) {
    return (
      <>
        <PageHeader
          title="API keys"
          description={`Machine access for ${account.organization.name}.`}
        />
        <Alert>
          <AlertDescription>You don't have permission to manage API keys.</AlertDescription>
        </Alert>
      </>
    );
  }
  if (snapshot.isPending) return <p aria-busy="true">Loading API keys…</p>;
  if (snapshot.isError || snapshot.data.status === "error") {
    return (
      <Alert variant="destructive">
        Hub did not receive the API-key list. Check your connection and reload the page.
      </Alert>
    );
  }
  const keys = [...snapshot.data.data.keys].sort((left, right) => {
    const revoked = Number(left.revokedAt !== null) - Number(right.revokedAt !== null);
    return revoked || right.createdAt.localeCompare(left.createdAt);
  });
  const cliCredentials = [...snapshot.data.data.cliCredentials].sort((left, right) =>
    right.createdAt.localeCompare(left.createdAt),
  );
  const createResponseError =
    create.data?.status === "error" ? create.data.error.message : undefined;
  const error =
    createResponseError ??
    (create.isError
      ? "Hub did not receive the API-key creation result. Check your connection and reload the key list; no secret can be recovered later."
      : undefined);
  const revokeResponseError =
    revoke.data?.status === "error" ? revoke.data.error.message : undefined;
  const revokeError =
    revokeResponseError ??
    (revoke.isError
      ? "Hub did not receive the API-key revocation result. Check your connection and reload the key list to confirm its status."
      : undefined);
  return (
    <>
      <PageHeader title="API keys" description={`Machine access for ${account.organization.name}.`}>
        <Button asChild variant="outline">
          <a href="https://paseo.sh/docs/hub/api">API reference</a>
        </Button>
        {account.capabilities.manageResources ? (
          <Button type="button" onClick={openCreate}>
            <KeyRound aria-hidden="true" />
            Create API key
          </Button>
        ) : null}
      </PageHeader>
      {revokeError === undefined ? null : (
        <Alert variant="destructive" className="mb-6">
          <AlertDescription>{revokeError}</AlertDescription>
        </Alert>
      )}
      <DataTable
        label="API keys"
        columns={TABLE_COLUMNS}
        isEmpty={keys.length === 0}
        empty={EMPTY_TABLE}
      >
        {keys.map((record) => (
          <ApiKeyRow
            key={record.id}
            record={record}
            canManage={account.capabilities.manageResources}
            busy={revoke.isPending}
            onRevoke={revoke.mutate}
          />
        ))}
      </DataTable>
      <section className="mt-10 grid gap-4" aria-labelledby="cli-logins-heading">
        <div>
          <h2 id="cli-logins-heading" className="text-lg font-semibold">
            CLI logins
          </h2>
          <p className="text-muted-foreground text-sm">
            Durable terminal credentials created through browser approval.
          </p>
        </div>
        <DataTable
          label="CLI logins"
          columns={CLI_COLUMNS}
          isEmpty={cliCredentials.length === 0}
          empty={EMPTY_CLI_TABLE}
        >
          {cliCredentials.map((record) => (
            <CliCredentialRow
              key={record.id}
              record={record}
              busy={revokeCli.isPending}
              onRevoke={revokeCli.mutate}
            />
          ))}
        </DataTable>
      </section>
      <ApiKeyDialog
        open={creating}
        onOpenChange={close}
        secret={secret}
        busy={create.isPending}
        error={error}
        onSubmit={submit}
      />
    </>
  );
}

function CliCredentialRow({
  record,
  busy,
  onRevoke,
}: {
  record: CliCredentialRecord;
  busy: boolean;
  onRevoke: (input: { data: { id: string } }) => void;
}) {
  const revoke = useCallback(() => onRevoke({ data: { id: record.id } }), [onRevoke, record.id]);
  return (
    <DataRow>
      <DataCell>
        <span className="font-mono text-xs">{record.prefix}</span>
      </DataCell>
      <DataCell muted>{formatDate(record.createdAt)}</DataCell>
      <DataCell muted>
        {record.lastUsedAt === null ? "Never" : formatDate(record.lastUsedAt)}
      </DataCell>
      <DataCell>
        <StatusPill tone={record.revokedAt === null ? "success" : "danger"}>
          {record.revokedAt === null ? "Active" : "Revoked"}
        </StatusPill>
      </DataCell>
      <DataCell align="end">
        {record.revokedAt === null ? (
          <RowActions label={`Actions for ${record.prefix}`}>
            <ConfirmMenuItem
              label="Revoke"
              destructive
              title="Revoke CLI login?"
              description="This terminal credential stops working immediately."
              confirmLabel="Revoke login"
              cancelLabel="Cancel"
              busy={busy}
              onConfirm={revoke}
            />
          </RowActions>
        ) : null}
      </DataCell>
    </DataRow>
  );
}

function ApiKeyRow({
  record,
  canManage,
  busy,
  onRevoke,
}: {
  record: ApiKeyRecord;
  canManage: boolean;
  busy: boolean;
  onRevoke: (input: { data: { id: string } }) => void;
}) {
  const revoke = useCallback(() => onRevoke({ data: { id: record.id } }), [onRevoke, record.id]);
  return (
    <DataRow>
      <DataCell>
        <span className="font-medium">{record.name}</span>
      </DataCell>
      <DataCell>
        <span className="font-mono text-xs">{record.prefix}</span>
      </DataCell>
      <DataCell muted>{record.scopes.map(scopeLabel).join(", ")}</DataCell>
      <DataCell muted>{formatDate(record.createdAt)}</DataCell>
      <DataCell muted>
        {record.lastUsedAt === null ? "Never" : formatDate(record.lastUsedAt)}
      </DataCell>
      <DataCell>
        <StatusPill tone={record.revokedAt === null ? "success" : "danger"}>
          {record.revokedAt === null ? "Active" : "Revoked"}
        </StatusPill>
      </DataCell>
      <DataCell align="end">
        {record.revokedAt === null && canManage ? (
          <RowActions label={`Actions for ${record.name}`}>
            <ConfirmMenuItem
              label="Revoke"
              destructive
              title={`Revoke ${record.name}?`}
              description="Any automation using this key stops working immediately. This cannot be undone."
              confirmLabel="Revoke key"
              cancelLabel="Cancel"
              busy={busy}
              onConfirm={revoke}
            />
          </RowActions>
        ) : null}
      </DataCell>
    </DataRow>
  );
}

function ApiKeyDialog({
  open,
  onOpenChange,
  secret,
  busy,
  error,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  secret: string | undefined;
  busy: boolean;
  error: string | undefined;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  const secretInput = useRef<HTMLInputElement>(null);
  const [copied, setCopied] = useState<string>();
  const [selectedScopes, setSelectedScopes] = useState(0);
  const updateScope = useCallback((checked: boolean) => {
    setSelectedScopes((count) => count + (checked ? 1 : -1));
  }, []);
  const copy = useCallback(async () => {
    if (secret === undefined) return;
    try {
      await navigator.clipboard.writeText(secret);
      setCopied("API key copied.");
    } catch {
      setCopied(
        "Clipboard access was blocked. Select the API key and copy it manually before closing this dialog.",
      );
    }
  }, [secret]);
  const selectSecret = useCallback((event: FocusEvent<HTMLInputElement>) => {
    event.currentTarget.select();
  }, []);
  const close = useCallback(() => onOpenChange(false), [onOpenChange]);
  const copyKey = useCallback(() => {
    void copy();
  }, [copy]);
  const preventEscapeWithSecret = useCallback(
    (event: { preventDefault: () => void }) => {
      if (secret !== undefined) event.preventDefault();
    },
    [secret],
  );
  useEffect(() => {
    if (secret !== undefined) {
      secretInput.current?.focus();
      secretInput.current?.select();
    }
  }, [secret]);
  useEffect(() => {
    if (!open) setSelectedScopes(0);
  }, [open]);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="sm:max-w-lg"
        showCloseButton={secret === undefined}
        onEscapeKeyDown={preventEscapeWithSecret}
        onPointerDownOutside={preventEscapeWithSecret}
      >
        <DialogHeader>
          <DialogTitle>{secret === undefined ? "Create API key" : "Copy your API key"}</DialogTitle>
          <DialogDescription>
            {secret === undefined
              ? "Choose the machine operations this organization key can perform."
              : "This key is shown once. Store it in your deployment secrets now."}
          </DialogDescription>
        </DialogHeader>
        {secret === undefined ? (
          <form method="post" aria-label="Create API key" aria-busy={busy} onSubmit={onSubmit}>
            <FieldSet disabled={busy} className="gap-4">
              <Field>
                <FieldLabel htmlFor="api-key-name">Name</FieldLabel>
                <Input id="api-key-name" name="name" maxLength={100} required />
              </Field>
              <Field>
                <fieldset className="grid gap-3">
                  <legend className="text-sm leading-snug font-medium">Scopes</legend>
                  <div className="grid gap-3">
                    {SCOPE_OPTIONS.map((option) => (
                      <ScopeOption key={option.value} option={option} onChange={updateScope} />
                    ))}
                  </div>
                  <FieldDescription>Select at least one scope.</FieldDescription>
                </fieldset>
              </Field>
              {error === undefined ? null : <Alert variant="destructive">{error}</Alert>}
              <DialogFooter>
                <Button type="submit" disabled={busy || selectedScopes === 0}>
                  Create API key
                </Button>
              </DialogFooter>
            </FieldSet>
          </form>
        ) : (
          <div className="grid gap-4">
            <Alert>
              <AlertTitle>Save this key now</AlertTitle>
              <AlertDescription>
                This secret cannot be recovered after you close this dialog.
              </AlertDescription>
            </Alert>
            <div className="flex min-w-0 gap-2">
              <Input
                ref={secretInput}
                readOnly
                value={secret}
                aria-label="Generated API key"
                className="min-w-0 font-mono text-xs"
                onFocus={selectSecret}
              />
              <Button type="button" variant="outline" onClick={copyKey}>
                <Copy aria-hidden="true" /> <span className="sr-only">Copy API key</span>
              </Button>
            </div>
            <p role="status" aria-live="polite" className="text-sm text-muted-foreground">
              {copied}
            </p>
            <DialogFooter>
              <Button type="button" onClick={close}>
                Done
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function scopeLabel(scope: ApiKeyScope): string {
  return SCOPE_OPTIONS.find((option) => option.value === scope)?.label ?? scope;
}

function ScopeOption({
  option,
  onChange,
}: {
  option: (typeof SCOPE_OPTIONS)[number];
  onChange: (checked: boolean) => void;
}) {
  const id = `api-key-scope-${option.value}`;
  const handleChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => onChange(event.target.checked),
    [onChange],
  );
  return (
    <label htmlFor={id} className="flex cursor-pointer items-start gap-3">
      <CheckboxInput id={id} name="scopes" value={option.value} onChange={handleChange} />
      <span className="grid gap-0.5 text-sm">
        <span className="font-medium">{option.label}</span>
        <span className="text-muted-foreground">{option.description}</span>
      </span>
    </label>
  );
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(
    new Date(value),
  );
}
