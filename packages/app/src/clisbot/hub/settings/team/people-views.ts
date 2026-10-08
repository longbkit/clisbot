import { useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useMemo } from "react";
import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";
import type { ViewTab } from "../view-tabs";
import { canSeeInvitations, managesPeople } from "./team-membership";
import type { PeopleAuthority } from "./types";

export type PeopleView = "members" | "teams" | "invitations" | "access";

/**
 * The People tabs. Managing people and what they may use is one job, so Access
 * is a tab here. A Member who manages no one sees Access alone (their own
 * access); Invitations only for viewers who can read them (`canSeeInvitations`).
 */
export function peopleViews(
  showInvitations: boolean,
  managesAnyone: boolean,
  t: TFunction,
): ViewTab<PeopleView>[] {
  const access = { value: "access" as const, label: t("hub.team.people.tabs.access") };
  if (!managesAnyone) return [access];
  return [
    { value: "members", label: t("hub.team.people.tabs.members") },
    { value: "teams", label: t("hub.team.people.tabs.teams") },
    ...(showInvitations
      ? [{ value: "invitations" as const, label: t("hub.team.people.tabs.invitations") }]
      : []),
    access,
  ];
}

/** The tab lives in the URL (`?view=teams`) so a refresh, Back, or a shared link keeps it. */
export function usePeopleView(
  views: readonly ViewTab<PeopleView>[],
): [PeopleView, (view: PeopleView) => void] {
  const router = useRouter();
  const params = useLocalSearchParams<{ view?: string }>();
  const view = useMemo(
    () => views.find(({ value }) => value === params.view)?.value ?? views[0]?.value ?? "access",
    [params.view, views],
  );
  const setView = useCallback((next: PeopleView) => router.setParams({ view: next }), [router]);
  return [view, setView];
}

/** The tabs this viewer gets and the open one; the labels follow the UI language. */
export function usePeopleTabs(authority: PeopleAuthority) {
  const { t } = useTranslation();
  const views = useMemo(
    () => peopleViews(canSeeInvitations(authority), managesPeople(authority), t),
    [authority, t],
  );
  const [view, setView] = usePeopleView(views);
  return { views, view, setView };
}
