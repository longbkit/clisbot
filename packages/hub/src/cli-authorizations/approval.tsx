import { useMutation, useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useCallback, useState, type FormEvent, type ReactNode } from "react";
import { AuthCard } from "../components/app/auth-layout.js";
import { Alert, AlertDescription, AlertTitle } from "../components/ui/alert.js";
import { Button } from "../components/ui/button.js";
import { Field, FieldDescription, FieldLabel } from "../components/ui/field.js";
import { Input } from "../components/ui/input.js";
import { Skeleton } from "../components/ui/skeleton.js";
import type { Result } from "../contract/respond.js";
import { decideCliAuthorization, inspectCliAuthorization } from "./functions.js";

export function CliLoginApproval({ accountId, organizationId }: ApprovalIdentity) {
  const [code, setCode] = useState(() =>
    typeof window === "undefined"
      ? undefined
      : (new URLSearchParams(window.location.search).get("code") ?? undefined),
  );
  const inspect = useServerFn(inspectCliAuthorization);
  const snapshot = useQuery({
    queryKey: ["cli-authorization", accountId, organizationId, code],
    queryFn: () => inspect({ data: { userCode: code! } }),
    enabled: code !== undefined,
  });
  const decide = useMutation({
    mutationKey: ["cli-authorization-decision"],
    mutationFn: useServerFn(decideCliAuthorization) as (
      input: Parameters<typeof decideCliAuthorization>[0],
    ) => Promise<Result<{ decision: "approved" | "denied" }>>,
  });
  const submitDecision = useCallback(
    (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      if (snapshot.data?.status !== "ok" || code === undefined) return;
      const submitter = "submitter" in event.nativeEvent ? event.nativeEvent.submitter : undefined;
      const decision =
        submitter instanceof HTMLButtonElement && submitter.value === "deny" ? "deny" : "approve";
      decide.mutate({
        data: {
          userCode: code,
          decision,
          organizationId: snapshot.data.data.organization.id,
        },
      });
    },
    [code, decide, snapshot.data],
  );

  if (code !== undefined && snapshot.isPending) return <Loading />;
  if (snapshot.isError || snapshot.data?.status === "error") {
    return (
      <Centered>
        <Alert variant="destructive">
          <AlertTitle>CLI login unavailable</AlertTitle>
          <AlertDescription>
            {snapshot.data?.status === "error"
              ? snapshot.data.error.message
              : "This CLI login request is unavailable or expired."}
          </AlertDescription>
        </Alert>
      </Centered>
    );
  }
  if (decide.data?.status === "ok") {
    return (
      <Centered>
        <AuthCard
          title={`CLI login ${decide.data.data.decision}`}
          description="You can close this window and return to the terminal."
        >
          <p role="status">The terminal has received the decision.</p>
        </AuthCard>
      </Centered>
    );
  }
  if (code === undefined || snapshot.data === undefined) return <CodeEntry onCode={setCode} />;
  const request = snapshot.data.data;
  let message: string | undefined;
  if (decide.data?.status === "error") message = decide.data.error.message;
  else if (decide.isError)
    message =
      "Hub did not receive this CLI login decision. Check your connection and confirm the request is still active.";
  return (
    <Centered>
      <AuthCard
        titleId="approval-heading"
        title="Approve CLI login"
        description="Grant this terminal durable access to one organization."
      >
        <div className="grid gap-1 rounded-md border px-3 py-2.5 text-sm">
          <span className="text-muted-foreground">Organization receiving access</span>
          <span className="text-foreground">{request.organization.name}</span>
        </div>
        {request.canManage ? (
          <form className="grid gap-6" onSubmit={submitDecision} aria-label="Approve CLI login">
            <p className="text-muted-foreground text-sm">
              The credential can list projects, validate and install configuration, enroll daemons,
              and dispatch manual runs for this organization until revoked.
            </p>
            {message === undefined ? null : (
              <Alert variant="destructive">
                <AlertDescription>{message}</AlertDescription>
              </Alert>
            )}
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <Button
                type="submit"
                name="decision"
                value="deny"
                variant="outline"
                disabled={decide.isPending}
              >
                Deny
              </Button>
              <Button type="submit" name="decision" value="approve" disabled={decide.isPending}>
                Approve CLI login
              </Button>
            </div>
          </form>
        ) : (
          <Alert>
            <AlertTitle>Approval required</AlertTitle>
            <AlertDescription>
              Switch to an organization where you are an owner or admin, then reopen the login URL.
            </AlertDescription>
          </Alert>
        )}
      </AuthCard>
    </Centered>
  );
}

interface ApprovalIdentity {
  accountId: string;
  organizationId: string;
}

function CodeEntry({ onCode }: { onCode: (code: string) => void }) {
  const submit = useCallback(
    (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      const code = new FormData(event.currentTarget).get("code");
      if (typeof code !== "string") return;
      window.history.replaceState({}, "", `/cli-login?code=${encodeURIComponent(code)}`);
      onCode(code);
    },
    [onCode],
  );
  return (
    <Centered>
      <AuthCard title="Log in the Paseo CLI" description="Enter the code shown in your terminal.">
        <form className="grid gap-6" onSubmit={submit}>
          <Field>
            <FieldLabel htmlFor="cli-login-code">Verification code</FieldLabel>
            <Input id="cli-login-code" name="code" autoComplete="one-time-code" required />
            <FieldDescription>Only approve a code you requested yourself.</FieldDescription>
          </Field>
          <Button type="submit">Continue</Button>
        </form>
      </AuthCard>
    </Centered>
  );
}

function Loading() {
  return (
    <section aria-label="Loading CLI login" className="grid gap-6">
      <Skeleton className="h-12 w-64" />
      <Skeleton className="h-64 w-full" />
    </section>
  );
}

function Centered({ children }: { children: ReactNode }) {
  return <div className="mx-auto w-full max-w-lg py-8">{children}</div>;
}
