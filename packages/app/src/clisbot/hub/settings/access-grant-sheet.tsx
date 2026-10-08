import { useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { AdaptiveModalSheet } from "@/components/adaptive-modal-sheet";
import { useHubAccount } from "../account-provider";
import { GrantAccessContent } from "./access-assignment-form";
import { assignmentSubjectOptions, type AccessAssignment } from "./access-catalog";
import { viewerAuthority } from "./access-grantor";
import { QueryFeedback } from "./access-settings-feedback";
import { useAccessMutation, useEffectiveAccess, useManagedAccessQueries } from "./access-queries";

/**
 * The Access screen's grant sheet, opened from somewhere else (a Member's page) on a chosen
 * Team or Member, so granting does not mean leaving for the Access tab. Same form, same save.
 */
export function GrantAccessSheet({
  subject,
  resource = null,
  editing = null,
  close,
  onSaved,
}: {
  /** A subject key, `team\0<id>` or `member\0<id>`. */
  subject: string | null;
  /** A resource key to start on, `daemon\0<id>`. */
  resource?: string | null;
  /** A stored grant to edit instead of granting new access. */
  editing?: AccessAssignment | null;
  close(): void;
  /** After the grant lands, so the page that opened the sheet can reload its own copy. */
  onSaved(): void;
}) {
  const { t } = useTranslation();
  const hub = useHubAccount();
  const effective = useEffectiveAccess();
  const { assignments, catalog, members, teams } = useManagedAccessQueries();
  const done = useCallback(() => {
    onSaved();
    close();
  }, [close, onSaved]);
  const { pending, mutationError, post } = useAccessMutation(assignments.refetch, done);
  const subjectCount = useMemo(
    () => assignmentSubjectOptions(members.data?.members ?? [], teams.data?.teams ?? []).length,
    [members.data, teams.data],
  );
  const loadingHeader = useMemo(() => ({ title: t("hub.access.form.grantAccess") }), [t]);
  const queries = [effective, assignments, catalog, members, teams];
  if (!(effective.data && assignments.data && catalog.data && members.data && teams.data)) {
    return (
      <AdaptiveModalSheet visible header={loadingHeader} onClose={close} desktopMaxWidth={560}>
        <QueryFeedback queries={queries} />
      </AdaptiveModalSheet>
    );
  }
  return (
    <GrantAccessContent
      initialSubject={subject}
      initialResource={resource}
      editing={editing}
      cancelEdit={close}
      assignableSubjects={subjectCount}
      catalog={catalog.data}
      assignments={assignments.data.assignments}
      members={members.data.members}
      teams={teams.data.teams}
      authority={viewerAuthority(
        hub.signedIn?.capabilities.manageResources === true,
        effective.data,
      )}
      // Any refusal shows in the form: there is no page behind it to show it on.
      grantorError={mutationError?.message ?? null}
      pending={pending}
      save={post}
    />
  );
}
