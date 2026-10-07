import type { ConnectorCatalogItem } from "@clisbot/protocol/connectors/types";
import type { ComposioCatalogPage, ComposioClient } from "./composio-client.js";

/**
 * The app catalog: Composio's toolkits, most used first. A page holds up to 1,000 apps, so the
 * whole catalog is two requests. Pages are cached per key for ten minutes; a search goes to
 * Composio so it covers apps not yet paged in. Without a key the catalog is the curated list,
 * so the screen can show what Composio would offer before anyone signs up.
 */

const PAGE_SIZE = 1000;
const CACHE_TTL_MS = 10 * 60_000;
/** Searches each add a page, so the cache keeps the newest few and drops expired ones. */
const MAX_CACHED_PAGES = 64;

/** Shown before a Composio key exists. Logos come from Composio once a key is saved. */
const CURATED_CATALOG: readonly ConnectorCatalogItem[] = [
  { slug: "gmail", name: "Gmail", description: "Read, search, draft and send email." },
  {
    slug: "github",
    name: "GitHub",
    description: "Issues, pull requests, repositories and actions.",
  },
  { slug: "slack", name: "Slack", description: "Messages, channels and users." },
  {
    slug: "googlecalendar",
    name: "Google Calendar",
    description: "Events, free/busy and invites.",
  },
  { slug: "notion", name: "Notion", description: "Pages, databases and comments." },
  { slug: "googledrive", name: "Google Drive", description: "Files and folders." },
  { slug: "googlesheets", name: "Google Sheets", description: "Read and write spreadsheets." },
  { slug: "googledocs", name: "Google Docs", description: "Read and write documents." },
  { slug: "linear", name: "Linear", description: "Issues, projects and cycles." },
  { slug: "jira", name: "Jira", description: "Issues, sprints and boards." },
  { slug: "outlook", name: "Outlook", description: "Microsoft email and calendar." },
  { slug: "hubspot", name: "HubSpot", description: "CRM contacts, deals and tickets." },
  { slug: "salesforce", name: "Salesforce", description: "CRM records and reports." },
  { slug: "asana", name: "Asana", description: "Tasks and projects." },
  { slug: "trello", name: "Trello", description: "Boards and cards." },
  { slug: "airtable", name: "Airtable", description: "Bases and records." },
  { slug: "dropbox", name: "Dropbox", description: "Files and folders." },
  { slug: "figma", name: "Figma", description: "Files and comments." },
  { slug: "stripe", name: "Stripe", description: "Payments and customers." },
  { slug: "supabase", name: "Supabase", description: "Postgres, auth and storage projects." },
  { slug: "sentry", name: "Sentry", description: "Errors and alerts." },
  { slug: "discord", name: "Discord", description: "Messages and channels." },
  { slug: "twitter", name: "X (Twitter)", description: "Post and read on X." },
  { slug: "reddit", name: "Reddit", description: "Browse and post." },
];

export interface CatalogQuery {
  search?: string;
  category?: string;
  cursor?: string;
}

interface CacheEntry {
  at: number;
  page: ComposioCatalogPage;
}

export class ConnectorCatalog {
  private readonly cache = new Map<string, CacheEntry>();
  private readonly now: () => number;

  constructor(options: { now?: () => number } = {}) {
    this.now = options.now ?? Date.now;
  }

  /** Forget every page, for example after the key changes. */
  clear(): void {
    this.cache.clear();
  }

  async page(client: ComposioClient | null, query: CatalogQuery): Promise<ComposioCatalogPage> {
    if (!client) return curatedPage(query.search);
    const search = query.search?.trim() || undefined;
    const key = JSON.stringify([search ?? "", query.category ?? "", query.cursor ?? ""]);
    this.dropExpired();
    const cached = this.cache.get(key);
    if (cached) return cached.page;
    const page = await client.listToolkits({
      limit: PAGE_SIZE,
      ...(search ? { search } : {}),
      ...(query.category ? { category: query.category } : {}),
      ...(query.cursor ? { cursor: query.cursor } : {}),
    });
    const unique = dedupeBySlug(page.items);
    // A cursor that answers with itself would page the same apps forever.
    const stuck = query.cursor !== undefined && page.nextCursor === query.cursor;
    const result = { ...page, items: unique, ...(stuck ? { nextCursor: null } : {}) };
    this.cache.set(key, { at: this.now(), page: result });
    while (this.cache.size > MAX_CACHED_PAGES) this.cache.delete(this.cache.keys().next().value!);
    return result;
  }

  private dropExpired(): void {
    const cutoff = this.now() - CACHE_TTL_MS;
    for (const [key, entry] of this.cache) {
      if (entry.at < cutoff) this.cache.delete(key);
    }
  }
}

function dedupeBySlug(items: ConnectorCatalogItem[]): ConnectorCatalogItem[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    if (seen.has(item.slug)) return false;
    seen.add(item.slug);
    return true;
  });
}

function curatedPage(search: string | undefined): ComposioCatalogPage {
  const needle = search?.trim().toLowerCase();
  const items = needle
    ? CURATED_CATALOG.filter(
        (item) => item.name.toLowerCase().includes(needle) || item.slug.includes(needle),
      )
    : [...CURATED_CATALOG];
  return { items, nextCursor: null, totalItems: items.length };
}
