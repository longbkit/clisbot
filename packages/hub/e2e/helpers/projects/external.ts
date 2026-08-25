import { createHmac } from "node:crypto";
import { expect, type APIRequestContext } from "@playwright/test";
import type { BuiltApplication } from "../hub.js";

export class ProjectExternalFacts {
  constructor(
    private readonly application: BuiltApplication,
    private readonly requests: APIRequestContext,
  ) {}

  setGitHubRevision(
    repositoryId: number,
    commitSha: string,
    files?: readonly { path: string; content: string }[],
  ) {
    return this.application.setGitHubConfiguration({
      repositoryId,
      commitSha,
      ...(files === undefined ? {} : { files }),
    });
  }

  async pushGitHubDefaultBranch(repositoryId: number, commitSha: string, deliveryId: string) {
    const body = JSON.stringify({
      ref: "refs/heads/main",
      after: commitSha,
      repository: { id: repositoryId, full_name: "acme-inc/app" },
      installation: { id: 42 },
      commits: [],
    });
    const signature = createHmac("sha256", "phase-zero-webhook-secret").update(body).digest("hex");
    const response = await this.requests.post(`${this.application.origin}/webhook`, {
      headers: {
        "content-type": "application/json",
        "x-github-delivery": deliveryId,
        "x-github-event": "push",
        "x-hub-signature-256": `sha256=${signature}`,
      },
      data: Buffer.from(body),
    });
    expect(response.status()).toBe(200);
  }
}
