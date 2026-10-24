import { resolve } from "path";

function isTruthyEnv(value: string | undefined): boolean {
  const normalized = (value ?? "").trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on";
}

export function isClisbotDictationDebugEnabled(): boolean {
  return isTruthyEnv(process.env.CLISBOT_DICTATION_DEBUG);
}

export function resolveRecordingsDebugDir(explicitEnvVarName: string): string | null {
  const explicit = process.env[explicitEnvVarName];
  if (explicit && explicit.trim()) {
    return resolve(explicit.trim());
  }

  if (!isClisbotDictationDebugEnabled()) {
    return null;
  }

  return resolve(process.cwd(), ".debug/recordings");
}
