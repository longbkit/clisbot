import { useCallback, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Check, Sparkles } from "lucide-react";
import { Alert, AlertDescription } from "../../components/ui/alert.js";
import { Badge } from "../../components/ui/badge.js";
import { Button } from "../../components/ui/button.js";
import { Dialog, DialogContent, DialogTitle } from "../../components/ui/dialog.js";
import { cn } from "../../lib/utils.js";
import type { BillingPlanPriceInterval } from "../../db/types.js";
import type { PublicBillingPlan } from "../../server/runtime.js";
import { billingCheckout } from "./functions.js";
import {
  intervalLabel,
  offeredIntervals,
  planAction,
  planPrice,
  TRIAL_DAYS,
} from "./presentation.js";

type CheckoutResult = Awaited<ReturnType<typeof billingCheckout>>;

/**
 * The plan picker. It shows the offer and nothing else: the trial badge when one is available,
 * then a card per plan, then the action. There is no heading, no framing sentence, and no
 * interval control unless the catalog actually prices more than one interval — a customer who
 * has one thing to accept should not have to read past anything to accept it.
 *
 * The grid and the modal width are driven by how many plans the catalog publishes, so a future
 * second product lays out as a pair without a redesign.
 */
export function PlanDialog({
  plans,
  slug,
  currentPlanSlug,
  trialEligible,
  onClose,
}: {
  plans: readonly PublicBillingPlan[];
  slug: string;
  currentPlanSlug: string | null;
  trialEligible: boolean;
  onClose: () => void;
}) {
  const intervals = offeredIntervals(plans);
  const [interval, setInterval] = useState<BillingPlanPriceInterval>(intervals[0] ?? "monthly");
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
      <DialogContent
        aria-describedby={undefined}
        className={cn(
          "max-h-[calc(100dvh-2rem)] gap-0 overflow-y-auto p-0",
          dialogWidth(plans.length),
        )}
      >
        {/* Radix requires a title for the dialog to be announced. There is nothing on this
            surface a sighted customer needs a heading for, so it is read, not shown. */}
        <DialogTitle className="sr-only">Plan</DialogTitle>
        <div className="grid gap-5 p-6">
          {(trialEligible || intervals.length > 1) && (
            <div className="grid justify-items-center gap-5">
              {/* The badge reads the brand as text, so it uses `text-link`, not `text-primary` —
                  the fill colour only reaches 2.7:1 against this surface. See the palette note in
                  styles.css. */}
              {trialEligible && (
                <Badge
                  variant="secondary"
                  className="gap-1.5 px-3 py-1 text-link dark:bg-primary/15"
                >
                  <Sparkles aria-hidden="true" className="size-3" />
                  {TRIAL_DAYS} days free · No card required
                </Badge>
              )}
              {intervals.length > 1 && (
                <IntervalSwitch intervals={intervals} value={interval} onSelect={setInterval} />
              )}
            </div>
          )}
          <div className={cn("grid gap-3", planColumns(plans.length))}>
            {plans.map((plan) => (
              <PlanCard
                key={plan.slug}
                plan={plan}
                interval={interval}
                isCurrent={plan.slug === currentPlanSlug}
                trialEligible={trialEligible}
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
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** A centred segmented control, rendered only when the catalog prices more than one interval.
 * Deliberately content-width: it is a choice between two words, not a page-wide toolbar. */
function IntervalSwitch({
  intervals,
  value,
  onSelect,
}: {
  intervals: readonly BillingPlanPriceInterval[];
  value: BillingPlanPriceInterval;
  onSelect: (value: BillingPlanPriceInterval) => void;
}) {
  return (
    <div
      role="group"
      aria-label="Billing interval"
      className="inline-flex items-center gap-1 rounded-lg border bg-muted/50 p-1"
    >
      {intervals.map((interval) => (
        <IntervalOption
          key={interval}
          value={interval}
          active={interval === value}
          onSelect={onSelect}
        />
      ))}
    </div>
  );
}

function IntervalOption({
  value,
  active,
  onSelect,
}: {
  value: BillingPlanPriceInterval;
  active: boolean;
  onSelect: (value: BillingPlanPriceInterval) => void;
}) {
  const select = useCallback(() => onSelect(value), [onSelect, value]);
  return (
    <Button
      type="button"
      size="sm"
      variant="ghost"
      aria-pressed={active}
      onClick={select}
      className={cn(
        "min-w-24 px-4 text-muted-foreground hover:text-foreground",
        active && "bg-background text-foreground shadow-sm hover:bg-background",
      )}
    >
      {intervalLabel(value)}
    </Button>
  );
}

function PlanCard({
  plan,
  interval,
  isCurrent,
  trialEligible,
  pending,
  onChoose,
}: {
  plan: PublicBillingPlan;
  interval: BillingPlanPriceInterval;
  isCurrent: boolean;
  trialEligible: boolean;
  pending: boolean;
  onChoose: (planSlug: string) => void;
}) {
  const price = plan.prices[interval];
  const action = planAction({ planName: plan.name, price, isCurrent, trialEligible });
  const { amount, unit } = planPrice(price, interval);
  const choose = useCallback(() => onChoose(plan.slug), [onChoose, plan.slug]);

  return (
    <div className="flex flex-col rounded-xl border bg-card p-5 text-card-foreground">
      <div className="flex min-h-6 items-start justify-between gap-2">
        <h3 className="text-sm">{plan.name}</h3>
        {isCurrent && <Badge variant="secondary">Current</Badge>}
      </div>
      <p className="mt-3 text-3xl leading-none tracking-tight">{amount}</p>
      <p className="mt-1.5 text-xs text-muted-foreground">{unit}</p>
      {/* Stacked on a phone, the plan you are already on collapses to a marker: its feature list
          is the one thing on the screen nobody needs to read, and it costs a full scroll. */}
      <ul
        className={cn(
          "mt-5 grid flex-1 content-start gap-2 text-sm text-muted-foreground",
          isCurrent && "hidden sm:grid",
        )}
      >
        {plan.marketingFeatures.map((feature) => (
          <li key={feature} className="flex items-start gap-2">
            <Check aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-primary" />
            <span>{feature}</span>
          </li>
        ))}
      </ul>
      <Button
        type="button"
        aria-label={action.name}
        className="mt-6 w-full"
        disabled={action.disabled || pending}
        onClick={choose}
      >
        {action.label}
      </Button>
    </div>
  );
}

/** Two plans read as a pair, three as a row. More than three wrap rather than shrink to slivers. */
function planColumns(count: number): string {
  if (count <= 1) return "";
  if (count === 2) return "sm:grid-cols-2";
  if (count === 3) return "sm:grid-cols-3";
  return "sm:grid-cols-2";
}

function dialogWidth(count: number): string {
  if (count <= 1) return "sm:max-w-md";
  if (count === 2) return "sm:max-w-2xl";
  return "sm:max-w-3xl";
}

/** A web-only dashboard, so a plain navigation to the Stripe (or fixture) URL is correct. */
function redirectTo(url: string): void {
  window.location.assign(url);
}
