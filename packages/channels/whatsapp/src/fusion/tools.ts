// Fusion-owned WhatsApp agent tools (D-WA-033): `whatsapp_send_location`.
//
// Core's message-tool vocabulary is closed (`message-action-names.ts`: "plugins
// add names through a core PR") and has no location action, and OpenClaw's
// WhatsApp extension does not send pins. Hermes does (`/send-location`). A
// channel-specific capability rides `plugin.agentTools`, the surface the Hub
// mounts on the channel-reply MCP server (`packages/hub/src/channels/
// channel-agent-tools.ts`), the same way Zalo Personal's `zalouser` tool does.
//
// The tool has no target argument: it posts into the conversation the agent is
// answering (`deliveryContext.to`, set by the Hub from the bound capability), so
// a prompt cannot redirect it. The send goes through the account's live socket
// (`getWhatsAppConnectionController`), the same one every other send uses.
import type { AnyAgentTool } from "@clisbot/channels-core/agents/tools/common.host-adapter";
import type {
  OpenClawPluginToolContext,
  OpenClawPluginToolFactory,
} from "@clisbot/channels-core/plugin-sdk/plugin-entry";
import { getWhatsAppConnectionController } from "../connection-controller-runtime-context.js";
import { toWhatsappJid } from "../text-runtime.js";

export const WHATSAPP_TOOL_NAMES = ["whatsapp_send_location"] as const;

const LOCATION_PARAMETERS = {
  type: "object",
  properties: {
    latitude: { type: "number", minimum: -90, maximum: 90, description: "Latitude in decimal degrees." },
    longitude: { type: "number", minimum: -180, maximum: 180, description: "Longitude in decimal degrees." },
    name: { type: "string", description: "Place name shown on the pin (optional)." },
    address: { type: "string", description: "Address shown under the name (optional)." },
  },
  required: ["latitude", "longitude"],
  additionalProperties: false,
} as const;

type LocationArgs = { latitude: number; longitude: number; name?: string; address?: string };

function readLocationArgs(raw: unknown): LocationArgs {
  const args = (raw ?? {}) as Record<string, unknown>;
  const latitude = Number(args["latitude"]);
  const longitude = Number(args["longitude"]);
  if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90) {
    throw new Error("latitude must be a number between -90 and 90");
  }
  if (!Number.isFinite(longitude) || longitude < -180 || longitude > 180) {
    throw new Error("longitude must be a number between -180 and 180");
  }
  const text = (key: string) =>
    typeof args[key] === "string" && (args[key] as string).trim() !== ""
      ? (args[key] as string).trim()
      : undefined;
  const name = text("name");
  const address = text("address");
  return { latitude, longitude, ...(name ? { name } : {}), ...(address ? { address } : {}) };
}

export function createWhatsAppLocationTool(context: OpenClawPluginToolContext): AnyAgentTool | null {
  const to = context.deliveryContext?.to;
  const accountId = context.deliveryContext?.accountId ?? context.agentAccountId;
  if (!to || !accountId) return null;
  return {
    name: "whatsapp_send_location",
    label: "Send WhatsApp location",
    description:
      "Send a native WhatsApp location pin into this conversation (the chat you are answering).",
    parameters: LOCATION_PARAMETERS,
    execute: async (_toolCallId, params) => {
      const location = readLocationArgs(params);
      const sock = getWhatsAppConnectionController(accountId)?.getCurrentSock();
      if (!sock) throw new Error(`WhatsApp account ${accountId} is not connected`);
      const sent = await sock.sendMessage(toWhatsappJid(to), {
        location: {
          degreesLatitude: location.latitude,
          degreesLongitude: location.longitude,
          ...(location.name ? { name: location.name } : {}),
          ...(location.address ? { address: location.address } : {}),
        },
      });
      const messageId = sent?.key?.id;
      if (!messageId) throw new Error("WhatsApp did not accept the location message");
      const details = { ok: true, messageId, to, ...location };
      return { content: [{ type: "text", text: JSON.stringify(details) }], details };
    },
  };
}

/** The per-execution factories, shaped like upstream's `ChannelPlugin.agentTools`. */
export const whatsappAgentTools: OpenClawPluginToolFactory[] = [
  (context) => createWhatsAppLocationTool(context),
];

/** What the Hub registers (`readAgentToolsSurface`): factories, rebuilt per call. */
export function collectWhatsAppToolRegistrations(): Array<{ tool: OpenClawPluginToolFactory }> {
  return whatsappAgentTools.map((tool) => ({ tool }));
}

/** The registrar adapter, the same shape the Zalo Personal and Feishu verticals publish. */
export function registerWhatsAppTools(registrar: {
  registerTool(tool: OpenClawPluginToolFactory): void;
}): Array<{ tool: OpenClawPluginToolFactory }> {
  const registrations = collectWhatsAppToolRegistrations();
  for (const entry of registrations) registrar.registerTool(entry.tool);
  return registrations;
}
