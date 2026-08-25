import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useCallback, useState, type FormEvent } from "react";
import { AuthCard, AuthLayout } from "../components/app/auth-layout.js";
import { Button } from "../components/ui/button.js";
import { Field, FieldSet } from "../components/ui/field.js";
import { formValue } from "./account-actions.js";
import { ErrorSummary } from "./account-states.js";
import { FormField } from "./form-field.js";
import { setUpInstance } from "./functions.js";
import type { Result } from "../contract/respond.js";

type SetupResult = Result<{ state: "claimed" | "unavailable" }>;

/**
 * What a visitor sees on a Hub that has no accounts yet: an invitation to create one, instead of
 * a sign-in wall with nothing to sign in to. Nothing here explains instance state — if setup
 * closes while this form is open, the refreshed account state simply carries the visitor into the
 * ordinary sign-in flow, which is all they ever needed to know.
 */
export function InstanceSetupEntry() {
  const queryClient = useQueryClient();
  const [accountRequested, setAccountRequested] = useState(false);
  const claim = useMutation({
    mutationFn: useServerFn(setUpInstance) as (
      input: Parameters<typeof setUpInstance>[0],
    ) => Promise<SetupResult>,
    onSuccess: async (result) => {
      // The account state decides what comes next either way: the dashboard for the account this
      // browser just created, the ordinary account flow when there was nothing left to set up.
      if (result.status === "ok") await queryClient.invalidateQueries({ queryKey: ["account"] });
    },
  });
  const requestAccount = useCallback(() => setAccountRequested(true), []);
  const returnToWelcome = useCallback(() => {
    claim.reset();
    setAccountRequested(false);
  }, [claim]);
  const submit = useCallback(
    (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      const data = new FormData(event.currentTarget);
      claim.mutate({
        data: {
          email: formValue(data, "email"),
          password: formValue(data, "password"),
        },
      });
    },
    [claim],
  );

  if (!accountRequested) return <Welcome onBegin={requestAccount} />;
  let message: string | undefined;
  if (claim.data?.status === "error") message = claim.data.error.message;
  if (claim.isError)
    message =
      "Hub did not receive the account setup result. Check your connection and reload to confirm whether setup completed.";
  return (
    <AccountSetupForm
      // Stay busy through the account refetch, so the form cannot be resubmitted in the moment
      // between the server answering and the next screen arriving.
      busy={claim.isPending || claim.data?.status === "ok"}
      message={message}
      onSubmit={submit}
      onBack={returnToWelcome}
    />
  );
}

function Welcome({ onBegin }: { onBegin: () => void }) {
  return (
    <AuthLayout>
      <AuthCard
        titleId="welcome-heading"
        title="Welcome to Paseo Hub"
        description="Set up an account to start operating Paseo Hub."
      >
        <Button type="button" onClick={onBegin}>
          Set up Paseo Hub
        </Button>
      </AuthCard>
    </AuthLayout>
  );
}

function AccountSetupForm({
  busy,
  message,
  onSubmit,
  onBack,
}: {
  busy: boolean;
  message: string | undefined;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onBack: () => void;
}) {
  return (
    <AuthLayout>
      <AuthCard titleId="account-setup-heading" title="Create your account">
        <ErrorSummary message={message} />
        <form method="post" onSubmit={onSubmit} aria-label="Create your account" aria-busy={busy}>
          <FieldSet className="gap-4" disabled={busy}>
            <FormField
              label="Email"
              name="email"
              id="operator-email"
              type="email"
              autoComplete="email"
            />
            <FormField
              label="Password"
              name="password"
              id="operator-password"
              type="password"
              autoComplete="new-password"
              minLength={12}
            />
            <Field>
              <Button type="submit" disabled={busy}>
                Create account
              </Button>
            </Field>
          </FieldSet>
        </form>
        <Button type="button" variant="ghost" disabled={busy} onClick={onBack}>
          Back
        </Button>
      </AuthCard>
    </AuthLayout>
  );
}
