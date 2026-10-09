import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import type { ScanAction } from "../core/actions";
import {
  ScanController,
  type Activation,
  type ScanControllerOptions,
  type ScanSnapshot,
} from "../core/controller";
import type { ScanOptions } from "../core/options";

const ControllerContext = createContext<ScanController | null>(null);

interface Scope {
  id: string | undefined;
  /** Enclosing group ids, outermost first, including this one. */
  chain: readonly string[];
}

const ROOT: Scope = { id: undefined, chain: [] };
const ScopeContext = createContext<Scope>(ROOT);

export interface ScanProviderProps
  extends Pick<ScanControllerOptions, "policy" | "afterSelection" | "compare" | "scheduler"> {
  /** Use an existing controller instead of creating one. */
  controller?: ScanController;
  options?: Partial<ScanOptions>;
  onSelect?: (id: string) => void;
  onError?: (error: unknown, id: string) => void;
  children?: ReactNode;
}

export function ScanProvider({
  controller: provided,
  options,
  policy,
  afterSelection,
  compare,
  scheduler,
  onSelect,
  onError,
  children,
}: ScanProviderProps) {
  const callbacks = useRef({ onSelect, onError });
  callbacks.current = { onSelect, onError };
  const [created] = useState(() =>
    provided
      ? null
      : new ScanController({
          options,
          policy,
          afterSelection,
          compare,
          scheduler,
          onSelect: (id) => callbacks.current.onSelect?.(id),
          onError: (error, id) => callbacks.current.onError?.(error, id),
        }),
  );
  const controller = provided ?? created!;
  const {
    automatic,
    intervalMs,
    direction,
    passLimit,
    pattern,
    nextScan,
    startFrom,
  } = options ?? {};
  useEffect(() => {
    controller.setOptions({
      automatic,
      intervalMs,
      direction,
      passLimit,
      pattern,
      nextScan,
      startFrom,
    });
  }, [controller, automatic, intervalMs, direction, passLimit, pattern, nextScan, startFrom]);
  useEffect(() => (created ? () => created.stop() : undefined), [created]);
  return <ControllerContext.Provider value={controller}>{children}</ControllerContext.Provider>;
}

let inert: ScanController | undefined;

/**
 * Outside a ScanProvider the hooks use one controller that is never started, so a
 * shared component can call them whether or not its screen is scanned.
 */
export function useScanController(): ScanController {
  const controller = useContext(ControllerContext);
  if (controller) return controller;
  inert ??= new ScanController();
  return inert;
}

export function useScanSnapshot(): ScanSnapshot {
  const controller = useScanController();
  return useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
}

export interface Scanner {
  snapshot: ScanSnapshot;
  controller: ScanController;
  dispatch: (action: ScanAction) => void;
  start: () => void;
  stop: () => void;
}

export function useScanner(): Scanner {
  const controller = useScanController();
  const snapshot = useScanSnapshot();
  return useMemo(
    () => ({
      snapshot,
      controller,
      dispatch: (action: ScanAction) => controller.dispatch(action),
      start: () => controller.start(),
      stop: () => controller.stop(),
    }),
    [controller, snapshot],
  );
}

function useSelected<T extends string>(read: (snapshot: ScanSnapshot) => T): T {
  const controller = useScanController();
  const select = useCallback(() => read(controller.getSnapshot()), [controller, read]);
  return useSyncExternalStore(controller.subscribe, select, select);
}

export interface ScanItemOptions {
  onActivate?: () => Activation;
  disabled?: boolean;
  /** Explicit position among siblings; otherwise the platform order is used. */
  order?: number;
}

export interface ScanItemState {
  /** Scanning is running. */
  active: boolean;
  /** This item is the one Select would activate. */
  highlighted: boolean;
  /** A group containing this item is highlighted. */
  groupHighlighted: boolean;
}

type ItemKey = "idle" | "active" | "highlighted" | "group";

const ITEM_STATES: Record<ItemKey, ScanItemState> = {
  idle: Object.freeze({ active: false, highlighted: false, groupHighlighted: false }),
  active: Object.freeze({ active: true, highlighted: false, groupHighlighted: false }),
  highlighted: Object.freeze({ active: true, highlighted: true, groupHighlighted: false }),
  group: Object.freeze({ active: true, highlighted: false, groupHighlighted: true }),
};

