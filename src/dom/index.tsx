import { useCallback, useEffect, useRef } from "react";
import { registrationOrder, type ScanEntry } from "../core/controller";
import {
  ScanProvider as BaseProvider,
  useScanController,
  useScanGroup as useBaseGroup,
  useScanItem as useBaseItem,
  useScanSnapshot,
  type ScanGroupOptions,
  type ScanGroupState,
  type ScanItemOptions,
  type ScanItemState,
  type ScanProviderProps,
} from "../react";

const isElement = (value: unknown): value is Element =>
  typeof Element !== "undefined" && value instanceof Element;

/** Explicit order first, then document order, then registration order. */
export function documentOrder(a: ScanEntry, b: ScanEntry): number {
  if (a.order !== undefined || b.order !== undefined) return registrationOrder(a, b);
  if (isElement(a.anchor) && isElement(b.anchor) && a.anchor !== b.anchor) {
    const position = a.anchor.compareDocumentPosition(b.anchor);
    if (position & Node.DOCUMENT_POSITION_FOLLOWING) return -1;
    if (position & Node.DOCUMENT_POSITION_PRECEDING) return 1;
  }
  return registrationOrder(a, b);
}

export interface DomScanProviderProps extends ScanProviderProps {
  /** Re-read document order while scanning when the page changes. Defaults to true. */
  observe?: boolean;
}

function ReorderOnMutation() {
  const controller = useScanController();
  const { active } = useScanSnapshot();
  useEffect(() => {
    if (!active || typeof MutationObserver === "undefined" || !document.body) return;
    const observer = new MutationObserver(() => controller.reorder());
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [controller, active]);
  return null;
}

export function ScanProvider({ compare = documentOrder, observe = true, children, ...props }: DomScanProviderProps) {
  return (
    <BaseProvider compare={compare} {...props}>
      {observe && <ReorderOnMutation />}
      {children}
    </BaseProvider>
  );
}

export interface DomScanItemOptions extends ScanItemOptions {
  /** Scroll the item into view when it is highlighted. Defaults to true. */
  scrollIntoView?: boolean;
}

function useAnchorRef<E extends Element>(id: string, scroll: boolean, highlighted: boolean) {
  const controller = useScanController();
  const element = useRef<E | null>(null);
  const ref = useCallback(
    (node: E | null) => {
      element.current = node;
      controller.setAnchor(id, node ?? undefined);
    },
    [controller, id],
  );
  useEffect(() => {
    if (scroll && highlighted) element.current?.scrollIntoView?.({ block: "nearest", inline: "nearest" });
  }, [scroll, highlighted]);
  return ref;
}

export interface DomScanItem<E extends Element> extends ScanItemState {
  ref: (node: E | null) => void;
}

/** Registers an item ordered by its element's place in the document. */
export function useScanItem<E extends Element = HTMLElement>(
  id: string,
  { scrollIntoView = true, ...options }: DomScanItemOptions = {},
): DomScanItem<E> {
  const state = useBaseItem(id, options);
  const ref = useAnchorRef<E>(id, scrollIntoView, state.highlighted);
  return { ...state, ref };
}

export interface DomScanGroupOptions extends ScanGroupOptions {
  scrollIntoView?: boolean;
}

export interface DomScanGroup<E extends Element> extends ScanGroupState {
  ref: (node: E | null) => void;
}

/** Registers a group ordered by its element. Wrap its children in ScanGroupScope. */
export function useScanGroup<E extends Element = HTMLElement>(
  id: string,
  { scrollIntoView = true, ...options }: DomScanGroupOptions = {},
): DomScanGroup<E> {
  const state = useBaseGroup(id, options);
  const ref = useAnchorRef<E>(id, scrollIntoView, state.highlighted || state.escapeHighlighted);
  return { ...state, ref };
}

/** Data attributes describing an item's scan state, for styling with CSS. */
export function scanItemAttributes(state: ScanItemState): Record<string, string | undefined> {
  return {
    "data-scan-highlighted": state.highlighted ? "" : undefined,
    "data-scan-group-highlighted": state.groupHighlighted ? "" : undefined,
  };
}

/** Data attributes describing a group's scan state, for styling with CSS. */
export function scanGroupAttributes(state: ScanGroupState): Record<string, string | undefined> {
  return {
    "data-scan-highlighted": state.highlighted || state.parentHighlighted ? "" : undefined,
    "data-scan-entered": state.entered ? "" : undefined,
    "data-scan-escape-highlighted": state.escapeHighlighted ? "" : undefined,
  };
}

export {
  ScanGroupScope,
  useScanController,
  useScanner,
  useScanSnapshot,
  type ScanGroupState,
  type ScanItemState,
} from "../react";
