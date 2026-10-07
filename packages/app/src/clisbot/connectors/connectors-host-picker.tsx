import { useCallback } from "react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { DropdownTrigger } from "@/components/ui/dropdown-trigger";

/** Connectors belong to one Host; with several, this picks whose the screen shows. */
export function ConnectorsHostPicker({
  hosts,
  value,
  onChange,
}: {
  hosts: { serverId: string; label: string }[];
  value: string;
  onChange(serverId: string): void;
}) {
  const label = hosts.find((host) => host.serverId === value)?.label ?? "Host";
  return (
    <DropdownMenu>
      <DropdownTrigger accessibilityRole="button" accessibilityLabel={`Host: ${label}`} size="sm">
        {label}
      </DropdownTrigger>
      <DropdownMenuContent side="bottom" align="start" width={240}>
        {hosts.map((host) => (
          <HostOption
            key={host.serverId}
            host={host}
            selected={host.serverId === value}
            onChange={onChange}
          />
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function HostOption({
  host,
  selected,
  onChange,
}: {
  host: { serverId: string; label: string };
  selected: boolean;
  onChange(serverId: string): void;
}) {
  const select = useCallback(() => onChange(host.serverId), [host.serverId, onChange]);
  return (
    <DropdownMenuItem selected={selected} onSelect={select}>
      {host.label}
    </DropdownMenuItem>
  );
}
