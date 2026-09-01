import { z } from "zod";
import type { OutputExecutor } from "../../execution-capabilities/outputs.js";

const GitHubReplyArgsSchema = z.object({ content: z.string().min(1) });
const GitHubReplyOutputContextSchema = z.object({
  provider: z.literal("github"),
  target: z.object({
    installationId: z.number().int().positive(),
    repository: z.string().min(3),
  }),
  event: z.object({
    github: z.object({
      item: z.object({ number: z.number().int().positive() }).nullable(),
    }),
  }),
});

export function githubReplyAvailable(outputContext: unknown): boolean {
  const parsed = GitHubReplyOutputContextSchema.safeParse(outputContext);
  return parsed.success && parsed.data.event.github.item !== null;
}

export interface GitHubReplyClient {
  createIssueComment(input: {
    installationId: number;
    owner: string;
    repo: string;
    issueNumber: number;
    body: string;
  }): Promise<void>;
}

export function createGitHubReplyExecutor(options: { client: GitHubReplyClient }): OutputExecutor {
  return async function executeGitHubReply(input) {
    const args = GitHubReplyArgsSchema.parse(input.args);
    const context = GitHubReplyOutputContextSchema.parse(input.outputContext);
    const item = context.event.github.item;
    if (item === null) throw new Error("GitHub event has no issue or pull request to reply to");
    const [owner, repo] = splitRepository(context.target.repository);
    await options.client.createIssueComment({
      installationId: context.target.installationId,
      owner,
      repo,
      issueNumber: item.number,
      body: args.content,
    });
  };
}

function splitRepository(fullName: string): [owner: string, repo: string] {
  const [owner, repo, extra] = fullName.split("/");
  if (
    owner === undefined ||
    repo === undefined ||
    extra !== undefined ||
    owner === "" ||
    repo === ""
  ) {
    throw new Error(`invalid GitHub repository: ${fullName}`);
  }
  return [owner, repo];
}
