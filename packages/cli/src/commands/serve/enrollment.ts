import { connectToDaemon } from "../../utils/client.js";
import { localHubDeviceRequest } from "../hub/device-pairing.js";
import { DEFAULT_HUB_CONNECTION_PERMISSIONS } from "../hub/permissions.js";

export async function enrollPersonalDaemon(
  home: string,
  hubOrigin: string,
): Promise<"connected" | "account-approval-required"> {
  const client = await connectToDaemon({ target: { kind: "instance", home } });
  try {
    const current = (await client.getHubStatus()).status;
    if (current.hubOrigin) {
      if (current.hubOrigin !== hubOrigin)
        throw new Error(
          `This daemon belongs to ${current.hubOrigin}. Disconnect it explicitly before changing Hub.`,
        );
      if (current.state === "revoked")
        throw new Error(
          "This daemon's Hub enrollment was revoked; disconnect it before enrolling again",
        );
      return "connected";
    }
    if (await hubLoginRequired(hubOrigin)) return "account-approval-required";
    const value = (await localHubDeviceRequest(home, "/enrollment-token", "POST")) as {
      token: string;
    };
    await client.connectHub(hubOrigin, value.token, DEFAULT_HUB_CONNECTION_PERMISSIONS);
    const deadline = Date.now() + 15_000;
    while (Date.now() < deadline) {
      const status = (await client.getHubStatus()).status;
      if (status.state === "connected") return "connected";
      if (status.state === "revoked") throw new Error("Hub refused this daemon's enrollment");
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    throw new Error(
      "Daemon enrollment is pending; retry clisbot hub start --personal after inspecting daemon.log and hub.log",
    );
  } finally {
    await client.close();
  }
}

async function hubLoginRequired(origin: string): Promise<boolean> {
  const response = await fetch(new URL("/api/auth/clisbot/device/identity", origin), {
    signal: AbortSignal.timeout(5_000),
  });
  const policy = (await response.json()) as { loginRequired?: boolean };
  if (!response.ok || typeof policy.loginRequired !== "boolean")
    throw new Error("Hub did not provide its account login policy; no enrollment was attempted");
  return policy.loginRequired;
}
