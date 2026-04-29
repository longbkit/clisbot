import {
  collapseHomePath,
  getDefaultSessionStorePath,
  getDefaultTmuxSocketPath,
  getDefaultWorkspaceTemplate,
} from "../shared/paths.ts";

export function applyDynamicPathDefaults(
  parsed: unknown,
  env: NodeJS.ProcessEnv = process.env,
) {
  if (!isRecord(parsed)) {
    return parsed;
  }

  const app = isRecord(parsed.app) ? parsed.app : {};
  const appSession = isRecord(app.session) ? app.session : {};
  const agents = isRecord(parsed.agents) ? parsed.agents : {};
  const agentDefaults = isRecord(agents.defaults) ? agents.defaults : {};
  const runner = isRecord(agentDefaults.runner) ? agentDefaults.runner : {};
  const runnerDefaults = isRecord(runner.defaults) ? runner.defaults : {};
  const tmux = isRecord(runnerDefaults.tmux) ? runnerDefaults.tmux : {};

  return {
    ...parsed,
    app: {
      ...app,
      session: {
        ...appSession,
        storePath: typeof appSession.storePath === "string" && appSession.storePath.trim()
          ? appSession.storePath
          : collapseHomePath(getDefaultSessionStorePath(env)),
      },
    },
    agents: {
      ...agents,
      defaults: {
        ...agentDefaults,
        workspace: typeof agentDefaults.workspace === "string" && agentDefaults.workspace.trim()
          ? agentDefaults.workspace
          : collapseHomePath(getDefaultWorkspaceTemplate(env)),
        runner: {
          ...runner,
          defaults: {
            ...runnerDefaults,
            tmux: {
              ...tmux,
              socketPath: typeof tmux.socketPath === "string" && tmux.socketPath.trim()
                ? tmux.socketPath
                : collapseHomePath(getDefaultTmuxSocketPath(env)),
            },
          },
        },
      },
    },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function assertNoLegacyPrivilegeCommands(value: unknown, path = "root"): void {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => assertNoLegacyPrivilegeCommands(entry, `${path}[${index}]`));
    return;
  }

  if (!isRecord(value)) {
    return;
  }

  if (Object.prototype.hasOwnProperty.call(value, "privilegeCommands")) {
    throw new Error(
      `Unsupported config key at ${path}.privilegeCommands. Move routed permissions to app.auth and agents.<id>.auth.`,
    );
  }

  for (const [key, entry] of Object.entries(value)) {
    assertNoLegacyPrivilegeCommands(entry, `${path}.${key}`);
  }
}
