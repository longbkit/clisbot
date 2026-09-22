/**
 * Slack people by name. A Slack event carries only a user id (`U…`), and the
 * Agent is told who wrote each line, so the vertical resolves the id with
 * `users.info` (bot scope `users:read`): `profile.real_name` →
 * `profile.display_name` → `real_name` → `name`, with `name` as the handle —
 * the original clisbot rule (`resolveSlackSenderDisplay`).
 *
 * Admission waits on this, so it is bounded: an in-memory cache per account
 * (TTL, LRU cap), a short timeout per lookup, and every miss or failure falls
 * back to the id. A token without `users:read` answers `missing_scope`; that is
 * logged once and every later lookup is skipped.
 */
import type { ChannelInboundEvent, HostChildLogger } from "@getpaseo/channels-shared";
import { extractSlackApiError } from "../client/web-api.js";

/** A person's display facts; both absent when Slack would not say. */
export interface SlackPersonName {
  name?: string;
  handle?: string;
}

/** The slice of the Web API client this needs. */
export interface SlackUsersClient {
  users: { info(args: { user: string }): Promise<unknown> };
}

export interface SlackSenderDirectoryOptions {
  ttlMs?: number;
  /** A failed lookup is retried after this long. */
  failureTtlMs?: number;
  capacity?: number;
  timeoutMs?: number;
  now?: () => number;
  logger?: HostChildLogger;
}

const DEFAULTS = {
  ttlMs: 60 * 60_000,
  failureTtlMs: 5 * 60_000,
  capacity: 2_000,
  timeoutMs: 2_000,
};

/** How many distinct people one message's mentions resolve. */
const MAX_MENTIONS = 10;

const USER_MENTION = /<@([UW][A-Z0-9]+)>/g;

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : undefined;
}

/** The display facts of a `users.info` answer. */
export function slackPersonName(result: unknown): SlackPersonName {
  const user = (result as { user?: Record<string, unknown> } | undefined)?.user;
  const profile = user?.["profile"] as Record<string, unknown> | undefined;
  const name =
    text(profile?.["real_name"]) ??
    text(profile?.["display_name"]) ??
    text(user?.["real_name"]) ??
    text(user?.["name"]);
  const handle = text(user?.["name"]);
  return { ...(name === undefined ? {} : { name }), ...(handle === undefined ? {} : { handle }) };
}

function withTimeout<T>(work: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("users.info timed out")), timeoutMs);
    timer.unref?.();
  });
  return Promise.race([work, deadline]).finally(() => clearTimeout(timer));
}

export class SlackSenderDirectory {
  private readonly options: typeof DEFAULTS & SlackSenderDirectoryOptions;
  private readonly cache = new Map<string, { person: SlackPersonName; expiresAt: number }>();
  private scopeMissing = false;

  constructor(options: SlackSenderDirectoryOptions = {}) {
    this.options = { ...DEFAULTS, ...options };
  }

  /** One person's name; `{}` when it cannot be had quickly. */
  async lookup(client: SlackUsersClient | undefined, userId: string): Promise<SlackPersonName> {
    const now = this.now();
    const cached = this.cache.get(userId);
    if (cached !== undefined && cached.expiresAt > now) {
      this.cache.delete(userId);
      this.cache.set(userId, cached);
      return cached.person;
    }
    if (client === undefined || this.scopeMissing || userId === "") return {};
    try {
      const person = slackPersonName(
        await withTimeout(client.users.info({ user: userId }), this.options.timeoutMs),
      );
      this.remember(userId, person, this.options.ttlMs);
      return person;
    } catch (error) {
      this.failed(error);
      this.remember(userId, {}, this.options.failureTtlMs);
      return {};
    }
  }

  /** The event with its sender's name and handle, and other people's
   * `<@U…>` mentions in the body read as `@Name`. */
  async name(
    client: SlackUsersClient | undefined,
    event: ChannelInboundEvent,
    options: { mentions?: boolean } = {},
  ): Promise<ChannelInboundEvent> {
    const sender = await this.lookup(client, event.senderId);
    const body = options.mentions === false ? event.body : await this.named(client, event.body);
    return {
      ...event,
      body,
      ...(sender.name === undefined ? {} : { senderName: sender.name }),
      ...(sender.handle === undefined ? {} : { senderUsername: sender.handle }),
    };
  }

  private async named(client: SlackUsersClient | undefined, body: string): Promise<string> {
    const ids = [...new Set([...body.matchAll(USER_MENTION)].map((match) => match[1]!))];
    if (ids.length === 0) return body;
    const people = await Promise.all(
      ids.slice(0, MAX_MENTIONS).map(async (id) => [id, await this.lookup(client, id)] as const),
    );
    const names = new Map(people.flatMap(([id, person]) => (person.name ? [[id, person.name]] : [])));
    return body.replace(USER_MENTION, (mention, id: string) => {
      const name = names.get(id);
      return name === undefined ? mention : `@${name}`;
    });
  }

  private remember(userId: string, person: SlackPersonName, ttlMs: number): void {
    this.cache.delete(userId);
    this.cache.set(userId, { person, expiresAt: this.now() + ttlMs });
    while (this.cache.size > this.options.capacity) {
      const oldest = this.cache.keys().next().value;
      if (oldest === undefined) break;
      this.cache.delete(oldest);
    }
  }

  private failed(error: unknown): void {
    if (extractSlackApiError(error)?.code !== "missing_scope") return;
    this.scopeMissing = true;
    this.options.logger?.warn?.(
      "slack: the bot token lacks users:read, so senders are shown by id; add the scope to show names",
    );
  }

  private now(): number {
    return (this.options.now ?? Date.now)();
  }
}
