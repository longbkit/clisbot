import { ArrowRight, Bot, MessagesSquare, ShieldCheck } from "lucide-react";

const CHANNELS = [
  "Slack",
  "Telegram",
  "Discord",
  "Google Chat",
  "Feishu/Lark",
  "Zalo Official Bot",
  "Zalo Personal",
  "WhatsApp",
] as const;

const GUIDES = [
  {
    icon: MessagesSquare,
    title: "Continue work where your team talks",
    description:
      "Use a Hub Route to start an agent or continue a Bot from a channel conversation. Ask for a change in Slack, or review a task in Telegram, with replies in that conversation.",
    href: "/docs/hub/channels",
    cta: "Connect a channel",
  },
  {
    icon: ShieldCheck,
    title: "Share a Host or selected Projects",
    description:
      "A Host connects to the daemon that runs your agents. Grant Members or Teams access to its Projects through Managed access. Choose who can chat, create Workspaces, or manage the Host, with provider and model limits for managed sessions.",
    href: "/docs/hub/managed-access",
    cta: "Set up team access",
  },
  {
    icon: Bot,
    title: "Bring several Bots into one Chat",
    description:
      "Give each Bot a role, instructions, and a home Workspace. Create a Group chat with Bots on the same Host: ask a research Bot to gather options and a writing Bot to draft from the shared conversation. Each keeps its own session and memory.",
    href: "/docs/bots-and-chats",
    cta: "Create Bots and Group chats",
  },
] as const;

export function HubAndBots() {
  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-6 md:p-8">
        <h3 className="text-xl font-medium text-white/90">Hub connects 8+ channels</h3>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
          Eight integrations in the current catalog. You or your team operate the Hub; your agents
          keep running on your machines. Transports, threads, media, and approvals vary by channel.
          Check its guide before connecting.
        </p>
        <ul className="mt-5 flex flex-wrap gap-2" aria-label="Current channel integrations">
          {CHANNELS.map((channel) => (
            <li key={channel} className="rounded-full border border-white/10 px-3 py-1.5 text-sm">
              {channel}
            </li>
          ))}
        </ul>
      </div>
      <div className="grid gap-4 md:grid-cols-3">
        {GUIDES.map((guide) => (
          <div
            key={guide.href}
            className="flex flex-col rounded-xl border border-white/10 bg-white/[0.025] p-5"
          >
            <guide.icon className="mb-5 h-5 w-5 text-muted-foreground" strokeWidth={1.5} />
            <h3 className="font-medium text-white/85">{guide.title}</h3>
            <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
              {guide.description}
            </p>
            <a
              href={guide.href}
              className="mt-auto inline-flex items-center gap-1.5 pt-5 text-sm text-white/85 hover:text-white"
            >
              {guide.cta}
              <ArrowRight className="h-3.5 w-3.5 shrink-0" />
            </a>
          </div>
        ))}
      </div>
      <p className="text-sm leading-relaxed text-muted-foreground">
        Managed access limits Clisbot operations; it does not isolate an OS account or cap provider
        spending. Available providers depend on the Host&apos;s setup and sign-in. Owners and Host
        Administrators bypass provider/model limits, and shell or Terminal profile access can run
        outside them. A Clisbot Group chat is a conversation with Bots on one Host; external channel
        groups use Hub Routes.
      </p>
      <a
        href="/docs/hub/channels/commands"
        className="inline-flex items-center gap-1.5 text-sm text-white/85 hover:text-white"
      >
        Choose a Project or Workspace with slash commands
        <ArrowRight className="h-3.5 w-3.5" />
      </a>
    </div>
  );
}
