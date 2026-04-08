const ENV_VAR_NAME_PATTERN = /^[A-Z_][A-Z0-9_]*$/;

export function normalizeEnvReference(reference?: string) {
  const trimmed = reference?.trim();
  if (!trimmed) {
    return undefined;
  }

  if (ENV_VAR_NAME_PATTERN.test(trimmed)) {
    return `\${${trimmed}}`;
  }

  return trimmed;
}

export function extractEnvReferenceName(reference?: string) {
  const trimmed = reference?.trim();
  if (!trimmed) {
    return null;
  }

  if (ENV_VAR_NAME_PATTERN.test(trimmed)) {
    return trimmed;
  }

  const match = trimmed.match(/^\$\{([A-Z_][A-Z0-9_]*)\}$/);
  if (match) {
    return match[1];
  }

  const escapedMatch = trimmed.match(/^\$\$\{([A-Z_][A-Z0-9_]*)\}$/);
  if (escapedMatch) {
    return escapedMatch[1];
  }

  return null;
}

export function hasEnvReferenceValue(
  reference: string | undefined,
  env: NodeJS.ProcessEnv = process.env,
) {
  const name = extractEnvReferenceName(reference);
  return Boolean(name && env[name]?.trim());
}

export function describeEnvReference(
  reference: string | undefined,
  fallbackName: string,
  env: NodeJS.ProcessEnv = process.env,
) {
  const normalized = normalizeEnvReference(reference);
  const name = extractEnvReferenceName(normalized) || fallbackName;
  const hasValue = Boolean(env[name]?.trim());
  return {
    reference: normalized ?? `\${${fallbackName}}`,
    envName: name,
    hasValue,
  };
}
