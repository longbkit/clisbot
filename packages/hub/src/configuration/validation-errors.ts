import { z } from "zod";

const storedValidationErrorsSchema = z.object({
  formErrors: z.array(z.string()),
  fieldErrors: z.record(z.string(), z.array(z.string())).optional(),
  issues: z
    .array(
      z.object({
        path: z.array(z.union([z.string(), z.number()])),
        message: z.string(),
      }),
    )
    .optional(),
});

export type ConfigurationValidationErrors = z.infer<typeof storedValidationErrorsSchema>;

export function configurationValidationErrors(error: z.ZodError): ConfigurationValidationErrors {
  const flattened = z.flattenError(error);
  return {
    formErrors: flattened.formErrors,
    fieldErrors: flattened.fieldErrors,
  };
}

/** Prompt partial bundle rejections, stored in the same shape as schema failures. */
export function promptPartialValidationErrors(
  issues: readonly { path: readonly (string | number)[]; message: string }[],
): ConfigurationValidationErrors {
  return {
    formErrors: issues.map((issue) =>
      issue.path.length === 0 ? issue.message : `${issue.path.join(".")}: ${issue.message}`,
    ),
  };
}

export function configurationValidationMessages(errors: unknown): string[] {
  const parsed = storedValidationErrorsSchema.safeParse(errors);
  if (!parsed.success) return ["Configuration validation failed."];
  const messages = [
    ...parsed.data.formErrors,
    ...Object.entries(parsed.data.fieldErrors ?? {}).flatMap(([field, failures]) =>
      failures.map((failure) => `${field}: ${failure}`),
    ),
    ...(parsed.data.issues ?? []).map(({ path, message }) =>
      path.length === 0 ? message : `${path.join(".")}: ${message}`,
    ),
  ].map(sentenceCase);
  return messages.length === 0 ? ["Configuration validation failed."] : messages;
}

export function configurationValidationIssues(
  errors: unknown,
): readonly { path: readonly (string | number)[]; message: string }[] {
  const parsed = storedValidationErrorsSchema.safeParse(errors);
  if (!parsed.success) return [{ path: [], message: "Configuration validation failed." }];
  return [
    ...(parsed.data.issues ?? []),
    ...parsed.data.formErrors.map((message) => ({ path: [] as readonly string[], message })),
    ...Object.entries(parsed.data.fieldErrors ?? {}).flatMap(([field, failures]) =>
      failures.map((message) => ({ path: [field] as readonly string[], message })),
    ),
  ];
}

function sentenceCase(message: string): string {
  return message.length === 0 ? message : `${message[0]!.toUpperCase()}${message.slice(1)}`;
}
