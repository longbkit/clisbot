import { useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { ConnectionIssuesSheet } from "@/clisbot/home/connection-issues-sheet";
import { useHostsStrip } from "@/clisbot/home/hosts-strip-data";
import { ListState } from "./list-state";

/**
 * A list with nothing to show because no Host can be reached. Chats and Work offer the connection
 * sheet; Home already carries the connection notice, so it passes `withDetails={false}`.
 */
export function HostsUnreachableState({
  testID,
  withDetails = true,
}: {
  testID: string;
  withDetails?: boolean;
}) {
  const { t } = useTranslation();
  const { issues } = useHostsStrip();
  const [open, setOpen] = useState(false);
  const show = useCallback(() => setOpen(true), []);
  const close = useCallback(() => setOpen(false), []);
  const label = t("home.connections.viewDetails");
  const action = useMemo(() => ({ label, onPress: show }), [label, show]);
  return (
    <>
      <ListState
        kind="offline"
        title={t("navigation.lists.hostsUnreachable")}
        action={withDetails ? action : undefined}
        testID={testID}
      />
      {withDetails ? (
        <ConnectionIssuesSheet issues={[...issues]} visible={open} onClose={close} />
      ) : null}
    </>
  );
}
