/** @vitest-environment jsdom */
import React from "react";
import { act, render } from "@testing-library/react";
import { expect, it, vi } from "vitest";

const captured = vi.hoisted(() => ({ props: {} as Record<string, (...args: unknown[]) => void> }));
vi.mock("@/components/ui/scroll-view", () => ({
  useContentDrag: () => ({ attach: () => () => {}, setActive: () => {} }),
}));
vi.mock("react-native", () => ({ RefreshControl: () => null }));
vi.mock("react-native-unistyles", () => ({
  useUnistyles: () => ({ theme: { colors: { foregroundMuted: "#888" } } }),
}));
vi.mock("react-native-draggable-flatlist", () => {
  const Fake = (props: typeof captured.props) => {
    captured.props = props;
    return null;
  };
  return { default: Fake, NestableDraggableFlatList: Fake };
});
import { DraggableList } from "./draggable-list.native";

const items = ["a", "b"];
const keyOf = (item: string) => item;
const renderItem = () => <span />;

it("holds deferred layout work until a drag ends or is cancelled", () => {
  const begin = vi.fn();
  const settled = vi.fn();
  const reorder = vi.fn();
  render(
    <DraggableList
      data={items}
      keyExtractor={keyOf}
      renderItem={renderItem}
      onDragBegin={begin}
      onDragSettled={settled}
      onDragEnd={reorder}
      nestable
    />,
  );
  act(() => captured.props.onDragBegin());
  expect(begin).toHaveBeenCalledTimes(1);
  act(() => captured.props.onRelease());
  expect(settled).not.toHaveBeenCalled();
  act(() => captured.props.onDragEnd({ data: ["b", "a"], from: 0, to: 1 }));
  expect(reorder).toHaveBeenCalledWith(["b", "a"], "a");
  expect(settled).toHaveBeenCalledTimes(1);
  act(() => captured.props.onDragTerminate());
  expect(settled).toHaveBeenCalledTimes(1);
  act(() => captured.props.onDragBegin());
  act(() => captured.props.onDragTerminate());
  expect(begin).toHaveBeenCalledTimes(2);
  expect(settled).toHaveBeenCalledTimes(2);
});
