import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { DataCell, DataRow, DataTable } from "../components/app/data-table.js";
import { PageHeader } from "../components/app/page.js";
import { StatusPill } from "../components/app/status-pill.js";
import { Alert, AlertDescription } from "../components/ui/alert.js";
import { formatDate } from "../projects/panel-state.js";
import { useRouteTenant } from "../projects/context.js";
import { triggerSnapshot } from "./functions.js";

const ACTIVITY_COLUMNS = [
  { header: "Trigger" },
  { header: "Provider" },
  { header: "Source" },
  { header: "Status" },
  { header: "Received" },
];
const EMPTY_ACTIVITY = { title: "No activity" };

export function TriggerActivityPanel() {
  const tenant = useRouteTenant();
  const load = useServerFn(triggerSnapshot);
  const organizationSlug = tenant.organization.slug;
  const snapshot = useQuery({
    queryKey: ["triggers", organizationSlug],
    queryFn: () => load({ data: { organizationSlug } }),
  });
  if (snapshot.isPending) return <div aria-busy="true">Loading activity…</div>;
  if (snapshot.isError || snapshot.data.status === "error") {
    return (
      <Alert variant="destructive">
        <AlertDescription>
          {snapshot.data?.status === "error"
            ? snapshot.data.error.message
            : "Hub couldn't load trigger activity."}
        </AlertDescription>
      </Alert>
    );
  }
  const activity = snapshot.data.data.activity;
  return (
    <>
      <PageHeader title="Activity" description="Agent runs launched by organization triggers." />
      <DataTable
        label="Trigger activity"
        columns={ACTIVITY_COLUMNS}
        isEmpty={activity.length === 0}
        empty={EMPTY_ACTIVITY}
      >
        {activity.map((run) => (
          <DataRow key={run.id}>
            <DataCell>
              <span>{run.triggerName}</span>
              {run.repo === null ? null : (
                <span className="block text-xs text-muted-foreground">{run.repo}</span>
              )}
            </DataCell>
            <DataCell>{run.provider}</DataCell>
            <DataCell>{run.source}</DataCell>
            <DataCell>
              <StatusPill tone={tone(run.status)}>{run.status}</StatusPill>
            </DataCell>
            <DataCell muted>{formatDate(run.receivedAt)}</DataCell>
          </DataRow>
        ))}
      </DataTable>
    </>
  );
}

function tone(status: string): "success" | "danger" | "neutral" {
  if (status === "succeeded") return "success";
  if (status === "failed" || status === "timed_out" || status === "rejected") return "danger";
  return "neutral";
}
