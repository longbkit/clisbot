import { useCallback, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { TriangleAlert } from "lucide-react";
import { DataCell, DataRow, DataTable, type DataColumn } from "../components/app/data-table.js";
import { PageHeader } from "../components/app/page.js";
import { RelativeTime } from "../components/app/relative-time.js";
import { Section } from "../components/app/section.js";
import { StatusPill } from "../components/app/status-pill.js";
import { Alert, AlertDescription, AlertTitle } from "../components/ui/alert.js";
import { Badge } from "../components/ui/badge.js";
import { Button } from "../components/ui/button.js";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../components/ui/dialog.js";
import { Field, FieldLabel } from "../components/ui/field.js";
import { Input } from "../components/ui/input.js";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../components/ui/select.js";
import { Skeleton } from "../components/ui/skeleton.js";
import type { EntitlementChangeSource } from "../db/types.js";
import type { EntitlementPatch, OverrideKey } from "../entitlements/catalog.js";
import type { OperatorConsole } from "./console.js";
import {
  operatorClearOverride,
  operatorOrganizations,
  operatorOverride,
  operatorSnapshot,
} from "./functions.js";

type Snapshot = Awaited<ReturnType<OperatorConsole["snapshot"]>>;
type OverrideResult = Awaited<ReturnType<typeof operatorOverride>>;
type ClearOverrideResult = Awaited<ReturnType<typeof operatorClearOverride>>;

type OverrideTarget =
  | { kind: "seats"; key: OverrideKey; hasOverride: boolean; max: number | null }
  | { kind: "canInviteMembers"; key: OverrideKey; hasOverride: boolean; value: boolean }
  | { kind: "executionsMonthly"; key: OverrideKey; hasOverride: boolean; limit: number | null };

const ENTITLEMENT_COLUMNS: readonly DataColumn[] = [
  { header: "Entitlement" },
  { header: "Granted" },
  { header: "Override" },
  { header: "Effective" },
  { header: "Used" },
  { header: "", align: "end" },
];
const ENTITLEMENTS_EMPTY = { title: "No entitlements" };
const AUDIT_COLUMNS: readonly DataColumn[] = [
  { header: "Change" },
  { header: "Actor" },
  { header: "Reason" },
  { header: "When", align: "end" },
];
const AUDIT_EMPTY = {
  title: "No changes yet",
  description: "Provisioning, plan stamps, and overrides appear here.",
};
const SOURCE_LABELS: Record<EntitlementChangeSource, string> = {
  provisioning: "Provisioning",
  plan_stamp: "Plan",
  override: "Override",
};

export function OperatorEntitlementsPage() {
  const [slug, setSlug] = useState<string | null>(null);
  return (
    <>
      <PageHeader
        title="Operator"
        description="View and edit any organization's entitlements. Instance operators only."
      />
      <OrganizationPicker slug={slug} onSelect={setSlug} />
      {slug !== null && <OperatorOrganization slug={slug} />}
    </>
  );
}

function OrganizationPicker({
  slug,
  onSelect,
}: {
  slug: string | null;
  onSelect: (slug: string) => void;
}) {
  const load = useServerFn(operatorOrganizations);
  const query = useQuery({ queryKey: ["operator", "organizations"], queryFn: () => load() });

  if (query.isPending) return <OperatorLoading />;
  if (query.isError || query.data.status === "error") {
    return (
      <Alert variant="destructive">
        <AlertTitle>Operator console unavailable</AlertTitle>
        <AlertDescription>
          {query.data?.status === "error"
            ? query.data.error.message
            : "Hub did not receive the organization list. Check your connection and reload the page."}
        </AlertDescription>
      </Alert>
    );
  }
  return (
    <Section title="Organization" description="Pick an organization to manage its entitlements.">
      <Select {...(slug === null ? {} : { value: slug })} onValueChange={onSelect}>
        <SelectTrigger aria-label="Manage organization" className="w-full max-w-sm">
          <SelectValue placeholder="Select an organization" />
        </SelectTrigger>
        <SelectContent>
          {query.data.data.map((organization) => (
            <SelectItem key={organization.id} value={organization.slug}>
              {organization.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </Section>
  );
}

function OperatorOrganization({ slug }: { slug: string }) {
  const load = useServerFn(operatorSnapshot);
  const query = useQuery({
    queryKey: ["operator", "snapshot", slug],
    queryFn: () => load({ data: { organizationSlug: slug } }),
  });

  if (query.isPending) return <OperatorLoading />;
  if (query.isError || query.data.status === "error") {
    return (
      <Alert variant="destructive">
        <AlertTitle>Entitlements unavailable</AlertTitle>
        <AlertDescription>
          {query.data?.status === "error"
            ? query.data.error.message
            : "Hub did not receive this organization's entitlements. Check your connection and reload the page."}
        </AlertDescription>
      </Alert>
    );
  }
  return <OrganizationContent snapshot={query.data.data} slug={slug} />;
}

function OrganizationContent({ snapshot, slug }: { snapshot: Snapshot; slug: string }) {
  const { effective, granted, overrides } = snapshot.entitlements;
  const [target, setTarget] = useState<OverrideTarget | null>(null);
  const closeEditor = useCallback(() => setTarget(null), []);
  const seatsOverridden = overrides.seats?.max !== undefined;
  const editSeats = useCallback(
    () =>
      setTarget({
        kind: "seats",
        key: "seats",
        hasOverride: seatsOverridden,
        max: effective.seats.max,
      }),
    [effective.seats.max, seatsOverridden],
  );
  const invitesOverridden = overrides.canInviteMembers !== undefined;
  const editInvites = useCallback(
    () =>
      setTarget({
        kind: "canInviteMembers",
        key: "canInviteMembers",
        hasOverride: invitesOverridden,
        value: effective.canInviteMembers,
      }),
    [effective.canInviteMembers, invitesOverridden],
  );
  const effectiveExecutionsLimit = effective.meters["executions.monthly"].limit;
  const executionsOverridden = overrides.meters?.["executions.monthly"]?.limit !== undefined;
  const editExecutionsMonthly = useCallback(
    () =>
      setTarget({
        kind: "executionsMonthly",
        key: "executions.monthly",
        hasOverride: executionsOverridden,
        limit: effectiveExecutionsLimit,
      }),
    [effectiveExecutionsLimit, executionsOverridden],
  );

  return (
    <>
      <OverLimitBanner overages={snapshot.overages} />
      <Section
        title="Entitlements"
        description={`Effective values for ${snapshot.organization.name}, granted by its plan and adjusted by any manual overrides.`}
      >
        <DataTable
          label="Entitlements"
          columns={ENTITLEMENT_COLUMNS}
          isEmpty={false}
          empty={ENTITLEMENTS_EMPTY}
        >
          <DataRow>
            <DataCell>Seats</DataCell>
            <DataCell muted>{seatLimitLabel(granted.seats.max)}</DataCell>
            <DataCell muted>
              {overrides.seats?.max === undefined ? "—" : seatLimitLabel(overrides.seats.max)}
            </DataCell>
            <DataCell>{seatLimitLabel(effective.seats.max)}</DataCell>
            <DataCell muted>{snapshot.seatsInUse}</DataCell>
            <DataCell align="end">
              <Button
                type="button"
                variant="outline"
                size="sm"
                aria-label="Override seat limit"
                onClick={editSeats}
              >
                Override
              </Button>
            </DataCell>
          </DataRow>
          <DataRow>
            <DataCell>Members can invite</DataCell>
            <DataCell muted>
              <InviteBadge canInvite={granted.canInviteMembers} />
            </DataCell>
            <DataCell muted>
              {overrides.canInviteMembers === undefined ? (
                "—"
              ) : (
                <InviteBadge canInvite={overrides.canInviteMembers} />
              )}
            </DataCell>
            <DataCell>
              <InviteBadge canInvite={effective.canInviteMembers} />
            </DataCell>
            <DataCell muted>—</DataCell>
            <DataCell align="end">
              <Button
                type="button"
                variant="outline"
                size="sm"
                aria-label="Override members can invite"
                onClick={editInvites}
              >
                Override
              </Button>
            </DataCell>
          </DataRow>
          <DataRow>
            <DataCell>Executions this month</DataCell>
            <DataCell muted>{meterLimitLabel(granted.meters["executions.monthly"].limit)}</DataCell>
            <DataCell muted>
              {overrides.meters?.["executions.monthly"]?.limit === undefined
                ? "—"
                : meterLimitLabel(overrides.meters["executions.monthly"].limit)}
            </DataCell>
            <DataCell>{meterLimitLabel(effectiveExecutionsLimit)}</DataCell>
            <DataCell>{meterUsageLabel(snapshot.usage)}</DataCell>
            <DataCell align="end">
              <Button
                type="button"
                variant="outline"
                size="sm"
                aria-label="Override executions this month"
                onClick={editExecutionsMonthly}
              >
                Override
              </Button>
            </DataCell>
          </DataRow>
        </DataTable>
      </Section>
      <Section
        title="Audit trail"
        description="Every provisioning, plan stamp, and override, most recent first."
      >
        <AuditTrail history={snapshot.history} />
      </Section>
      {target !== null && <OverrideDialog target={target} slug={slug} onClose={closeEditor} />}
    </>
  );
}

/**
 * The operator sees which organizations sit over a cap a downgrade left behind. Existing resources
 * were grandfathered, so this is a warning, not an error — it says what is over and by how much.
 */
function OverLimitBanner({ overages }: { overages: Snapshot["overages"] }) {
  if (overages.length === 0) return null;
  return (
    <Alert aria-label="Over plan limit" className="border-warning/40 bg-warning-surface">
      <TriangleAlert className="text-warning" />
      <AlertTitle>This organization is over its limits</AlertTitle>
      <AlertDescription>
        {overages.map((overage) => (
          <p key={overage.entitlement}>
            {`${overage.current} seats in use, but the effective limit is ${overage.limit}.`}
          </p>
        ))}
      </AlertDescription>
    </Alert>
  );
}

function OverrideDialog({
  target,
  slug,
  onClose,
}: {
  target: OverrideTarget;
  slug: string;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const onSaved = useCallback(
    async (status: "ok" | "error") => {
      if (status !== "ok") return;
      await queryClient.invalidateQueries({ queryKey: ["operator", "snapshot", slug] });
      onClose();
    },
    [onClose, queryClient, slug],
  );
  const save = useMutation({
    mutationFn: useServerFn(operatorOverride) as (
      input: Parameters<typeof operatorOverride>[0],
    ) => Promise<OverrideResult>,
    onSuccess: (result) => onSaved(result.status),
  });
  const clear = useMutation({
    mutationFn: useServerFn(operatorClearOverride) as (
      input: Parameters<typeof operatorClearOverride>[0],
    ) => Promise<ClearOverrideResult>,
    onSuccess: (result) => onSaved(result.status),
  });
  const saveError = save.data?.status === "error" ? save.data.error.message : undefined;
  const clearError = clear.data?.status === "error" ? clear.data.error.message : undefined;
  const error = saveError ?? clearError;
  const pending = save.isPending || clear.isPending;

  const submit = useCallback(
    (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      const native = event.nativeEvent;
      const submitter = native instanceof SubmitEvent ? native.submitter : null;
      const data = new FormData(
        event.currentTarget,
        submitter instanceof HTMLButtonElement ? submitter : null,
      );
      const reason = formText(data, "reason").trim();
      if (data.get("intent") === "clear") {
        clear.mutate({ data: { organizationSlug: slug, key: target.key, reason } });
        return;
      }
      save.mutate({ data: { organizationSlug: slug, patch: patchFrom(target, data), reason } });
    },
    [clear, save, slug, target],
  );
  const handleOpenChange = useCallback(
    (open: boolean) => {
      if (!open) onClose();
    },
    [onClose],
  );

  return (
    <Dialog open onOpenChange={handleOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{overrideTitle(target)}</DialogTitle>
          <DialogDescription>
            Overrides are hand-set and survive plan changes. Every override — and every reset back
            to the plan default — is recorded in the audit trail with the reason you give.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} aria-label="Override entitlement" className="grid gap-6">
          {target.kind === "seats" && <SeatsControl max={target.max} />}
          {target.kind === "canInviteMembers" && <InviteControl value={target.value} />}
          {target.kind === "executionsMonthly" && <ExecutionsMonthlyControl limit={target.limit} />}
          <Field>
            <FieldLabel htmlFor="override-reason">Reason</FieldLabel>
            <Input
              id="override-reason"
              name="reason"
              required
              maxLength={500}
              placeholder="Why is this override being made?"
            />
          </Field>
          {error !== undefined && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
          <DialogFooter>
            {target.hasOverride && (
              <Button
                type="submit"
                name="intent"
                value="clear"
                variant="outline"
                disabled={pending}
              >
                Reset to plan default
              </Button>
            )}
            <Button type="submit" name="intent" value="save" disabled={pending}>
              Save override
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function SeatsControl({ max }: { max: number | null }) {
  return (
    <Field>
      <FieldLabel htmlFor="override-seats">Seat limit</FieldLabel>
      <Input
        id="override-seats"
        name="seats"
        type="number"
        min={1}
        step={1}
        defaultValue={max === null ? "" : String(max)}
        placeholder="Leave blank for unlimited"
      />
    </Field>
  );
}

function InviteControl({ value }: { value: boolean }) {
  const [choice, setChoice] = useState(value ? "allowed" : "blocked");
  return (
    <Field>
      <FieldLabel htmlFor="override-invite">Members can invite</FieldLabel>
      <Select name="invite" value={choice} onValueChange={setChoice}>
        <SelectTrigger id="override-invite" className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="allowed">Allowed</SelectItem>
          <SelectItem value="blocked">Not allowed</SelectItem>
        </SelectContent>
      </Select>
    </Field>
  );
}

function ExecutionsMonthlyControl({ limit }: { limit: number | null }) {
  return (
    <Field>
      <FieldLabel htmlFor="override-executions-monthly">Executions this month</FieldLabel>
      <Input
        id="override-executions-monthly"
        name="executionsMonthly"
        type="number"
        min={1}
        step={1}
        defaultValue={limit === null ? "" : String(limit)}
        placeholder="Leave blank for unlimited"
      />
    </Field>
  );
}

function AuditTrail({ history }: { history: Snapshot["history"] }) {
  return (
    <DataTable
      label="Audit trail"
      columns={AUDIT_COLUMNS}
      isEmpty={history.length === 0}
      empty={AUDIT_EMPTY}
    >
      {history.map((entry) => (
        <DataRow key={entry.id}>
          <DataCell>
            <div className="flex flex-col gap-1">
              <Badge variant={sourceBadgeVariant(entry.source)}>
                {SOURCE_LABELS[entry.source]}
              </Badge>
              <span className="text-xs text-muted-foreground">
                {effectiveLabel(entry.effective)}
              </span>
            </div>
          </DataCell>
          <DataCell muted>{entry.actorName ?? "System"}</DataCell>
          <DataCell muted className="max-w-xs">
            <span className="block truncate" title={entry.reason ?? undefined}>
              {entry.reason ?? "—"}
            </span>
          </DataCell>
          <DataCell align="end" muted>
            <RelativeTime value={entry.createdAt} />
          </DataCell>
        </DataRow>
      ))}
    </DataTable>
  );
}

function InviteBadge({ canInvite }: { canInvite: boolean }) {
  return (
    <StatusPill tone={canInvite ? "success" : "neutral"} dot={false}>
      {canInvite ? "Allowed" : "Not allowed"}
    </StatusPill>
  );
}

function patchFrom(target: OverrideTarget, data: FormData): EntitlementPatch {
  if (target.kind === "seats") {
    const raw = formText(data, "seats").trim();
    return { seats: { max: raw === "" ? null : Number(raw) } };
  }
  if (target.kind === "executionsMonthly") {
    const raw = formText(data, "executionsMonthly").trim();
    return { meters: { "executions.monthly": { limit: raw === "" ? null : Number(raw) } } };
  }
  return { canInviteMembers: data.get("invite") === "allowed" };
}

function formText(data: FormData, name: string): string {
  const value = data.get(name);
  return typeof value === "string" ? value : "";
}

function overrideTitle(target: OverrideTarget): string {
  if (target.kind === "seats") return "Override seat limit";
  if (target.kind === "executionsMonthly") return "Override executions this month";
  return "Override members can invite";
}

function effectiveLabel(effective: Snapshot["entitlements"]["effective"]): string {
  const invite = effective.canInviteMembers ? "Allowed" : "Not allowed";
  const executions = meterLimitLabel(effective.meters["executions.monthly"].limit);
  return `Seats: ${seatLimitLabel(effective.seats.max)} · Invites: ${invite} · Executions: ${executions}`;
}

function sourceBadgeVariant(source: EntitlementChangeSource): "default" | "secondary" | "outline" {
  if (source === "override") return "default";
  if (source === "plan_stamp") return "secondary";
  return "outline";
}

function seatLimitLabel(max: number | null): string {
  return max === null ? "Unlimited" : String(max);
}

function meterLimitLabel(limit: number | null): string {
  return limit === null ? "Unlimited" : String(limit);
}

function meterUsageLabel(usage: Snapshot["usage"]): string {
  return usage.limit === null ? String(usage.used) : `${usage.used}/${usage.limit}`;
}

function OperatorLoading() {
  return (
    <section aria-label="Loading operator console" aria-busy="true" className="grid gap-6">
      <Skeleton className="h-12 w-64" />
      <Skeleton className="h-48 w-full" />
    </section>
  );
}
