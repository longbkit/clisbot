import { createHash, createHmac, timingSafeEqual } from "node:crypto";

export function deriveAgentExecutionCompletionToken(secret: string, executionId: string): string {
  return createHmac("sha256", secret).update(executionId, "utf8").digest("base64url");
}

export function hashAgentExecutionCompletionToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("base64url");
}

export function verifyAgentExecutionCompletionToken(token: string, expectedHash: string): boolean {
  const actual = Buffer.from(hashAgentExecutionCompletionToken(token), "utf8");
  const expected = Buffer.from(expectedHash, "utf8");

  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export function buildExecutionCapabilityMcpServer(input: {
  executionId: string;
  completionToken: string;
  publicBaseUrl: string;
}): { type: "http"; url: string; headers: Record<string, string> } {
  return {
    type: "http",
    url: new URL(
      `/agent-executions/${encodeURIComponent(input.executionId)}/mcp`,
      input.publicBaseUrl,
    ).toString(),
    headers: { Authorization: `Bearer ${input.completionToken}` },
  };
}
