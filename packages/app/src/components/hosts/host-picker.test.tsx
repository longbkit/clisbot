import { expect, it } from "vitest";
import {
  ADD_HOST_OPTION_ID,
  ALL_HOSTS_OPTION_ID,
  getHostFilterPickerValue,
  getHostPickerLabel,
  HOST_PICKER_SEARCHABLE_THRESHOLD,
  shouldSearchHostPicker,
} from "./host-picker-constants";

const hosts = [{ serverId: "host-a", label: "Host A" }];

it.each([
  ["host-a", undefined, "Host A"],
  ["missing", undefined, "Host"],
  [ALL_HOSTS_OPTION_ID, { includeAllHost: true }, "All hosts"],
  ["missing", { includeAllHost: true }, "All hosts"],
  [ALL_HOSTS_OPTION_ID, undefined, "Host"],
  [ADD_HOST_OPTION_ID, { includeAddHost: true }, "Add host"],
])("resolves %s", (value, config, expected) => {
  expect(getHostPickerLabel(hosts, value, config)).toBe(expected);
});

it.each([
  [[], ALL_HOSTS_OPTION_ID],
  [["host-a"], "host-a"],
  [["host-a", "host-b"], ""],
])("maps host filters %j to picker value", (hostFilters, expected) => {
  expect(getHostFilterPickerValue(hostFilters)).toBe(expected);
});

it("shows search from four hosts when the picker asked for it", () => {
  expect(HOST_PICKER_SEARCHABLE_THRESHOLD).toBe(4);
  expect(shouldSearchHostPicker(3, true)).toBe(false);
  expect(shouldSearchHostPicker(4, true)).toBe(true);
  expect(shouldSearchHostPicker(4, false)).toBe(false);
  expect(shouldSearchHostPicker(10)).toBe(false);
});
