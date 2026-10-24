import type { ProviderClisbotToolsPolicy } from "@clisbot/protocol/provider-config";

interface ProviderClisbotToolSettings {
  clisbotTools?: ProviderClisbotToolsPolicy;
}

export function resolveClisbotToolPolicy(
  providerId: string,
  providerSettings: Readonly<Record<string, ProviderClisbotToolSettings>> | undefined,
): ProviderClisbotToolsPolicy | undefined {
  return providerSettings?.[providerId]?.clisbotTools;
}

export function isClisbotToolEnabled(
  policy: ProviderClisbotToolsPolicy | undefined,
  toolName: string,
): boolean {
  if (toolName === "speak") {
    return true;
  }
  if (!isClisbotToolPolicyEnabled(policy)) {
    return false;
  }
  return !policy?.disabledTools?.includes(toolName);
}

export function isClisbotToolPolicyEnabled(
  policy: ProviderClisbotToolsPolicy | undefined,
): boolean {
  return policy?.enabled !== false;
}
