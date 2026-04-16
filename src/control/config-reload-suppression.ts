const suppressedReloads = new Map<string, number[]>();
const MTIME_MATCH_EPSILON_MS = 1;

function normalizeConfigPath(configPath: string) {
  return configPath.trim();
}

export function suppressConfigReload(configPath: string, mtimeMs: number) {
  const normalizedPath = normalizeConfigPath(configPath);
  if (!normalizedPath || !Number.isFinite(mtimeMs)) {
    return;
  }

  const existing = suppressedReloads.get(normalizedPath) ?? [];
  existing.push(mtimeMs);
  suppressedReloads.set(normalizedPath, existing);
}

export function consumeSuppressedConfigReload(configPath: string, mtimeMs: number) {
  const normalizedPath = normalizeConfigPath(configPath);
  if (!normalizedPath || !Number.isFinite(mtimeMs)) {
    return false;
  }

  const existing = suppressedReloads.get(normalizedPath);
  if (!existing || existing.length === 0) {
    return false;
  }

  const next = existing.filter((candidate) => Math.abs(candidate - mtimeMs) > MTIME_MATCH_EPSILON_MS);
  const matched = next.length !== existing.length;
  if (next.length === 0) {
    suppressedReloads.delete(normalizedPath);
  } else {
    suppressedReloads.set(normalizedPath, next);
  }
  return matched;
}

export function resetConfigReloadSuppressionForTests() {
  suppressedReloads.clear();
}
