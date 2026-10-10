/** @param {number} port */
export async function warmMetro(port) {
  const origin = `http://127.0.0.1:${port}`;
  const configuredTimeout = process.env.E2E_METRO_WARMUP_TIMEOUT_MS;
  // A cold CI compile can take two minutes before the bundle starts transferring.
  const warmupTimeoutMs = configuredTimeout === undefined ? 240_000 : Number(configuredTimeout);
  if (
    !Number.isSafeInteger(warmupTimeoutMs) ||
    warmupTimeoutMs < 1_000 ||
    warmupTimeoutMs > 600_000
  ) {
    throw new Error("E2E_METRO_WARMUP_TIMEOUT_MS must be an integer from 1000 through 600000");
  }
  const documentResponse = await fetch(origin, { signal: AbortSignal.timeout(warmupTimeoutMs) });
  if (!documentResponse.ok) {
    throw new Error(`Metro document warmup failed with HTTP ${documentResponse.status}`);
  }
  const document = await documentResponse.text();
  const scriptSources = [...document.matchAll(/<script[^>]+src=["']([^"']+)["']/g)].map(
    (match) => match[1],
  );
  if (scriptSources.length === 0) {
    throw new Error("Metro document warmup found no scripts to compile");
  }
  for (const source of scriptSources) {
    const scriptUrl = new URL(source, origin);
    if (scriptUrl.origin !== origin) continue;
    const response = await fetch(scriptUrl, { signal: AbortSignal.timeout(warmupTimeoutMs) });
    if (!response.ok) {
      throw new Error(
        `Metro bundle warmup failed for ${scriptUrl.pathname}: HTTP ${response.status}`,
      );
    }
    await response.arrayBuffer();
  }
}
