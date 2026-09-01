import { useEffect, useState } from "react";

export function useConnectionResult() {
  const state = useState(readConnectionResult);
  useEffect(stripConnectionResult, []);
  return state;
}

export function connectionResultCopy(result: string): string {
  if (result === "github_connected") return "GitHub connected.";
  if (result === "discord_connected") return "Discord connected.";
  if (result === "slack_connected") return "Slack connected.";
  if (result === "linear_connected") return "Linear connected.";
  if (result === "github_disconnected") return "GitHub disconnected.";
  if (result === "discord_disconnected") return "Discord disconnected.";
  if (result === "slack_disconnected") return "Slack disconnected.";
  if (result === "linear_disconnected") return "Linear disconnected.";
  if (result === "github_approval_required") {
    return "GitHub owner approval is required. Retry after approval.";
  }
  if (result === "provider_not_configured") return "The provider is not configured.";
  if (result === "connection_invalid") {
    return "This connection link is invalid, expired, or already used. Restart the connection from this Hub.";
  }
  if (result === "connection_conflict") {
    return "That provider account is already connected to another organization. Disconnect it there before trying again.";
  }
  return "The provider connection did not complete. Restart it from Connections; if it repeats, check the app credentials and provider status.";
}

function readConnectionResult(): string | undefined {
  if (typeof window === "undefined") return undefined;
  return new URL(window.location.href).searchParams.get("result") ?? undefined;
}

function stripConnectionResult(): void {
  const url = new URL(window.location.href);
  if (!url.searchParams.has("app") && !url.searchParams.has("result")) return;
  url.searchParams.delete("app");
  url.searchParams.delete("result");
  window.history.replaceState(window.history.state, "", url);
}