/** Registers an item and reports its highlight. Platform wrappers add an anchor for ordering. */
export function useScanItem(
  id: string,
  { onActivate, disabled, order }: ScanItemOptions = {},
  anchor?: unknown,
): ScanItemState {
  const controller = useScanController();
  const scope = useContext(ScopeContext);
  const activation = useRef(onActivate);
  activation.current = onActivate;
  useEffect(
    () =>
      controller.registerItem(
        id,
        { parentId: scope.id, order, disabled, onActivate: () => activation.current?.() },
        anchor,
      ),
    [controller, id, scope.id, order, disabled, anchor],
  );
  const read = useCallback(
    (snapshot: ScanSnapshot): ItemKey => {
      const highlight = snapshot.highlight;
      if (!snapshot.active) return "idle";
      if (highlight?.kind === "item" && highlight.id === id) return "highlighted";
      if (highlight?.kind === "group" && scope.chain.includes(highlight.id)) return "group";
      return "active";
    },
    [id, scope.chain],
  );
  return ITEM_STATES[useSelected(read)];
}

export interface ScanGroupOptions {
  order?: number;
  /** Confine scanning to this group while it is mounted, as for an open dialog. */
  exclusive?: boolean;
}

export interface ScanGroupState {
  active: boolean;
  /** The whole group is highlighted; Select enters it. */
  highlighted: boolean;
  /** Scanning is inside this group. */
  entered: boolean;
  /** The way out of this group is highlighted; Select leaves it. */
  escapeHighlighted: boolean;
  /** An enclosing group is highlighted. */
  parentHighlighted: boolean;
}

type GroupKey = `${0 | 1}${0 | 1}${0 | 1}${0 | 1}${0 | 1}`;
const groupStates = new Map<GroupKey, ScanGroupState>();

function groupState(key: GroupKey): ScanGroupState {
  let state = groupStates.get(key);
  if (!state) {
    state = Object.freeze({
      active: key[0] === "1",
      highlighted: key[1] === "1",
      entered: key[2] === "1",
      escapeHighlighted: key[3] === "1",
      parentHighlighted: key[4] === "1",
    });
    groupStates.set(key, state);
  }
  return state;
}

/** Registers a group in the current scope. Wrap its children in ScanGroupScope. */
export function useScanGroup(
  id: string,
  { order, exclusive }: ScanGroupOptions = {},
  anchor?: unknown,
): ScanGroupState {
  const controller = useScanController();
  const scope = useContext(ScopeContext);
  useEffect(
    () => controller.registerGroup(id, { parentId: scope.id, order, exclusive }, anchor),
    [controller, id, scope.id, order, exclusive, anchor],
  );
  const read = useCallback(
    (snapshot: ScanSnapshot): GroupKey => {
      const highlight = snapshot.highlight;
      const bit = (value: boolean) => (value ? "1" : "0");
      return `${bit(snapshot.active)}${bit(highlight?.kind === "group" && highlight.id === id)}${bit(
        snapshot.path.includes(id),
      )}${bit(highlight?.kind === "escape" && highlight.groupId === id)}${bit(
        highlight?.kind === "group" && scope.chain.includes(highlight.id),
      )}` as GroupKey;
    },
    [id, scope.chain],
  );
  return groupState(useSelected(read));
}

/** Makes items and groups rendered inside it belong to the group with this id. */
export function ScanGroupScope({ id, children }: { id: string; children?: ReactNode }) {
  const parent = useContext(ScopeContext);
  const scope = useMemo<Scope>(() => ({ id, chain: [...parent.chain, id] }), [id, parent.chain]);
  return <ScopeContext.Provider value={scope}>{children}</ScopeContext.Provider>;
}

export interface ScanGroupProps extends ScanGroupOptions {
  id: string;
  children?: ReactNode | ((state: ScanGroupState) => ReactNode);
}

/** A group with no element of its own. Use the dom or native wrappers to order groups by layout. */
export function ScanGroup({ id, order, exclusive, children }: ScanGroupProps) {
  const state = useScanGroup(id, { order, exclusive });
  return (
    <ScanGroupScope id={id}>{typeof children === "function" ? children(state) : children}</ScanGroupScope>
  );
}

export type { ScanAction } from "../core/actions";
export type { Activation, Highlight, ScanSnapshot } from "../core/controller";
export { ScanController } from "../core/controller";
export { Policy } from "../core/itemScanner";
export type { ScanOptions } from "../core/options";
