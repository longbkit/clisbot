// upstream: src/infra/env.ts@5d8067a4483
// D-CORE-234: upstream's env module also owns the test-runtime detection, the
// lazy config-dir resolvers and the UTF-16 safe env slicing. Only the truthy
// reader the ported channel code calls is carried, with upstream's semantics.
const TRUTHY = new Set(["1", "true", "yes", "on"]);

/** True for "1", "true", "yes", "on" (case-insensitive); false otherwise. */
export function isTruthyEnvValue(value: string | undefined | null): boolean {
  return TRUTHY.has((value ?? "").trim().toLowerCase());
}
