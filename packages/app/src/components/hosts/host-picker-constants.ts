export const ADD_HOST_OPTION_ID = "__add_host__";
export const ALL_HOSTS_OPTION_ID = "__all_hosts__";
export const ENABLE_BUILT_IN_DAEMON_OPTION_ID = "__enable_built_in_daemon__";

/** Search appears once a picker has this many real hosts, not counting All/Add rows. */
export const HOST_PICKER_SEARCHABLE_THRESHOLD = 4;

export function shouldSearchHostPicker(hostCount: number, searchable?: boolean): boolean {
  return searchable === true && hostCount >= HOST_PICKER_SEARCHABLE_THRESHOLD;
}

/**
 * Combobox value for a sidebar host filter: All hosts when nothing is pinned, the host when
 * exactly one is pinned, empty when several are pinned so no exclusive check is implied.
 */
export function getHostFilterPickerValue(hostFilters: readonly string[]): string {
  if (hostFilters.length === 0) return ALL_HOSTS_OPTION_ID;
  if (hostFilters.length === 1) return hostFilters[0] ?? ALL_HOSTS_OPTION_ID;
  return "";
}

export function getHostPickerLabel(
  hosts: Array<{ label: string; serverId: string }>,
  value: string,
  config?: { includeAllHost?: boolean; includeAddHost?: boolean },
): string {
  if (config?.includeAllHost && value === ALL_HOSTS_OPTION_ID) {
    return "All hosts";
  }
  if (config?.includeAddHost && value === ADD_HOST_OPTION_ID) {
    return "Add host";
  }
  return (
    hosts.find((host) => host.serverId === value)?.label ??
    (config?.includeAllHost ? "All hosts" : "Host")
  );
}
