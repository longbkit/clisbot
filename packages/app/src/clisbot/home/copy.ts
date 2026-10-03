/** User-facing strings of the Clisbot home screen. English literals, like the other Clisbot surfaces. */
export const homeCopy = {
  title: "Ready to start",
  subtitle: "Chat with a bot, or open a project folder to work on code.",
  noHost: {
    title: "No Host connected",
    description: "A Host is the computer that runs your agents. Connect one to get started.",
    action: "Connect a Host",
  },
  host: {
    online: "Connected",
    connecting: "Connecting…",
    offline: "Offline",
    error: "Connection error",
    version: (version: string) => `Clisbot ${version}`,
  },
  providers: {
    title: "Providers",
    checking: "Checking providers…",
    checkingOne: "Checking…",
    ready: (models: number) => (models > 0 ? `Ready · ${models} models` : "Ready"),
    notInstalled: "Not installed",
    error: "Error",
    noneReady:
      "No provider is ready yet. Install and sign in to Claude Code or Codex on this Host, then refresh.",
    manage: "Manage providers",
  },
  actions: {
    createBot: "Create a bot",
    createBotDescription: "A teammate with its own folder you can chat with",
    createBotUnavailable: "Needs a Host that supports bots",
    addProject: "Add a project",
    addProjectDescription: "Open a code folder on your Host",
  },
  more: { title: "More ways to start" },
} as const;
