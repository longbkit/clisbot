import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from "react";
import { AuthCard, AuthLayout } from "../components/app/auth-layout.js";
import { Alert, AlertDescription } from "../components/ui/alert.js";
import { Button } from "../components/ui/button.js";
import { Field, FieldSet } from "../components/ui/field.js";
import { formValue } from "./account-actions.js";
import { ErrorSummary } from "./account-states.js";
import { FormField } from "./form-field.js";
import { PASSWORD_MIN_LENGTH } from "./instance-policy.js";
import {
  EMAIL_REGISTRATION_PATHS,
  EMAIL_REGISTRATION_QUERY_PARAMETER,
  REGISTRATION_ERROR_CODES,
  type RegistrationErrorCode,
  type RegistrationLinkStatus,
} from "./registration-contract.js";

/** Messages for the `?error=` code Better Auth appends when a Google sign-in is refused. */
const SIGN_IN_ERROR_MESSAGES: Record<RegistrationErrorCode, string> = {
  [REGISTRATION_ERROR_CODES.closed]:
    "This Google account isn't admitted to this Hub. Use an invited address or an allowed company domain.",
  [REGISTRATION_ERROR_CODES.googleEmailUnverified]:
    "Google hasn't verified this email address, so Hub can't use it to sign in.",
  [REGISTRATION_ERROR_CODES.identityLinkedElsewhere]:
    "This Google account is linked to a different Hub account. Ask the Hub operator to recover it.",
  [REGISTRATION_ERROR_CODES.googleProfileUnavailable]:
    "Google didn't return the profile Hub needs. Try signing in with Google again.",
  [REGISTRATION_ERROR_CODES.instanceUnavailable]:
    "This Hub was already set up by someone else. Sign in with your account instead.",
  [REGISTRATION_ERROR_CODES.linkRefused]:
    "Hub doesn't link Google to this account automatically. Sign in with your password.",
};

/** The refused-Google-sign-in message, shown only until the user submits the form themselves. */
export function readSignInError(untouched: boolean): string | undefined {
  if (!untouched || typeof window === "undefined") return undefined;
  const code = new URLSearchParams(window.location.search).get("error");
  if (code === null) return undefined;
  return (
    SIGN_IN_ERROR_MESSAGES[code as RegistrationErrorCode] ??
    "Hub couldn't complete the sign-in. Try again."
  );
}

export function readRegistrationToken(): string | undefined {
  if (typeof window === "undefined") return undefined;
  const token = new URLSearchParams(window.location.search).get(EMAIL_REGISTRATION_QUERY_PARAMETER);
  return token ?? undefined;
}

/** Starts Google sign-in and returns the browser to this page, keeping any invitation or client
 * authorization query so the existing gates continue after the callback. */
export function GoogleSignInButton({
  enabled,
  invitationId,
  disabled,
  claimInstance = false,
}: {
  enabled: boolean;
  invitationId: string | undefined;
  disabled: boolean;
  /** First-run setup: the Google account becomes the instance's first operator. */
  claimInstance?: boolean;
}) {
  const [starting, setStarting] = useState(false);
  const [failed, setFailed] = useState(false);
  const start = useCallback(async () => {
    setStarting(true);
    setFailed(false);
    const url = await requestGoogleAuthorizationUrl(invitationId, claimInstance);
    if (url === undefined) {
      setStarting(false);
      setFailed(true);
      return;
    }
    window.location.assign(url);
  }, [claimInstance, invitationId]);
  if (!enabled) return null;
  return (
    <div className="mb-4 grid gap-2">
      {failed ? <ErrorSummary message="Hub couldn't start Google sign-in. Try again." /> : null}
      <Button
        type="button"
        variant={claimInstance ? "default" : "outline"}
        disabled={disabled || starting}
        onClick={start}
      >
        Continue with Google
      </Button>
    </div>
  );
}

async function requestGoogleAuthorizationUrl(
  invitationId: string | undefined,
  claimInstance: boolean,
): Promise<string | undefined> {
  const returnTo = new URL(window.location.href);
  returnTo.searchParams.delete("error");
  const response = await postJson("/api/auth/sign-in/social", {
    provider: "google",
    callbackURL: `${returnTo.pathname}${returnTo.search}`,
    ...(invitationId === undefined ? {} : { invitation: invitationId }),
    ...(claimInstance ? { intent: "claimInstance" } : {}),
  });
  const url = response?.ok === true ? response.body["url"] : undefined;
  return typeof url === "string" ? url : undefined;
}

const START_MESSAGES: Record<number, { tone: "default" | "destructive"; text: string }> = {
  202: {
    tone: "default",
    text: "If this address can register, a sign-up link is on its way. It works once and expires in 30 minutes.",
  },
  403: {
    tone: "destructive",
    text: "This email's domain can't register here. Ask an organization owner to invite you.",
  },
  429: {
    tone: "destructive",
    text: "A link was sent recently. Check your inbox, or try again in a minute.",
  },
  502: { tone: "destructive", text: "Hub couldn't send the email. Try again in a minute." },
  503: {
    tone: "destructive",
    text: "This Hub can't send email yet. Ask the Hub operator to configure email delivery.",
  },
};

const START_FAILED = {
  tone: "destructive",
  text: "Hub couldn't start registration. Try again.",
} as const;

/** Email-first sign-up: only the address is asked for here; the password is chosen on the page
 * the emailed link opens, so nobody can pre-register an address they don't control. */
