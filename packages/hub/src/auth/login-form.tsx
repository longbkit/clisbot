import { Button } from "../components/ui/button.js";
import { Field, FieldSet } from "../components/ui/field.js";
import { Input } from "../components/ui/input.js";
import { FormField } from "./form-field.js";
import type { FormEvent } from "react";

export function LoginForm({
  mode,
  busy,
  onSubmit,
  emailValue,
  emailReadOnly = false,
}: {
  mode: "signIn" | "signUp";
  busy: boolean;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  emailValue?: string;
  emailReadOnly?: boolean;
}) {
  const prefix = mode === "signIn" ? "sign-in" : "sign-up";
  const emailProps: {
    value?: string;
    defaultValue?: string;
    readOnly?: boolean;
  } = {};
  if (emailValue !== undefined) {
    if (emailReadOnly) {
      emailProps.value = emailValue;
      emailProps.readOnly = true;
    } else {
      emailProps.defaultValue = emailValue;
    }
  }
  return (
    <form
      method="post"
      onSubmit={onSubmit}
      aria-label={mode === "signIn" ? "Sign in" : "Create account"}
      aria-busy={busy}
    >
      <FieldSet className="gap-4" disabled={busy}>
        <Input type="hidden" name="mode" value={mode} />
        {mode === "signUp" && (
          <FormField label="Name" name="name" id={`${prefix}-name`} autoComplete="name" />
        )}
        <FormField
          label="Email"
          name="email"
          id={`${prefix}-email`}
          type="email"
          autoComplete="email"
          {...emailProps}
        />
        <FormField
          label="Password"
          name="password"
          id={`${prefix}-password`}
          type="password"
          autoComplete={mode === "signIn" ? "current-password" : "new-password"}
          minLength={12}
        />
        <Field>
          <Button type="submit" disabled={busy}>
            {mode === "signIn" ? "Sign in" : "Create account"}
          </Button>
        </Field>
      </FieldSet>
    </form>
  );
}
