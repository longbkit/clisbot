import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import {
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";

interface DisplayHost {
  serverId: string;
  label: string;
}

/**
 * The Hosts part of a list's Display menu: All Hosts, then each Host as a toggle. Shown only when
 * there is more than one Host to choose from.
 */
export function HostsDisplayItems({
  hosts,
  selected,
  onToggle,
  onClear,
  separated = false,
  testID,
}: {
  hosts: readonly DisplayHost[];
  selected: readonly string[];
  onToggle(serverId: string): void;
  onClear(): void;
  /** Other groups come before it in the menu. */
  separated?: boolean;
  testID: string;
}) {
  const { t } = useTranslation();
  if (hosts.length < 2) return null;
  return (
    <>
      {separated ? <DropdownMenuSeparator /> : null}
      <DropdownMenuLabel>{t("navigation.chatsDisplay.hosts")}</DropdownMenuLabel>
      <DropdownMenuItem
        selected={selected.length === 0}
        showSelectedCheck
        closeOnSelect={false}
        onSelect={onClear}
        testID={`${testID}-all-hosts`}
      >
        {t("navigation.chatsDisplay.allHosts")}
      </DropdownMenuItem>
      {hosts.map((host) => (
        <HostItem
          key={host.serverId}
          host={host}
          selected={selected.includes(host.serverId)}
          onToggle={onToggle}
          testID={`${testID}-host-${host.serverId}`}
        />
      ))}
    </>
  );
}

function HostItem({
  host,
  selected,
  onToggle,
  testID,
}: {
  host: DisplayHost;
  selected: boolean;
  onToggle(serverId: string): void;
  testID: string;
}) {
  const select = useCallback(() => onToggle(host.serverId), [host.serverId, onToggle]);
  return (
    <DropdownMenuItem
      selected={selected}
      showSelectedCheck
      closeOnSelect={false}
      onSelect={select}
      testID={testID}
    >
      {host.label}
    </DropdownMenuItem>
  );
}
