import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { TriangleAlert } from "lucide-react";
import { DataCell, DataRow, DataTable, type DataColumn } from "../components/app/data-table.js";
import { PageHeader } from "../components/app/page.js";
import { RelativeTime } from "../components/app/relative-time.js";
import { Section } from "../components/app/section.js";
import { StatusPill } from "../components/app/status-pill.js";
import { Alert, AlertDescription, AlertTitle } from "../components/ui/alert.js";
import { Badge } from "../components/ui/badge.js";
import { Skeleton } from "../components/ui/skeleton.js";
import type { EntitlementChangeSource } from "../db/types.js";
import { useRouteTenant } from "../projects/context.js";
import type { UsageDashboard, UsageMeasure } from "./dashboard.js";
import { usageSnapshot } from "./functions.js";

type Snapshot = Awaited<ReturnType<UsageDashboard["snapshot"]>>;

const LIMIT_COLUMNS: readonly DataColumn[] = [
  { header: "Resource" },
  { header: "Limit" },
  { header: "In use", align: "end" },
];
const HISTORY_COLUMNS: readonly DataColumn[] = [
  { header: "Change" },
  { header: "Reason" },
  { header: "Who" },
  { header: "When", align: "end" },
];
const HISTORY_EMPTY = {
  title: "No changes yet",
  description: "Limit changes to this organization appear here.",
};

// Customer-facing labels — never the operator's "override" / "entitlement" vocabulary, and no
// plan language on the two sources that occur self-hosted (provisioning and limit changes).
const SOURCE_LABELS: Record<EntitlementChangeSource, string> = {
  provisioning: "Provisioned",
  plan_stamp: "Plan update",
  override: "Limit change",
};

export function OrganizationUsagePanel() {
  const tenant = useRouteTenant();
  const load = useServerFn(usageSnapshot);
  const query = useQuery({
    queryKey: ["usage", tenant.account.id, tenant.organization.id],
    queryFn: () => load({ data: { organizationSlug: tenant.organization.slug } }),
  });

  if (query.isPending) return <UsageLoading />;
  if (query.isError || query.data.status === "error") {
    return (
      <Alert variant="destructive">
        <AlertTitle>Usage unavailable</AlertTitle>
        <AlertDescription>
          {query.data?.status === "error"
            ? query.data.error.message
            : "Hub did not receive the usage snapshot. Check your connection and reload the page."}
        </AlertDescription>
      </Alert>
    );
  }
  return <UsageContent snapshot={query.data.data} />;
}

function UsageContent({ snapshot }: { snapshot: Snapshot }) {
  const { limits } = snapshot;
  return (
    <>
      <PageHeader
        title="Usage"
        description={`Limits and usage for ${snapshot.organization.name}.`}
      />
      <SeatOverLimitBanner seats={limits.seats} />
      <Section
        title="Limits"
        description="What this organization is allowed, and how much is in use."
      >
        <DataTable label="Limits" columns={LIMIT_COLUMNS} isEmpty={false} empty={LIMITS_EMPTY}>
          <DataRow>
            <DataCell>Seats</DataCell>
            <DataCell muted>{limitLabel(limits.seats.limit)}</DataCell>
            <DataCell align="end">{limits.seats.used}</DataCell>
          </DataRow>
          <DataRow>
            <DataCell>Members can invite</DataCell>
            <DataCell muted>
              <StatusPill tone={limits.canInviteMembers ? "success" : "neutral"} dot={false}>
                {limits.canInviteMembers ? "Allowed" : "Not allowed"}
              </StatusPill>
            </DataCell>
            <DataCell align="end" muted>
              —
            </DataCell>
          </DataRow>
          <DataRow>
            <DataCell>Executions this month</DataCell>
            <DataCell muted>{limitLabel(limits.executionsMonthly.limit)}</DataCell>
            <DataCell align="end">{measureUsage(limits.executionsMonthly)}</DataCell>
          </DataRow>
        </DataTable>
      </Section>
      <Section
        title="History"
        description="Every change to this organization's limits, most recent first."
      >
        <History history={snapshot.history} />
      </Section>
    </>
  );
}

const LIMITS_EMPTY = { title: "No limits" };

/**
 * Grandfathering means an over-limit organization keeps everything it has and only loses the
 * ability to grow. This renders on self-hosted too, so the copy names the limit and stays silent
 * on remedies — the Billing page owns any upgrade call to action, and a self-hosted limit is the
 * operator's to raise. Renders nothing while within the seat limit.
 */
function SeatOverLimitBanner({ seats }: { seats: UsageMeasure }) {
  if (seats.limit === null || seats.used <= seats.limit) return null;
  return (
    <Alert aria-label="Over limit" className="border-warning/40 bg-warning-surface">
      <TriangleAlert className="text-warning" />
      <AlertTitle>You're over your seat limit</AlertTitle>
      <AlertDescription>
        <p>
          You have {seats.used} seats in use, but your limit is {seats.limit}.
        </p>
        <p>
          Your existing seats are kept — nothing was removed. You can't add more until you're within
          the limit.
        </p>
      </AlertDescription>
    </Alert>
  );
}

function History({ history }: { history: Snapshot["history"] }) {
  return (
    <DataTable
      label="History"
      columns={HISTORY_COLUMNS}
      isEmpty={history.length === 0}
      empty={HISTORY_EMPTY}
    >
      {history.map((entry) => (
        <DataRow key={entry.id}>
          <DataCell>
            <Badge variant={sourceBadgeVariant(entry.source)}>{SOURCE_LABELS[entry.source]}</Badge>
          </DataCell>
          <DataCell muted className="max-w-xs">
            <span className="block truncate" title={entry.reason ?? undefined}>
              {entry.reason ?? "—"}
            </span>
          </DataCell>
          <DataCell muted>{entry.actorName ?? "System"}</DataCell>
          <DataCell align="end" muted>
            <RelativeTime value={entry.createdAt} />
          </DataCell>
        </DataRow>
      ))}
    </DataTable>
  );
}

function sourceBadgeVariant(source: EntitlementChangeSource): "default" | "secondary" | "outline" {
  if (source === "override") return "default";
  if (source === "plan_stamp") return "secondary";
  return "outline";
}

function limitLabel(limit: number | null): string {
  return limit === null ? "Unlimited" : String(limit);
}

function measureUsage(measure: UsageMeasure): string {
  return measure.limit === null ? String(measure.used) : `${measure.used}/${measure.limit}`;
}

function UsageLoading() {
  return (
    <section aria-label="Loading usage" aria-busy="true" className="grid gap-6">
      <Skeleton className="h-12 w-64" />
      <Skeleton className="h-48 w-full" />
    </section>
  );
}
