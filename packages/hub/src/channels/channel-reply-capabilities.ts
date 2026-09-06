import { randomBytes } from "node:crypto";
import type { ChannelReplyBindingRef } from "./plane/types.js";

/**
 * A server-owned Channel reply capability. The opaque token is the only value
 * placed in an Agent's MCP URL; every routing and authorization fact remains
 * in Hub memory.
 */
export interface ChannelReplyOutputBudget {
  executionId: string;
  type: string;
  max?: number | undefined;
}

export interface ChannelReplyCapability {
  organizationId: string;
  channelRevisionId: string | null;
  routePosition: number | "fallback";
  routeFingerprint: string;
  ref: ChannelReplyBindingRef;
  projectRoot?: string | undefined;
  outputBudget?: ChannelReplyOutputBudget | undefined;
  agentId: string;
  expiresAt: number;
}

export interface ChannelReplyCapabilityInput {
  organizationId: string;
  channelRevisionId: string | null;
  routePosition: number | "fallback";
  routeFingerprint: string;
  ref: ChannelReplyBindingRef;
  projectRoot?: string | undefined;
  outputBudget?: ChannelReplyOutputBudget | undefined;
}

interface PendingChannelReplyCapability extends Omit<ChannelReplyCapability, "agentId"> {
  agentId: string | null;
}

const DEFAULT_CHANNEL_REPLY_CAPABILITY_TTL_MS = 7 * 24 * 60 * 60 * 1_000;

export interface ChannelReplyCapabilityRegistryOptions {
  now?: (() => number) | undefined;
  ttlMs?: number | undefined;
  token?: (() => string) | undefined;
}

export interface ChannelReplyCapabilityService {
  issue(input: ChannelReplyCapabilityInput): string;
  bind(token: string, agentId: string): boolean;
  resolve(token: string, organizationId: string): ChannelReplyCapability | undefined;
  revoke(token: string): void;
  revokeAccount(organizationId: string, channel: string, accountId: string): void;
}

/**
 * Process-lifetime owner for Channel reply capabilities. Restarting Hub,
 * replacing a Channel revision, or stopping its account drops the tokens; no
 * new persistence or transport is needed for this create-time Agent feature.
 */
export class ChannelReplyCapabilityRegistry implements ChannelReplyCapabilityService {
  private readonly capabilities = new Map<string, PendingChannelReplyCapability>();
  private readonly now: () => number;
  private readonly ttlMs: number;
  private readonly token: () => string;

  constructor(options: ChannelReplyCapabilityRegistryOptions = {}) {
    this.now = options.now ?? Date.now;
    this.ttlMs = options.ttlMs ?? DEFAULT_CHANNEL_REPLY_CAPABILITY_TTL_MS;
    this.token = options.token ?? (() => randomBytes(32).toString("base64url"));
    if (!Number.isFinite(this.ttlMs) || this.ttlMs <= 0) {
      throw new Error("Channel reply capability ttlMs must be positive");
    }
  }

  issue(input: ChannelReplyCapabilityInput): string {
    this.pruneExpired();
    let token = this.token();
    while (token === "" || this.capabilities.has(token)) token = this.token();
    this.capabilities.set(token, {
      ...input,
      ref: { ...input.ref },
      ...(input.outputBudget === undefined ? {} : { outputBudget: { ...input.outputBudget } }),
      agentId: null,
      expiresAt: this.now() + this.ttlMs,
    });
    return token;
  }

  /** Bind once to the Agent created with this token. Rebinding to another Agent fails closed. */
  bind(token: string, agentId: string): boolean {
    const capability = this.active(token);
    if (capability === undefined || agentId === "") return false;
    if (capability.agentId !== null && capability.agentId !== agentId) return false;
    capability.agentId = agentId;
    return true;
  }

  resolve(token: string, organizationId: string): ChannelReplyCapability | undefined {
    const capability = this.active(token);
    if (
      capability === undefined ||
      capability.agentId === null ||
      capability.organizationId !== organizationId
    ) {
      return undefined;
    }
    return {
      ...capability,
      ref: { ...capability.ref },
      ...(capability.outputBudget === undefined
        ? {}
        : { outputBudget: { ...capability.outputBudget } }),
      agentId: capability.agentId,
    };
  }

  revoke(token: string): void {
    this.capabilities.delete(token);
  }

  revokeAccount(organizationId: string, channel: string, accountId: string): void {
    for (const [token, capability] of this.capabilities) {
      if (
        capability.organizationId === organizationId &&
        capability.ref.channel === channel &&
        capability.ref.accountId === accountId
      ) {
        this.capabilities.delete(token);
      }
    }
  }

  private active(token: string): PendingChannelReplyCapability | undefined {
    const capability = this.capabilities.get(token);
    if (capability === undefined) return undefined;
    if (capability.expiresAt <= this.now()) {
      this.capabilities.delete(token);
      return undefined;
    }
    return capability;
  }

  private pruneExpired(): void {
    const now = this.now();
    for (const [token, capability] of this.capabilities) {
      if (capability.expiresAt <= now) this.capabilities.delete(token);
    }
  }
}
