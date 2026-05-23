import type { ZaloPersonalClient } from "./zca-js.ts";

type ZaloApi = ZaloPersonalClient["api"] & Record<string, any>;

export type ContactRow = {
  userId: string;
  displayName: string;
  online?: boolean;
  favorite?: boolean;
  labels?: string[];
  raw: unknown;
};

export type GroupRow = {
  groupId: string;
  name: string;
  memberCount?: number;
  raw?: unknown;
};

export async function getZaloPersonalMe(api: ZaloApi) {
  const account = await api.fetchAccountInfo?.().catch(() => undefined);
  const profile = account?.profile ?? account;
  const ownId = normalizeId((profile as any)?.userId ?? api.getOwnId?.());
  return {
    userId: ownId,
    displayName: normalizeDisplayName(profile) || ownId,
    raw: account ?? { userId: ownId },
  };
}

export async function listZaloPersonalContacts(api: ZaloApi, params: {
  status?: "all" | "online";
  favorite?: boolean;
  labels?: string[];
  labelMatch?: "any" | "all";
  limit?: number;
}) {
  const friends = await api.getAllFriends();
  const onlineIds = params.status === "online"
    ? new Set(((await api.getFriendOnlines()).onlines ?? []).map((item: any) => normalizeId(item.userId)))
    : undefined;
  const favoriteIds = params.favorite
    ? new Set((await api.getCloseFriends()).map((item: any) => normalizeId(item)))
    : undefined;
  const labelLookup = params.labels?.length
    ? await resolveLabelConversationLookup(api, params.labels)
    : { conversations: new Map<string, string[]>(), requestedCount: 0, selectedIds: [] };
  const rows = friends.map((friend: any) => {
    const userId = normalizeId(friend);
    return {
      userId,
      displayName: normalizeDisplayName(friend) || userId,
      online: onlineIds?.has(userId),
      favorite: favoriteIds?.has(userId),
      labels: labelLookup.conversations.get(userId) ?? [],
      raw: friend,
    } satisfies ContactRow;
  });
  return takeLimit(rows.filter((row) =>
    (params.status !== "online" || row.online) &&
    (!params.favorite || row.favorite) &&
    matchesLabels(row, labelLookup.selectedIds, labelLookup.requestedCount, params.labelMatch ?? "any")
  ), params.limit);
}

export async function searchZaloPersonalContacts(api: ZaloApi, params: {
  query?: string;
  phones?: string[];
  username?: string;
  limit?: number;
}) {
  const rows: ContactRow[] = [];
  const add = (value: any) => {
    if (!value) return;
    const userId = normalizeId(value);
    if (!userId || rows.some((row) => row.userId === userId)) return;
    rows.push({ userId, displayName: normalizeDisplayName(value) || userId, raw: value });
  };
  for (const value of Object.values(params.phones?.length ? await api.getMultiUsersByPhones(params.phones) : {})) {
    add(value);
  }
  if (params.username) {
    add(await api.findUserByUsername(params.username));
  }
  if (params.query) {
    const q = params.query.toLowerCase();
    for (const friend of await api.getAllFriends()) {
      const haystack = `${normalizeId(friend)} ${normalizeDisplayName(friend)}`.toLowerCase();
      if (haystack.includes(q)) add(friend);
    }
  }
  return takeLimit(rows, params.limit);
}

export async function getZaloPersonalContact(api: ZaloApi, userId: string, business: boolean) {
  const profile = await api.getUserInfo(userId);
  const changed = profile.changed_profiles?.[userId] ?? Object.values(profile.changed_profiles ?? {})[0];
  return {
    userId,
    profile: changed ?? profile,
    ...(business ? { business: await api.getBizAccount(userId) } : {}),
  };
}

export async function listZaloPersonalFriendInvites(api: ZaloApi, direction: "incoming" | "sent" | "all") {
  const result: Record<string, unknown> = {};
  if (direction === "sent" || direction === "all") {
    result.sent = await api.getSentFriendRequest();
  }
  if (direction === "incoming" || direction === "all") {
    const recommendations = await api.getFriendRecommendations();
    result.incoming = (recommendations.recommItems ?? []).filter((item: any) =>
      item?.dataInfo?.recommType === 2 || item?.dataInfo?.type === 2
    );
  }
  return result;
}

