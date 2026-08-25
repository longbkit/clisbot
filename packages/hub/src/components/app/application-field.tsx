import { Field, FieldDescription, FieldError, FieldLabel } from "../ui/field.js";
import { Input } from "../ui/input.js";
import { Textarea } from "../ui/textarea.js";

export type ApplicationFieldKind = "text" | "secret" | "multiline";

/**
 * One value the operator copies out of a provider's portal. Secrets are write-only: the server
 * never returns them, so a secret input is always empty on arrival rather than prefilled with a
 * mask that could be submitted back as if it were the real value.
 */
export function ApplicationField({
  id,
  name,
  label,
  kind,
  description,
  error,
  defaultValue,
  disabled,
}: {
  id: string;
  name: string;
  label: string;
  kind: ApplicationFieldKind;
  description?: string;
  error?: string;
  defaultValue?: string;
  disabled?: boolean;
}) {
  const describedBy = description === undefined ? undefined : `${id}-description`;
  const invalid = error !== undefined;
  const shared = {
    id,
    name,
    disabled,
    "aria-invalid": invalid,
    ...(describedBy === undefined ? {} : { "aria-describedby": describedBy }),
    ...(defaultValue === undefined ? {} : { defaultValue }),
  };
  return (
    <Field data-invalid={invalid}>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      {kind === "multiline" ? (
        <Textarea rows={4} spellCheck={false} {...shared} />
      ) : (
        <Input
          type={kind === "secret" ? "password" : "text"}
          autoComplete="off"
          spellCheck={false}
          {...shared}
        />
      )}
      {description === undefined ? null : (
        <FieldDescription id={describedBy}>{description}</FieldDescription>
      )}
      {error === undefined ? null : <FieldError>{error}</FieldError>}
    </Field>
  );
}