export function EmailRegistrationStart({ disabled }: { disabled: boolean }) {
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<number | undefined>(undefined);
  const submit = useCallback(async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const email = formValue(new FormData(event.currentTarget), "email");
    setSending(true);
    const response = await postJson(EMAIL_REGISTRATION_PATHS.start, { email });
    setResult(response?.status ?? 0);
    setSending(false);
  }, []);
  const notice = result === undefined ? undefined : (START_MESSAGES[result] ?? START_FAILED);
  return (
    <form method="post" onSubmit={submit} aria-label="Create account" aria-busy={sending}>
      <FieldSet className="gap-4" disabled={disabled || sending}>
        {notice === undefined ? null : (
          <Alert variant={notice.tone}>
            <AlertDescription>{notice.text}</AlertDescription>
          </Alert>
        )}
        <FormField
          label="Work email"
          name="email"
          id="register-email"
          type="email"
          autoComplete="email"
        />
        <Field>
          <Button type="submit">Email me a sign-up link</Button>
        </Field>
      </FieldSet>
    </form>
  );
}

type LinkView =
  | { status: "loading" }
  | { status: "valid"; email: string }
  | { status: Exclude<RegistrationLinkStatus, "valid"> | "failed" };

type FinishedStatus = Exclude<LinkView["status"], "loading" | "valid">;

const LINK_MESSAGES: Record<FinishedStatus, string> = {
  registered: "Your account is ready.",
  invalid: "This sign-up link isn't valid.",
  expired: "This sign-up link has expired. Request a new one from the sign-in page.",
  used: "This sign-up link was already used. Sign in, or request a new link.",
  already_registered: "An account already uses this email. Sign in instead.",
  registration_closed:
    "This Hub no longer admits this email. Ask an organization owner to invite you.",
  failed: "Hub couldn't finish creating your account. Try the link again.",
};

/** The page a registration link opens: choose a name and password, then Hub creates, admits, and
 * signs in the account. Opening the page never consumes the link. */
export function EmailRegistrationComplete({ token }: { token: string }) {
  const [view, setView] = useState<LinkView>({ status: "loading" });
  const [submitting, setSubmitting] = useState(false);
  useEffect(() => {
    // Keep the single-use token out of history, bookmarks, and referrers once it is read.
    const url = new URL(window.location.href);
    url.searchParams.delete(EMAIL_REGISTRATION_QUERY_PARAMETER);
    window.history.replaceState(window.history.state, "", url);
    void inspectLink(token).then(setView);
  }, [token]);
  const submit = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      setSubmitting(true);
      const next = await completeRegistration(token, new FormData(event.currentTarget));
      if (next.status === "registered") {
        window.location.assign("/");
        return;
      }
      setView(next);
      setSubmitting(false);
    },
    [token],
  );
  if (view.status === "loading") return <RegistrationCard>{null}</RegistrationCard>;
  if (view.status === "valid") {
    return (
      <RegistrationCard description={view.email}>
        <ChoosePasswordForm email={view.email} busy={submitting} onSubmit={submit} />
      </RegistrationCard>
    );
  }
  return (
    <RegistrationCard>
      <Alert variant={view.status === "registered" ? "default" : "destructive"} className="mb-4">
        <AlertDescription>{LINK_MESSAGES[view.status]}</AlertDescription>
      </Alert>
      <Button type="button" onClick={returnToSignIn}>
        Continue to sign in
      </Button>
    </RegistrationCard>
  );
}

function ChoosePasswordForm({
  email,
  busy,
  onSubmit,
}: {
  email: string;
  busy: boolean;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  return (
    <form method="post" onSubmit={onSubmit} aria-label="Finish creating account" aria-busy={busy}>
      <FieldSet className="gap-4" disabled={busy}>
        <FormField label="Email" id="registration-email" value={email} readOnly />
        <FormField label="Name" name="name" id="registration-name" autoComplete="name" />
        <FormField
          label="Password"
          name="password"
          id="registration-password"
          type="password"
          autoComplete="new-password"
          minLength={PASSWORD_MIN_LENGTH}
        />
        <Field>
          <Button type="submit">Create account</Button>
        </Field>
      </FieldSet>
    </form>
  );
}

function RegistrationCard({
  description = "Finish creating your Paseo Hub account.",
  children,
}: {
  description?: string;
  children: ReactNode;
}) {
  return (
    <AuthLayout>
      <AuthCard title="Create your account" description={description}>
        {children}
      </AuthCard>
    </AuthLayout>
  );
}

async function inspectLink(token: string): Promise<LinkView> {
  const response = await postJson(EMAIL_REGISTRATION_PATHS.inspect, { token });
  const status = response?.body["status"];
  const email = response?.body["email"];
  if (status === "valid" && typeof email === "string") return { status, email };
  return { status: finishedStatus(status) };
}

async function completeRegistration(token: string, data: FormData): Promise<LinkView> {
  const response = await postJson(EMAIL_REGISTRATION_PATHS.complete, {
    token,
    name: formValue(data, "name"),
    password: formValue(data, "password"),
  });
  return { status: finishedStatus(response?.body["status"]) };
}

function finishedStatus(value: unknown): FinishedStatus {
  return typeof value === "string" && value in LINK_MESSAGES ? (value as FinishedStatus) : "failed";
}

async function postJson(
  path: string,
  body: object,
): Promise<{ ok: boolean; status: number; body: Record<string, unknown> } | undefined> {
  try {
    const response = await fetch(path, {
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const parsed: unknown = await response.json().catch(() => ({}));
    const record = typeof parsed === "object" && parsed !== null ? parsed : {};
    return { ok: response.ok, status: response.status, body: record as Record<string, unknown> };
  } catch {
    return undefined;
  }
}

function returnToSignIn(): void {
  window.location.assign("/");
}
