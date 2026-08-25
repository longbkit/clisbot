import type { HubConfig } from "../../config/index.js";

export const SMOKE_CONFIG: HubConfig = {
  environments: [{ name: "smoke", kind: "daemon", daemon: "smoke", cwd: "/workspace" }],
  triggers: [],
};
