import { useEffect, useRef } from "react";
import { AuthCard, AuthLayout, ProductMark } from "../components/app/auth-layout.js";
import { Alert, AlertDescription } from "../components/ui/alert.js";
import { Button } from "../components/ui/button.js";
import { Skeleton } from "../components/ui/skeleton.js";

export function ErrorSummary({ message }: { message: string | undefined }) {
  const alert = useRef<HTMLDivElement>(null);
  // Submitting disables the form, which blurs the button that was focused, so on failure focus
  // would land on the document body. Take it to the message instead: the user hears what went
  // wrong and tabs straight back into the fields they need to fix.
  useEffect(() => {
    if (message !== undefined) alert.current?.focus();
  }, [message]);
  return message === undefined ? null : (
    <Alert ref={alert} tabIndex={-1} variant="destructive" className="mb-6 outline-none">
      <AlertDescription>{message}</AlertDescription>
    </Alert>
  );
}

/**
 * Rendered while the account is still unknown — including every server render, which
 * has not yet resolved the session. It must not resolve the question it is waiting on:
 * showing a sign-in card here tells a signed-in user they are signed out.
 */
export function LoadingEntry() {
  return (
    <main
      aria-label="Loading Paseo Hub"
      aria-busy="true"
      className="flex min-h-svh flex-col items-center justify-center gap-6 bg-background p-6"
    >
      <ProductMark />
      <Skeleton className="h-1 w-40" />
    </main>
  );
}

export function FailedEntry({ message }: { message: string }) {
  return (
    <AuthLayout>
      <AuthCard title="Sign in to Paseo Hub">
        <Alert variant="destructive">
          <AlertDescription>{message}</AlertDescription>
        </Alert>
      </AuthCard>
    </AuthLayout>
  );
}

export function UnavailableInvitation({ message }: { message: string | undefined }) {
  return (
    <AuthLayout>
      <AuthCard
        title="Invitation unavailable"
        description="This link is invalid, expired, already used, or belongs to another account."
      >
        {message === undefined ? null : (
          <Alert variant="destructive">
            <AlertDescription>{message}</AlertDescription>
          </Alert>
        )}
        <Button asChild>
          <a href="/">Continue to Paseo Hub</a>
        </Button>
      </AuthCard>
    </AuthLayout>
  );
}