export async function listZaloPersonalGroups(api: ZaloApi, limit?: number) {
  const groups = await api.getAllGroups();
  const ids = Object.keys(groups.gridVerMap ?? {});
  const details = ids.length ? await api.getGroupInfo(ids) : { gridInfoMap: {} };
  const map = (details.gridInfoMap ?? {}) as Record<string, any>;
  return takeLimit(ids.map((groupId) => mapGroup(groupId, map[groupId])), limit);
}

export async function searchZaloPersonalGroups(api: ZaloApi, query: string, limit?: number) {
  const q = query.toLowerCase();
  return takeLimit((await listZaloPersonalGroups(api)).filter((group) =>
    `${group.groupId} ${group.name}`.toLowerCase().includes(q)
  ), limit);
}

export async function getZaloPersonalGroup(api: ZaloApi, groupId: string) {
  const response = await api.getGroupInfo(groupId);
  return response.gridInfoMap?.[groupId] ?? response;
}

export async function listZaloPersonalGroupMembers(api: ZaloApi, groupId: string, limit?: number) {
  const group = await getZaloPersonalGroup(api, groupId);
  const ids = Array.from(new Set<string>([
    ...(group.memberIds ?? []).map(normalizeId),
    ...(group.memVerList ?? []).map(normalizeId),
    ...(group.currentMems ?? []).map(normalizeId),
  ].filter(Boolean)));
  const profiles = ids.length ? (await api.getGroupMembersInfo(ids)).profiles ?? {} : {};
  return takeLimit(ids.map((id) => ({
    userId: id,
    displayName: normalizeDisplayName(profiles[id]) || normalizeDisplayName((group.currentMems ?? []).find((item: any) => normalizeId(item) === id)) || id,
    raw: profiles[id] ?? null,
  })), limit);
}

export async function resolveZaloPersonalUsersByPhones(api: ZaloApi, phones: string[]) {
  const users = await api.getMultiUsersByPhones(phones);
  return Object.values(users).map((user: any) => {
    const userId = normalizeId(user);
    if (!userId) {
      throw new Error(`Could not resolve phone lookup result: ${JSON.stringify(user)}`);
    }
    return userId;
  });
}

function mapGroup(groupId: string, raw: any): GroupRow {
  return {
    groupId,
    name: normalizeDisplayName(raw) || groupId,
    memberCount: typeof raw?.totalMember === "number" ? raw.totalMember : undefined,
    raw,
  };
}

function normalizeDisplayName(value: any) {
  return String(value?.displayName ?? value?.zaloName ?? value?.dName ?? value?.name ?? value?.userId ?? value?.id ?? "").trim();
}

function normalizeId(value: any) {
  return String(value?.userId ?? value?.id ?? value?.uid ?? value ?? "").replace(/_\d+$/, "").trim();
}

function takeLimit<T>(items: T[], limit = 50) {
  return items.slice(0, Math.max(0, limit));
}

async function resolveLabelConversationLookup(api: ZaloApi, filters: string[]) {
  const labels = (await api.getLabels()).labelData ?? [];
  const filterSet = new Set(filters.map((item) => item.toLowerCase()));
  const conversations = new Map<string, string[]>();
  const selectedIds: string[] = [];
  for (const label of labels) {
    const names = [String(label.id), label.text, label.textKey].filter(Boolean).map((item) => item.toLowerCase());
    if (!names.some((name) => filterSet.has(name))) {
      continue;
    }
    selectedIds.push(String(label.id));
    for (const conversation of label.conversations ?? []) {
      const id = normalizeId(conversation);
      conversations.set(id, [...(conversations.get(id) ?? []), String(label.id)]);
    }
  }
  return { conversations, requestedCount: filterSet.size, selectedIds };
}

function matchesLabels(row: ContactRow, selectedIds: string[], requestedCount: number, match: "any" | "all") {
  if (requestedCount === 0) {
    return true;
  }
  const rowLabels = new Set(row.labels ?? []);
  if (match === "all") {
    return selectedIds.length === requestedCount && selectedIds.every((id) => rowLabels.has(id));
  }
  return selectedIds.some((id) => rowLabels.has(id));
}
