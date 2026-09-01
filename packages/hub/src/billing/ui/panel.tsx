/* oxlint-disable typescript-eslint/no-unsafe-type-assertion -- the generated route type cannot express a server-resolved organization slug */
import { useCallback, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Check } from "lucide-react";
import { PageHeader } from "../../components/app/page.js";
import { Section } from "../../components/app/section.js";
import { StatusPill } from "../../components/app/status-pill.js";
import { Alert, AlertDescription, AlertTitle } from "../../components/ui/alert.js";
import { Button } from "../../components/ui/button.js";
import { Skeleton } from "../../components/ui/skeleton.js";
import { useRouteTenant } from "../../projects/context.js";
import type { BillingOverviewView, PublicBillingPlan } from "../../server/runtime.js";
import { billingOverview, billingPortal } from "./functions.js";
import { PlanDialog } from "./plan-dialog.js";
import { NO_SUBSCRIPTION, subscriptionSummary, type SubscriptionSummary } from "./presentation.js";

type PortalResult = Awaited<ReturnType<typeof billingPortal>>;

export function BillingPanel() {
  const tenant = useRouteTenant();
  const load = useServerFn(billingOverview);
  const query = useQuery({
    queryKey: ["billing", tenant.account.id, tenant.organization.id],
    queryFn: () => load({ data: { organizationSlug: tenant.organization.slug } }),
  });

  if (query.isPending) return <BillingLoading />;
  if (query.isError || query.data.status === "error") {
    return (
      <Alert variant="destructive">
        <AlertTitle>Billing unavailable</AlertTitle>
        <AlertDescription>
          {query.data?.status === "error"
            ? query.data.error.message
            : "Hub did not receive the billing state. Check your connection and reload the page."}
        </AlertDescription>
      </Alert>
    );
  }
  return <BillingContent overview={query.data.data} slug={tenant.organization.slug} />;
}

/**
 * One card, banded top to bottom: who you are on this plan, what the plan includes, and the way
 * out to Stripe. The bands share a card so the page reads as a single object rather than a stack
 * of unrelated boxes, and each band owns its own padding so nothing collides.
 */
function BillingContent({ overview, slug }: { overview: BillingOverviewView; slug: string }) {
  const { subscription, plans, canManage } = overview;
  const [dialogOpen, setDialogOpen] = useState(false);
  const openDialog = useCallback(() => setDialogOpen(true), []);
  const closeDialog = useCallback(() => setDialogOpen(false), []);
  const summary = subscriptionSummary(subscription);
  const currentPlan = plans.find((plan) => plan.slug === subscription.planSlug);

  return (
    <>
      <PageHeader
        title="Billing"
        description={`Plan and billing for ${overview.organization.name}.`}
      >
        <Button variant="outline" size="sm" asChild>
          <Link to={`/o/${slug}/settings/usage` as never}>View usage</Link>
        </Button>
      </PageHeader>
      <Section title="Plan">
        <div className="overflow-hidden rounded-xl border bg-card text-card-foreground">
          <PlanIdentity
            summary={summary}
            action={planPickerAction({ canManage, subscription, plans })}
            onOpenPicker={openDialog}
          />
          {currentPlan !== undefined && <PlanIncludes plan={currentPlan} />}
          {canManage && subscription.manageable && <PortalBand slug={slug} />}
        </div>
      </Section>
      {dialogOpen && (
        <PlanDialog
          plans={plans}
          slug={slug}
          currentPlanSlug={subscription.planSlug}
          trialEligible={subscription.trialEligible}
          onClose={closeDialog}
        />
      )}
    </>
  );
}

/**
 * The button that opens the picker, or null when opening it would offer nothing. An organization
 * with no subscription is offered the one thing there is to do; a subscribed one is offered a
 * change only when the catalog publishes something to change to. Manage billing, in the band
 * below, is the way to leave.
 */
function planPickerAction({
  canManage,
  subscription,
  plans,
}: {
  canManage: boolean;
  subscription: BillingOverviewView["subscription"];
  plans: readonly PublicBillingPlan[];
}): string | null {
  if (!canManage) return null;
  if (subscription.planSlug === null) return "Subscribe";
  return plans.length > 1 ? "Change plan" : null;
}

function PlanIdentity({
  summary,
  action,
  onOpenPicker,
}: {
  summary: SubscriptionSummary;
  action: string | null;
  onOpenPicker: () => void;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-4 p-5 sm:p-6">
      <div className="grid min-w-0 gap-2">
        {/* The pill is wrapped because a bare inline-flex stretches to the full grid track. */}
        {summary.status !== null && (
          <div>
            <StatusPill tone={summary.status.tone}>{summary.status.label}</StatusPill>
          </div>
        )}
        <p className="text-2xl leading-tight tracking-tight">
          {summary.planName ?? NO_SUBSCRIPTION}
        </p>
        {summary.detail !== null && (
          <p className="text-sm text-muted-foreground">{summary.detail}</p>
        )}
      </div>
      {action !== null && (
        <Button type="button" onClick={onOpenPicker}>
          {action}
        </Button>
      )}
    </div>
  );
}

/** What the organization is actually entitled to right now, in the plan author's own words. */
function PlanIncludes({ plan }: { plan: PublicBillingPlan }) {
  if (plan.marketingFeatures.length === 0) return null;
  return (
    <div className="border-t bg-muted/20 p-5 sm:p-6">
      <ul className="grid gap-2 text-sm sm:grid-cols-2 sm:gap-x-6">
        {plan.marketingFeatures.map((feature) => (
          <li key={feature} className="flex items-start gap-2">
            <Check aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-primary" />
            <span>{feature}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function PortalBand({ slug }: { slug: string }) {
  const open = useMutation({
    mutationFn: useServerFn(billingPortal) as (
      input: Parameters<typeof billingPortal>[0],
    ) => Promise<PortalResult>,
    onSuccess: (result) => {
      if (result.status === "ok" && result.data.url !== null) redirectTo(result.data.url);
    },
  });
  const error = open.data?.status === "error" ? open.data.error.message : undefined;
  const start = useCallback(() => open.mutate({ data: { organizationSlug: slug } }), [open, slug]);

  return (
    <div className="grid justify-items-start gap-3 border-t p-5 sm:p-6">
      <Button type="button" variant="outline" size="sm" onClick={start} disabled={open.isPending}>
        Manage billing
      </Button>
      {error !== undefined && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
    </div>
  );
}

/** A web-only dashboard, so a plain navigation to the Stripe (or fixture) URL is correct. */
function redirectTo(url: string): void {
  window.location.assign(url);
}

function BillingLoading() {
  return (
    <section aria-label="Loading billing" aria-busy="true" className="grid gap-6">
      <Skeleton className="h-12 w-64" />
      <Skeleton className="h-48 w-full" />
    </section>
  );
}
