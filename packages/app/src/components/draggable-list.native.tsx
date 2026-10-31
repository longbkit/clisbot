import { RefreshControl } from "react-native";
import { useCallback, useMemo, useRef, useState } from "react";
import DraggableFlatList, {
  NestableDraggableFlatList,
  type RenderItemParams,
} from "react-native-draggable-flatlist";
import { useUnistyles } from "react-native-unistyles";
import type { DraggableListProps, DraggableRenderItemInfo } from "./draggable-list.types";

export type { DraggableListProps, DraggableRenderItemInfo };

const SCROLL_ENABLED_FLEX_STYLE = { flex: 1 };

export function DraggableList<T>({
  data,
  keyExtractor,
  renderItem,
  onDragEnd,
  style,
  containerStyle,
  contentContainerStyle,
  testID,
  ListFooterComponent,
  ListHeaderComponent,
  ListEmptyComponent,
  showsVerticalScrollIndicator = true,
  scrollEnabled = true,
  useDragHandle: _useDragHandle = false,
  refreshing,
  onRefresh,
  extraData,
  simultaneousGestureRef,
  gestureHostPresented,
  waitFor,
  onDragBegin: onDragBeginProp,
  onDragSettled,
  nestable = false,
}: DraggableListProps<T>) {
  const { theme } = useUnistyles();
  const [isDragging, setIsDragging] = useState(false);
  const dragInProgress = useRef(false);

  // Pass the ref directly to DraggableFlatList - it handles gesture
  // coordination internally for nestable lists.
  const simultaneousHandlers = useMemo(
    () => (simultaneousGestureRef ? [simultaneousGestureRef] : undefined),
    [simultaneousGestureRef],
  );

  const refreshColors = useMemo(
    () => [theme.colors.foregroundMuted],
    [theme.colors.foregroundMuted],
  );

  const handleRenderItem = useCallback(
    ({ item, drag, isActive, getIndex }: RenderItemParams<T>) => {
      const index = getIndex() ?? 0;
      const info: DraggableRenderItemInfo<T> = {
        item,
        index,
        drag,
        isActive,
      };
      return renderItem(info);
    },
    [renderItem],
  );

  const handleDragEnd = useCallback(
    ({ data: newData }: { data: T[] }) => {
      setIsDragging(false);
      try {
        onDragEnd(newData);
      } finally {
        if (dragInProgress.current) {
          dragInProgress.current = false;
          onDragSettled?.();
        }
      }
    },
    [onDragEnd, onDragSettled],
  );

  const handleDragBegin = useCallback(() => {
    dragInProgress.current = true;
    setIsDragging(true);
    onDragBeginProp?.();
  }, [onDragBeginProp]);

  const handleDragTerminate = useCallback(() => {
    setIsDragging(false);
    if (dragInProgress.current) {
      dragInProgress.current = false;
      onDragSettled?.();
    }
  }, [onDragSettled]);

  const handleRelease = useCallback(() => {
    setIsDragging(false);
  }, []);

  const showRefreshControl = Boolean(onRefresh) && (!isDragging || Boolean(refreshing));
  const resolvedContainerStyle =
    containerStyle ?? (scrollEnabled ? SCROLL_ENABLED_FLEX_STYLE : undefined);
  const shouldShowRefreshControl = showRefreshControl && !nestable;
  const ListComponent: typeof DraggableFlatList = (
    nestable ? (NestableDraggableFlatList as unknown) : DraggableFlatList
  ) as typeof DraggableFlatList;

  const refreshControl = useMemo(
    () =>
      shouldShowRefreshControl ? (
        <RefreshControl
          refreshing={refreshing ?? false}
          onRefresh={onRefresh}
          tintColor={theme.colors.foregroundMuted}
          colors={refreshColors}
        />
      ) : undefined,
    [shouldShowRefreshControl, refreshing, onRefresh, theme.colors.foregroundMuted, refreshColors],
  );

  return (
    <ListComponent
      testID={testID}
      data={data}
      keyExtractor={keyExtractor}
      renderItem={handleRenderItem}
      onDragEnd={handleDragEnd}
      style={style}
      containerStyle={resolvedContainerStyle}
      contentContainerStyle={contentContainerStyle}
      ListFooterComponent={ListFooterComponent}
      ListHeaderComponent={ListHeaderComponent}
      ListEmptyComponent={ListEmptyComponent}
      showsVerticalScrollIndicator={showsVerticalScrollIndicator}
      scrollEnabled={scrollEnabled}
      extraData={extraData}
      simultaneousHandlers={simultaneousHandlers}
      dragGestureHostPresented={gestureHostPresented}
      // Higher activation distance reduces accidental drag capture while nested
      // lists are inside a scroll container.
      activationDistance={20}
      onDragBegin={handleDragBegin}
      onDragTerminate={handleDragTerminate}
      onRelease={handleRelease}
      // @ts-ignore - waitFor is supported by RNGH FlatList but missing from DraggableFlatList types
      waitFor={waitFor}
      refreshControl={refreshControl}
    />
  );
}
