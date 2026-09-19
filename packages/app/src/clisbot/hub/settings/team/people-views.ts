import { useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useMemo } from "react";
import type { SegmentedControlOption } from "@/components/ui/segmented-control";

export type PeopleView = "members" | "teams" | "invitations" | "access";

/**
 * The People tabs. Managing people and what they may use is one job, so Access
 * is a tab here. A Member who manages no one sees Access alone (their own
 * access); Invitations only for viewers who can read them (`canSeeInvitations`).
 */
export function peopleViews(
  showInvitations: boolean,
  managesPeople: boolean,
): SegmentedControlOption<PeopleView>[] {
  const access = { value: "access" as const, label: "Access" };
  if (!managesPeople) return [access];
  return [
    { value: "members", label: "Members" },
    { value: "teams", label: "Teams" },
    ...(showInvitations ? [{ value: "invitations" as const, label: "Invitations" }] : []),
    access,
  ];
}

/** The tab lives in the URL (`?view=teams`) so a refresh, Back, or a shared link keeps it. */
export function usePeopleView(
  views: readonly SegmentedControlOption<PeopleView>[],
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
