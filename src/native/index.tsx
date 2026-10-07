import { useCallback, useRef } from "react";
import { registrationOrder, type ScanEntry } from "../core/controller";
import {
  ScanProvider as BaseProvider,
  useScanController,
  useScanGroup as useBaseGroup,
  useScanItem as useBaseItem,
  type ScanGroupOptions,
  type ScanGroupState,
  type ScanItemOptions,
  type ScanItemState,
  type ScanProviderProps,
} from "../react";

/** The part of a React Native host view this package needs. */
export interface Measurable {
  measureInWindow(callback: (x: number, y: number, width: number, height: number) => void): void;
}

export interface Placement {
  x: number;
  y: number;
  width: number;
  height: number;
}

const isPlacement = (value: unknown): value is Placement =>
  typeof value === "object" &&
  value !== null &&
  typeof (value as Placement).x === "number" &&
  typeof (value as Placement).y === "number";

/** Items whose tops are this close sit in the same row. */
export const ROW_TOLERANCE = 4;

/** Explicit order first, then reading order on screen (top to bottom, then left to right), then registration order. */
export function screenOrder(a: ScanEntry, b: ScanEntry): number {
  if (a.order !== undefined || b.order !== undefined) return registrationOrder(a, b);
  if (isPlacement(a.anchor) && isPlacement(b.anchor)) {
    const dy = a.anchor.y - b.anchor.y;
    if (Math.abs(dy) > ROW_TOLERANCE) return dy;
    const dx = a.anchor.x - b.anchor.x;
    if (dx !== 0) return dx;
  }
  return registrationOrder(a, b);
}

export function ScanProvider({ compare = screenOrder, ...props }: ScanProviderProps) {
  return <BaseProvider compare={compare} {...props} />;
}

function useMeasuredAnchor<V extends Measurable>(id: string) {
  const controller = useScanController();
  const view = useRef<V | null>(null);
  const measure = useCallback(() => {
    view.current?.measureInWindow((x, y, width, height) => {
      if ([x, y, width, height].every(Number.isFinite)) {
        controller.setAnchor(id, { x, y, width, height });
      }
    });
  }, [controller, id]);
  const ref = useCallback(
    (node: V | null) => {
      view.current = node;
      if (node) measure();
      else controller.setAnchor(id, undefined);
    },
    [controller, id, measure],
  );
  return { ref, onLayout: measure, measure };
}

export interface NativeAnchor<V extends Measurable> {
  /** Attach to the host view. */
  ref: (node: V | null) => void;
  /** Attach to the same view's onLayout so the order follows layout changes. */
  onLayout: () => void;
  /** Measure again, for example after scrolling. */
  measure: () => void;
}

export type NativeScanItem<V extends Measurable> = ScanItemState & NativeAnchor<V>;

/** Registers an item ordered by where its view sits on screen. */
export function useScanItem<V extends Measurable = Measurable>(
  id: string,
  options: ScanItemOptions = {},
): NativeScanItem<V> {
  const state = useBaseItem(id, options);
  return { ...state, ...useMeasuredAnchor<V>(id) };
}

export type NativeScanGroup<V extends Measurable> = ScanGroupState & NativeAnchor<V>;

/** Registers a group ordered by where its view sits on screen. Wrap its children in ScanGroupScope. */
export function useScanGroup<V extends Measurable = Measurable>(
  id: string,
  options: ScanGroupOptions = {},
): NativeScanGroup<V> {
  const state = useBaseGroup(id, options);
  return { ...state, ...useMeasuredAnchor<V>(id) };
}

export {
  ScanGroupScope,
  useScanController,
  useScanner,
  useScanSnapshot,
  type ScanGroupState,
  type ScanItemState,
} from "../react";
