import { servicesForMode } from "./clisbot-container.mjs";

const services = servicesForMode(process.env.CLISBOT_RUN_MODE ?? "daemon");
const daemonPort = process.env.CLISBOT_LISTEN?.match(/:(\d+)$/)?.[1] ?? "6868";
const hubPort = process.env.PORT ?? "6870";
await Promise.all(
  services.map(async (service) => {
    const path = service === "daemon" ? `${daemonPort}/api/health` : `${hubPort}/health`;
    const response = await fetch(`http://127.0.0.1:${path}`, {
      signal: AbortSignal.timeout(3_000),
    });
    if (!response.ok) throw new Error(`${service} health check failed: ${response.status}`);
  }),
);
