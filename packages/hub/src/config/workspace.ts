import type { EnvironmentConfig, ResolvedHubConfig } from "./index.js";

export type Sidecar = never;

export interface WorkspacePlan {
  repos: WorkspaceRepoPlan[];
  cwd: string;
  sidecars: Sidecar[];
}

export interface WorkspaceRepoPlan {
  repo: string;
  path: string;
  branch: string | null;
  setup: string[];
}

export function planWorkspace(input: {
  resolved: ResolvedHubConfig;
  environmentName?: string;
}): WorkspacePlan {
  const environment = selectEnvironment(input.resolved.config.environments, input.environmentName);

  if (environment.kind !== "daemon") {
    throw new Error(`environment kind is not implemented: ${environment.kind}`);
  }

  return {
    repos: [],
    cwd: environment.cwd,
    sidecars: [],
  };
}

function selectEnvironment(
  environments: readonly EnvironmentConfig[],
  environmentName: string | undefined,
): EnvironmentConfig {
  if (environmentName === undefined) {
    const first = environments[0];

    if (first === undefined) {
      throw new Error("hub config has no environments");
    }

    return first;
  }

  const environment = environments.find((item) => item.name === environmentName);

  if (environment === undefined) {
    throw new Error(`environment not found: ${environmentName}`);
  }

  return environment;
}
