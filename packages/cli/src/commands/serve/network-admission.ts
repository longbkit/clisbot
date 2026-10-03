import { connectToDaemon } from "../../utils/client.js";
import { DEFAULT_APP_BASE_URL } from "@clisbot/protocol/connection-offer";
import { editPersistedConfig } from "@clisbot/server/configuration";

/** Update the existing policy live; forwarded public Host/Origin headers still reach daemon admission. */
export async function configureServingAdmission(home: string, origins: string[]): Promise<void> {
  const client = await connectToDaemon({ target: { kind: "instance", home } });
  try {
    const config = (await client.getDaemonConfig()).config;
    const hostnames =
      config.hostnames === true
        ? true
        : [
            ...new Set([
              ...(config.hostnames ?? []),
              ...origins.map((origin) => new URL(origin).hostname),
            ]),
          ];
    const allowedOrigins = [
      ...new Set([
        ...(config.cors?.allowedOrigins ?? []),
        ...origins,
        new URL(DEFAULT_APP_BASE_URL).origin,
      ]),
    ];
    // The foundation intentionally excludes network policy from ordinary config patch RPCs.
    // The local OS operator writes it and uses the existing live reload contract instead.
    editPersistedConfig(home, "daemon.hostnames", { value: hostnames });
    editPersistedConfig(home, "daemon.cors.allowedOrigins", { value: allowedOrigins });
    await client.reloadDaemonConfig();
    const applied = (await client.getDaemonConfig()).config;
    const appliedHostnames = applied.hostnames;
    if (
      appliedHostnames !== true &&
      !origins.every((origin) => appliedHostnames?.includes(new URL(origin).hostname))
    )
      throw new Error(
        "Daemon hostname policy is controlled by a launch override. Add the serving hostname to that policy and reload; no process was restarted.",
      );
    if (
      !applied.cors?.allowedOrigins?.includes("*") &&
      !allowedOrigins.every((origin) => applied.cors?.allowedOrigins?.includes(origin))
    )
      throw new Error(
        "Daemon Origin policy is controlled by a launch override. Add the serving and app origins to that policy and reload; no process was restarted.",
      );
  } finally {
    await client.close();
  }
}
