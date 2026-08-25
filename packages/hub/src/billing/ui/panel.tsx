/* oxlint-disable typescript-eslint/no-unsafe-type-assertion -- the generated route type cannot express a server-resolved organization slug */
import { useCallback, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Check } from "lucide-react";
import { PageHeader } from "../../components/app/page.js";
import { Section } from "../../components/app/section.js";
import { StatusPill, type StatusTone } from "../../components/app/status-pill.js";
import { Alert, AlertDescription, AlertTitle } from "../../components/ui/alert.js";
import { Badge } from "../../components/ui/badge.js";
import { Button } from "../../components/ui/button.js";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "../../components/ui/card.js";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "../../components/ui/dialog.js";
import { Skeleton } from "../../components/ui/skeleton.js";
import { useRouteTenant } from "../../projects/context.js";
import type { BillingPlanPriceInterval } from "../../db/types.js";
import type { BillingOverviewView, PublicBillingPlan } from "../../server/runtime.js";
import { billingCheckout, billingOverview, billingPortal } from "./functions.js";

type CheckoutResult = Awaited<ReturnType<typeof billingCheckout>>;
type PortalResult = Awaited<ReturnType<typeof billingPortal>>;

const INTERVALS: readonly { value: BillingPlanPriceInterval; label: string }[] = [
  { value: "monthly", label: "Monthly" },
  { value: "annual", label: "Annual" },
];

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

function BillingContent({ overview, slug }: { overview: BillingOverviewView; slug: string }) {
  const { subscription, plans, canManage } = overview;
  const [dialogOpen, setDialogOpen] = useState(false);
  const openDialog = useCallback(() => setDialogOpen(true), []);
  const closeDialog = useCallback(() => setDialogOpen(false), []);

  return (
    <>
      <PageHeader
        title="Billing"
        description={`Plan and billing for ${overview.organization.name}.`}
      />
      <p className="text-sm text-muted-foreground">
        Your limits and current usage live on the{" "}
        <Link to={`/o/${slug}/usage` as never} className="underline underline-offset-4">
          Usage
        </Link>{" "}
        page.
      </p>
      <Section
        title="Plan"
        description="Payment methods, invoices, and cancellation live in the Stripe billing portal."
      >
        <Card>
          <CardHeader>
            <CardTitle>{subscription.planName ?? "No active plan"}</CardTitle>
            <CardDescription>{subscriptionStatusLabel(subscription)}</CardDescription>
            {canManage && (
              <CardAction>
                <Button type="button" onClick={openDialog}>
                  {subscription.planSlug === null ? "Choose a plan" : "Change plan"}
                </Button>
              </CardAction>
            )}
          </CardHeader>
          {subscription.status !== null && (
            <CardContent>
              <StatusPill tone={statusTone(subscription.status)}>
                {statusText(subscription.status)}
              </StatusPill>
            </CardContent>
          )}
          {canManage && subscription.manageable && (
            <CardFooter>
              <ManageBillingButton slug={slug} />
            </CardFooter>
          )}
        </Card>
      </Section>
      {dialogOpen && (
        <PlanDialog
          plans={plans}
          slug={slug}
          currentPlanSlug={subscription.planSlug}
          onClose={closeDialog}
        />
      )}
    </>
  );
}

