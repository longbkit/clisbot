import { applyTemplate, sanitizeSessionName } from "../shared/paths.ts";

export const DEFAULT_MAIN_KEY = "main";
export const DEFAULT_ACCOUNT_ID = "default";

export type SessionDmScope =
  | "main"
  | "per-peer"
  | "per-channel-peer"
  | "per-account-channel-peer";

export type AgentPeerKind = "dm" | "group" | "channel";

function normalizeToken(value: string | undefined | null) {
  return (value ?? "").trim().toLowerCase();
}

export function normalizeMainKey(value: string | undefined | null) {
  return normalizeToken(value) || DEFAULT_MAIN_KEY;
}

export function normalizeAgentId(value: string | undefined | null) {
  const trimmed = (value ?? "").trim();
  if (!trimmed) {
    return "default";
  }

  return (
    trimmed
      .toLowerCase()
      .replaceAll(/[^a-z0-9_-]+/g, "-")
      .replaceAll(/-+/g, "-")
      .replaceAll(/^-|-$/g, "") || "default"
  );
}

export function normalizeAccountId(value: string | undefined | null) {
  return normalizeToken(value) || DEFAULT_ACCOUNT_ID;
}

export function buildAgentMainSessionKey(params: {
  agentId: string;
  mainKey?: string | undefined;
}) {
  return `agent:${normalizeAgentId(params.agentId)}:${normalizeMainKey(params.mainKey)}`;
}

function resolveLinkedPeerId(params: {
  identityLinks?: Record<string, string[]>;
  channel: string;
  peerId: string;
}) {
  const peerId = params.peerId.trim();
  if (!peerId || !params.identityLinks) {
    return null;
  }

  const candidates = new Set<string>();
  const normalizedPeerId = normalizeToken(peerId);
  if (normalizedPeerId) {
    candidates.add(normalizedPeerId);
  }

  const normalizedChannel = normalizeToken(params.channel);
  if (normalizedChannel) {
    candidates.add(normalizeToken(`${normalizedChannel}:${peerId}`));
  }

  for (const [canonical, ids] of Object.entries(params.identityLinks)) {
    const canonicalId = canonical.trim();
    if (!canonicalId || !Array.isArray(ids)) {
      continue;
    }

    for (const id of ids) {
      if (candidates.has(normalizeToken(id))) {
        return canonicalId.toLowerCase();
      }
    }
  }

  return null;
}

export function buildAgentPeerSessionKey(params: {
  agentId: string;
  mainKey?: string | undefined;
  channel: string;
  accountId?: string | null;
  peerKind?: AgentPeerKind | null;
  peerId?: string | null;
  dmScope?: SessionDmScope;
  identityLinks?: Record<string, string[]>;
}) {
  const peerKind = params.peerKind ?? "dm";
  if (peerKind === "dm") {
    const dmScope = params.dmScope ?? "main";
    const linkedPeerId = resolveLinkedPeerId({
      identityLinks: params.identityLinks,
      channel: params.channel,
      peerId: params.peerId ?? "",
    });
    const peerId = (linkedPeerId ?? params.peerId ?? "").trim().toLowerCase();

    if (dmScope === "per-account-channel-peer" && peerId) {
      return `agent:${normalizeAgentId(params.agentId)}:${normalizeToken(params.channel) || "unknown"}:${normalizeAccountId(params.accountId)}:dm:${peerId}`;
    }

    if (dmScope === "per-channel-peer" && peerId) {
      return `agent:${normalizeAgentId(params.agentId)}:${normalizeToken(params.channel) || "unknown"}:dm:${peerId}`;
    }

    if (dmScope === "per-peer" && peerId) {
      return `agent:${normalizeAgentId(params.agentId)}:dm:${peerId}`;
    }

    return buildAgentMainSessionKey({
      agentId: params.agentId,
      mainKey: params.mainKey,
    });
  }

  return `agent:${normalizeAgentId(params.agentId)}:${normalizeToken(params.channel) || "unknown"}:${peerKind}:${(params.peerId ?? "").trim().toLowerCase() || "unknown"}`;
}

export function appendThreadSessionKey(baseSessionKey: string, threadId?: string | null) {
  const normalizedThreadId = (threadId ?? "").trim().toLowerCase();
  if (!normalizedThreadId) {
    return baseSessionKey;
  }

  return `${baseSessionKey}:thread:${normalizedThreadId}`;
}

export function buildTmuxSessionName(params: {
  template: string;
  agentId: string;
  workspacePath: string;
  sessionKey: string;
  mainKey?: string | undefined;
}) {
  const rendered = applyTemplate(params.template, {
    agentId: params.agentId,
    workspace: params.workspacePath,
    sessionKey: params.sessionKey,
    mainKey: normalizeMainKey(params.mainKey),
  });
  const baseName = sanitizeSessionName(rendered);
  return baseName;
}
