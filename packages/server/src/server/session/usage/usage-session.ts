import type { ListUsageReportsOptions } from "../../plugins/usage-sources/index.js";
import type pino from "pino";
import type { ProviderUsage, UsageReportEntry } from "@clisbot/protocol/messages";
import type { SessionInboundMessage, SessionOutboundMessage } from "../../messages.js";

export interface UsageSessionOptions {
  emit(message: SessionOutboundMessage): void;
  accessKey?: () => string;
  canReadProvider?: (providerId: string | undefined) => boolean;
  runtime?: {
    listUsageReports(options: ListUsageReportsOptions): Promise<UsageReportEntry[]>;
    listLegacyUsage(
      options?: ListUsageReportsOptions,
    ): Promise<{ fetchedAt: string; providers: ProviderUsage[] }>;
  };
  logger: pino.Logger;
}

export class UsageSession {
  constructor(private readonly options: UsageSessionOptions) {}

  async handleListReports(
    msg: Extract<SessionInboundMessage, { type: "usage.list_reports.request" }>,
  ): Promise<void> {
    try {
      if (!this.options.runtime) throw new Error("Plugin runtime is unavailable");
      await this.options.runtime.listUsageReports({
        forceRefresh: msg.forceRefresh,
        canReadProvider: this.options.canReadProvider,
        reportIds: msg.reportIds,
        agentId: msg.agentId,
        onReport: (report) =>
          this.options.emit({
            type: "usage.list_reports.update",
            payload: { requestId: msg.requestId, report },
          }),
      });
      this.options.emit({
        type: "usage.list_reports.response",
        payload: { requestId: msg.requestId, error: null },
      });
    } catch (error) {
      this.options.emit({
        type: "usage.list_reports.response",
        payload: {
          requestId: msg.requestId,
          error: error instanceof Error ? error.message : String(error),
        },
      });
    }
  }

  // COMPAT(providerUsageList): added in v0.9.3, remove after 2027-03-26.
  async handleLegacyList(
    msg: Extract<SessionInboundMessage, { type: "provider.usage.list.request" }>,
  ): Promise<void> {
    try {
      if (!this.options.runtime) throw new Error("Plugin runtime is unavailable");
      const accessKey = this.options.accessKey?.();
      const usage = await this.options.runtime.listLegacyUsage({
        canReadProvider: this.options.canReadProvider,
      });
      if (accessKey !== this.options.accessKey?.())
        throw new Error("Usage access changed; retry the request");
      this.options.emit({
        type: "provider.usage.list.response",
        payload: {
          requestId: msg.requestId,
          fetchedAt: usage.fetchedAt,
          providers: usage.providers,
        },
      });
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      this.options.logger.error({ err }, "Failed to list provider usage");
      this.options.emit({
        type: "rpc_error",
        payload: {
          requestId: msg.requestId,
          requestType: msg.type,
          error: `Failed to list provider usage: ${err.message}`,
          code: "provider_usage_list_failed",
        },
      });
    }
  }
}