function ManageBillingButton({ slug }: { slug: string }) {
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
    <div className="grid gap-2">
      <Button type="button" variant="outline" onClick={start} disabled={open.isPending}>
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

function PlanDialog({
  plans,
  slug,
  currentPlanSlug,
  onClose,
}: {
  plans: readonly PublicBillingPlan[];
  slug: string;
  currentPlanSlug: string | null;
  onClose: () => void;
}) {
  const [interval, setInterval] = useState<BillingPlanPriceInterval>("monthly");
  const checkout = useMutation({
    mutationFn: useServerFn(billingCheckout) as (
      input: Parameters<typeof billingCheckout>[0],
    ) => Promise<CheckoutResult>,
    onSuccess: (result) => {
      if (result.status === "ok") redirectTo(result.data.url);
    },
  });
  const error = checkout.data?.status === "error" ? checkout.data.error.message : undefined;
  const handleOpenChange = useCallback(
    (open: boolean) => {
      if (!open) onClose();
    },
    [onClose],
  );
  const choose = useCallback(
    (planSlug: string) => checkout.mutate({ data: { organizationSlug: slug, planSlug, interval } }),
    [checkout, interval, slug],
  );

  return (
    <Dialog open onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Choose a plan</DialogTitle>
          <DialogDescription>
            Billed through Stripe. You can change or cancel your plan at any time.
          </DialogDescription>
        </DialogHeader>
        <div
          role="group"
          aria-label="Billing interval"
          className="inline-flex gap-1 self-start rounded-md border p-1"
        >
          {INTERVALS.map((option) => (
            <IntervalOption
              key={option.value}
              value={option.value}
              label={option.label}
              active={interval === option.value}
              onSelect={setInterval}
            />
          ))}
        </div>
        <div className="grid gap-4 sm:grid-cols-3">
          {plans.map((plan) => (
            <PlanCard
              key={plan.slug}
              plan={plan}
              interval={interval}
              isCurrent={plan.slug === currentPlanSlug}
              pending={checkout.isPending}
              onChoose={choose}
            />
          ))}
        </div>
        {error !== undefined && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
      </DialogContent>
    </Dialog>
  );
}

function IntervalOption({
  value,
  label,
  active,
  onSelect,
}: {
  value: BillingPlanPriceInterval;
  label: string;
  active: boolean;
  onSelect: (value: BillingPlanPriceInterval) => void;
}) {
  const select = useCallback(() => onSelect(value), [onSelect, value]);
  return (
    <Button
      type="button"
      size="sm"
      variant={active ? "default" : "ghost"}
      aria-pressed={active}
      onClick={select}
    >
      {label}
    </Button>
  );
}

function PlanCard({
  plan,
  interval,
  isCurrent,
  pending,
  onChoose,
}: {
  plan: PublicBillingPlan;
  interval: BillingPlanPriceInterval;
  isCurrent: boolean;
  pending: boolean;
  onChoose: (planSlug: string) => void;
}) {
  const price = plan.prices[interval];
  const choose = useCallback(() => onChoose(plan.slug), [onChoose, plan.slug]);
  return (
    <Card className="gap-4 py-4" aria-label={`${plan.name} plan`}>
      <CardHeader className="gap-1">
        <CardTitle className="flex items-center justify-between gap-2">
          <span>{plan.name}</span>
          {isCurrent && <Badge variant="secondary">Current</Badge>}
        </CardTitle>
        <CardDescription>{priceLabel(price, interval)}</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-2">
        <ul className="grid gap-1.5 text-sm text-muted-foreground">
          {plan.marketingFeatures.map((feature) => (
            <li key={feature} className="flex items-start gap-2">
              <Check aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-primary" />
              <span>{feature}</span>
            </li>
          ))}
        </ul>
      </CardContent>
      <CardFooter>
        <Button
          type="button"
          variant={isCurrent ? "outline" : "default"}
          className="w-full"
          disabled={isCurrent || pending || price === null}
          onClick={choose}
        >
          {isCurrent ? "Current plan" : `Choose ${plan.name}`}
        </Button>
      </CardFooter>
    </Card>
  );
}

/** A web-only dashboard, so a plain navigation to the Stripe (or fixture) URL is correct. */
function redirectTo(url: string): void {
  window.location.assign(url);
}

function priceLabel(
  price: PublicBillingPlan["prices"][BillingPlanPriceInterval],
  interval: BillingPlanPriceInterval,
): string {
  if (price === null) return "Not available";
  if (price.unitAmount === 0) return "Free";
  const amount = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: price.currency.toUpperCase(),
    minimumFractionDigits: 0,
  }).format(price.unitAmount / 100);
  return `${amount} / ${interval === "monthly" ? "month" : "year"}`;
}

function subscriptionStatusLabel(subscription: BillingOverviewView["subscription"]): string {
  if (subscription.planName === null) return "You're not on a plan yet.";
  if (subscription.cancelAtPeriodEnd && subscription.currentPeriodEnd !== null) {
    return `Cancels on ${formatDate(subscription.currentPeriodEnd)}.`;
  }
  if (subscription.currentPeriodEnd !== null) {
    return `Renews on ${formatDate(subscription.currentPeriodEnd)}.`;
  }
  return "Active subscription.";
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

function statusTone(status: string): StatusTone {
  if (status === "active" || status === "trialing") return "success";
  if (status === "past_due" || status === "unpaid" || status === "incomplete") return "warning";
  if (status === "canceled" || status === "incomplete_expired") return "neutral";
  return "neutral";
}

function statusText(status: string): string {
  return status
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function BillingLoading() {
  return (
    <section aria-label="Loading billing" aria-busy="true" className="grid gap-6">
      <Skeleton className="h-12 w-64" />
      <Skeleton className="h-48 w-full" />
    </section>
  );
}
