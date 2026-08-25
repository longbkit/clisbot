import { Input } from "../components/ui/input.js";
import { Field, FieldLabel } from "../components/ui/field.js";

export interface FormFieldProps {
  label: string;
  id: string;
  name?: string;
  type?: string;
  autoComplete?: string;
  minLength?: number;
  readOnly?: boolean;
  required?: boolean;
  value?: string;
}

export function FormField({ label, required = true, ...input }: FormFieldProps) {
  return (
    <Field>
      <FieldLabel htmlFor={input.id}>{label}</FieldLabel>
      <Input {...input} required={required} />
    </Field>
  );
}
