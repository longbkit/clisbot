import { z } from "zod";
import type { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import type { ControlPlaneTarget } from "../control-plane.js";
import { requestHub } from "../hub/hub-client/internal/transport.js";

export function isOnboardingEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return !["0", "false", "off", "no"].includes(
    (env.CLISBOT_ONBOARDING_ENABLED ?? "1").trim().toLowerCase(),
  );
}

/** Local operator authority issues a short-lived enrollment token; no durable API key is minted. */
export async function connectOnboardingDaemon(
  target: ControlPlaneTarget,
  client: DaemonClient,
  ownerEmail?: string,
) {
  const current = (await client.getHubStatus()).status;
  if (current.hubOrigin && new URL(current.hubOrigin).origin !== new URL(target.origin).origin) {
    throw new Error(
      "This daemon is connected to another Hub. Select its home or disconnect it before onboarding here.",
    );
  }
  const setup = await requestHub({
    origin: target.origin,
    path: "/api/v1/channels",
    method: "PUT",
    ...(target.apiKey ? { apiKey: target.apiKey } : {}),
    body: ownerEmail ? { ownerEmail } : {},
    successStatus: 200,
    schema: z.object({
      organizationId: z.string(),
      ownerEmail: z.string(),
      enrollmentToken: z.string(),
    }),
    failureMessage: "Local Account setup is incomplete",
  });
  if (!current.hubOrigin)
    await client.connectHub(target.origin, setup.enrollmentToken, ["hub.execute"]);
  else if (!current.permissions.includes("hub.execute"))
    await client.updateHubPermissions({ grant: ["hub.execute"] });
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    const status = (await client.getHubStatus()).status;
    if (status.state === "connected" && status.daemonId)
      return { daemonId: status.daemonId, ownerEmail: setup.ownerEmail };
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  const status = (await client.getHubStatus()).status;
  throw new Error(
    `Daemon enrollment is still pending${status.lastError ? `: ${status.lastError}` : ""}. Check hub status and rerun onboarding.`,
  );
}
