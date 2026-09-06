/** Clisbot rollout boundary; disabled keeps the inherited provisioning contract. */
export function apiFirstOnboardingEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return !["0", "false", "off", "no"].includes(
    (env["CLISBOT_ONBOARDING_ENABLED"] ?? "1").trim().toLowerCase(),
  );
}
