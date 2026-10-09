import type { ScanAction } from "./actions";
import { ItemScanner, Policy } from "./itemScanner";
import { group, leaf, type ScanNode } from "./navigator";
import { resolveOptions, type ScanOptions } from "./options";

export const TICK_MS = 33;
export const MAX_ELAPSED_MS = 250;

export type Activation = void | unknown | PromiseLike<unknown>;

export interface ScanEntry {
  readonly kind: "item" | "group";
  readonly id: string;
  readonly parentId: string | undefined;
  readonly order: number | undefined;
  /** Registration sequence, the fallback order. */
  readonly sequence: number;
  /** Whatever a platform adapter attached for ordering, such as a DOM element or a measured position. */
  readonly anchor: unknown;
}

export interface ItemRegistration {
  parentId?: string;
  order?: number;
  disabled?: boolean;
  onActivate?: () => Activation;
}

export interface GroupRegistration {
  parentId?: string;
  order?: number;
}

export type Highlight =
  | { kind: "item"; id: string }
  | { kind: "group"; id: string }
  | { kind: "escape"; groupId: string };

export interface ScanSnapshot {
  active: boolean;
  paused: boolean;
  /** Automatic scanning ran out of passes, or is waiting after a selection, until Select. */
  suspended: boolean;
  waiting: boolean;
  /** An asynchronous activation is in progress. */
  pending: boolean;
  highlight: Highlight | null;
  /** Groups entered, outermost first. */
  path: readonly string[];
}

export interface Scheduler {
  setInterval(callback: () => void, ms: number): unknown;
  clearInterval(handle: unknown): void;
  now(): number;
}

export interface ScanControllerOptions {
  options?: Partial<ScanOptions>;
  policy?: Policy;
  /** Continue scanning after an item is activated, or stop. */
  afterSelection?: "continue" | "stop";
  compare?: (a: ScanEntry, b: ScanEntry) => number;
  scheduler?: Scheduler;
  onSelect?: (id: string) => void;
  onError?: (error: unknown, id: string) => void;
}

export const registrationOrder = (a: ScanEntry, b: ScanEntry): number =>
  (a.order ?? Number.POSITIVE_INFINITY) - (b.order ?? Number.POSITIVE_INFINITY) ||
  a.sequence - b.sequence;

const defaultScheduler: Scheduler = {
  setInterval: (callback, ms) => globalThis.setInterval(callback, ms),
  clearInterval: (handle) => globalThis.clearInterval(handle as ReturnType<typeof setInterval>),
  now: () => (globalThis.performance ?? Date).now(),
};

const INACTIVE: ScanSnapshot = Object.freeze({
  active: false,
  paused: false,
  suspended: false,
  waiting: false,
  pending: false,
  highlight: null,
  path: Object.freeze([]) as readonly string[],
});

type Entry = Omit<ScanEntry, "anchor">;

interface Item extends Entry {
  disabled: boolean;
  onActivate: (() => Activation) | undefined;
}

function isThenable(value: unknown): value is PromiseLike<unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as PromiseLike<unknown>).then === "function"
  );
}

function sameHighlight(a: Highlight | null, b: Highlight | null): boolean {
  if (a === null || b === null) return a === b;
  if (a.kind !== b.kind) return false;
  return a.kind === "escape" ? a.groupId === (b as typeof a).groupId : a.id === (b as typeof a).id;
}

function sameSnapshot(a: ScanSnapshot, b: ScanSnapshot): boolean {
  return (
    a.active === b.active &&
    a.paused === b.paused &&
    a.suspended === b.suspended &&
    a.waiting === b.waiting &&
    a.pending === b.pending &&
    sameHighlight(a.highlight, b.highlight) &&
    a.path.length === b.path.length &&
    a.path.every((id, index) => id === b.path[index])
  );
}

export class ScanController {
  private readonly items = new Map<string, Item>();
  private readonly groups = new Map<string, Entry>();
  private readonly anchors = new Map<string, unknown>();
  private readonly listeners = new Set<() => void>();
  private readonly scheduler: Scheduler;
  private readonly policy: Policy;
  private readonly settings: Required<
    Pick<ScanControllerOptions, "afterSelection" | "compare">
  > &
    Pick<ScanControllerOptions, "onSelect" | "onError">;
  private scanner: ItemScanner<string>;
  private readonly sequences = new Map<string, number>();
  private sequence = 0;
  private active = false;
  private paused = false;
  private switchHeld = false;
  private clock: unknown;
  private last = 0;
  private snapshot: ScanSnapshot = INACTIVE;
  private dirty = false;
  private destroyed = false;

  constructor(config: ScanControllerOptions = {}) {
    this.scheduler = config.scheduler ?? defaultScheduler;
    this.policy = config.policy ?? Policy.KEYBOARD;
    this.settings = {
      afterSelection: config.afterSelection ?? "continue",
      compare: config.compare ?? registrationOrder,
      onSelect: config.onSelect,
      onError: config.onError,
    };
    this.scanner = ItemScanner.configured([], this.policy, resolveOptions(config.options));
  }

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  readonly getSnapshot = (): ScanSnapshot => this.snapshot;

  get options(): ScanOptions {
    return this.scanner.options;
  }

  setOptions(options: Partial<ScanOptions>): void {
    const next = resolveOptions({ ...this.scanner.options, ...options });
    const current = this.scanner.options;
    if ((Object.keys(next) as (keyof ScanOptions)[]).every((key) => next[key] === current[key])) {
      return;
    }
    const patternChanged = next.pattern !== current.pattern;
    this.scanner.options = next;
    if (patternChanged) {
      this.scanner = ItemScanner.configured(this.nodes(), this.policy, next);
    } else {
      this.scanner.restartInterval();
    }
    this.update();
  }

  /** Ids are shared by items and groups and must be unique across both. */
  registerItem(id: string, registration: ItemRegistration = {}, anchor?: unknown): () => void {
    if (anchor !== undefined) this.anchors.set(id, anchor);
    const item: Item = {
      kind: "item",
      id,
      parentId: registration.parentId,
      order: registration.order,
      sequence: this.sequenceOf(id),
      disabled: registration.disabled ?? false,
      onActivate: registration.onActivate,
    };
    this.items.set(id, item);
    this.contentChanged();
    return () => {
      if (this.items.get(id) === item) {
        this.items.delete(id);
        this.contentChanged();
      }
    };
  }

  registerGroup(id: string, registration: GroupRegistration = {}, anchor?: unknown): () => void {
    if (anchor !== undefined) this.anchors.set(id, anchor);
    const entry: Entry = {
      kind: "group",
      id,
      parentId: registration.parentId,
      order: registration.order,
      sequence: this.sequenceOf(id),
    };
    this.groups.set(id, entry);
    this.contentChanged();
    return () => {
      if (this.groups.get(id) === entry) {
        this.groups.delete(id);
        this.contentChanged();
      }
    };
  }

  /** Attaches or refreshes what the comparator orders by, such as an element or a position. Undefined clears it. */
  setAnchor(id: string, anchor: unknown): void {
    if (this.anchors.get(id) === anchor) return;
    if (anchor === undefined) this.anchors.delete(id);
    else this.anchors.set(id, anchor);
    if (this.items.has(id) || this.groups.has(id)) this.contentChanged();
  }

  /** Re-reads the order of everything registered, for when the layout moved. */
  reorder(): void {
    this.contentChanged();
  }

  /**
   * Holds automatic movement while a switch is down, as Switchify PC does, so the
   * highlight cannot move away from the item being selected. Movement continues
   * from where it paused once the switch is released.
   */
  setSwitchHeld(held: boolean): void {
    if (this.switchHeld === held) return;
    this.switchHeld = held;
    this.update();
  }

  start(): void {
    if (this.active) return;
    this.active = true;
    this.paused = false;
    this.scanner.restart();
    this.update();
  }

  stop(): void {
    if (!this.active) return;
    this.active = false;
    this.paused = false;
    this.scanner.restart();
    this.update();
  }

  dispatch(action: ScanAction): void {
    if (this.destroyed) return;
    if (action === "stop") {
      this.stop();
      return;
    }
    if (!this.active) {
      if (action === "select") this.start();
      return;
    }
    if (action === "pause") {
      this.paused = !this.paused;
      this.update();
      return;
    }
    const selection = this.scanner.handle(action);
    if (selection !== undefined) this.activate(selection);
    this.update();
  }

  /** Advances automatic scanning by hand, mainly for tests and custom clocks. */
  tick(elapsedMs: number): void {
    if (!this.moving() || elapsedMs <= 0) return;
    this.scanner.advance(Math.min(elapsedMs, MAX_ELAPSED_MS), this.scanner.options.intervalMs);
    this.update();
  }

  destroy(): void {
    this.destroyed = true;
    this.active = false;
    this.stopClock();
    this.listeners.clear();
  }

  private sequenceOf(key: string): number {
    let sequence = this.sequences.get(key);
    if (sequence === undefined) {
      sequence = this.sequence++;
      this.sequences.set(key, sequence);
    }
    return sequence;
  }

  private activate(id: string): void {
    const item = this.items.get(id);
    this.settings.onSelect?.(id);
    let result: Activation;
    try {
      result = item?.onActivate?.();
    } catch (error) {
      this.settings.onError?.(error, id);
      this.afterActivation();
      return;
    }
    if (!isThenable(result)) {
      this.afterActivation();
      return;
    }
    const token = this.scanner.beginActivation();
    if (token === undefined) {
      this.afterActivation();
      return;
    }
    const settle = () => {
      if (!this.destroyed && this.scanner.completeActivation(token)) {
        this.afterActivation();
        this.update();
      }
    };
    result.then(settle, (error: unknown) => {
      this.settings.onError?.(error, id);
      settle();
    });
  }

  private afterActivation(): void {
    if (this.settings.afterSelection === "stop") {
      this.active = false;
      this.paused = false;
      this.scanner.restart();
    } else {
      this.scanner.continueAfterSelection();
    }
  }

  private contentChanged(): void {
    if (this.dirty) return;
    this.dirty = true;
    queueMicrotask(() => {
      this.dirty = false;
      if (this.destroyed) return;
      this.scanner.replace(this.nodes());
      this.update();
    });
  }

  /** Applies registrations made so far without waiting for the microtask. */
  flush(): void {
    if (!this.dirty) return;
    this.dirty = false;
    this.scanner.replace(this.nodes());
    this.update();
  }

  private nodes(): ScanNode<string>[] {
    const children = new Map<string | undefined, ScanEntry[]>();
    const place = ({ kind, id, parentId, order, sequence }: Entry) => {
      const entry: ScanEntry = { kind, id, parentId, order, sequence, anchor: this.anchors.get(id) };
      const parent = parentId !== undefined && this.groups.has(parentId) ? parentId : undefined;
      const list = children.get(parent);
      if (list) list.push(entry);
      else children.set(parent, [entry]);
    };
    for (const item of this.items.values()) if (!item.disabled) place(item);
    for (const entry of this.groups.values()) place(entry);
    const build = (parent: string | undefined, seen: Set<string>): ScanNode<string>[] =>
      (children.get(parent) ?? [])
        .sort(this.settings.compare)
        .flatMap((entry): ScanNode<string>[] => {
          if (entry.kind === "item") return [leaf(entry.id)];
          if (seen.has(entry.id)) return [];
          return [group(entry.id, build(entry.id, new Set(seen).add(entry.id)))];
        });
    return build(undefined, new Set());
  }

  private moving(): boolean {
    return (
      this.active &&
      !this.paused &&
      !this.switchHeld &&
      this.scanner.options.automatic &&
      !this.scanner.suspended &&
      !this.scanner.pending()
    );
  }

  private startClock(): void {
    if (this.clock !== undefined) return;
    this.last = this.scheduler.now();
    this.clock = this.scheduler.setInterval(() => {
      const now = this.scheduler.now();
      const elapsed = now - this.last;
      this.last = now;
      this.tick(elapsed);
    }, TICK_MS);
  }

  private stopClock(): void {
    if (this.clock === undefined) return;
    this.scheduler.clearInterval(this.clock);
    this.clock = undefined;
  }

  private update(): void {
    if (this.destroyed) return;
    if (this.moving()) this.startClock();
    else this.stopClock();
    const next = this.read();
    if (sameSnapshot(next, this.snapshot)) return;
    this.snapshot = next;
    for (const listener of [...this.listeners]) listener();
  }

  private read(): ScanSnapshot {
    if (!this.active) return INACTIVE;
    const nav = this.scanner.nav;
    const path: string[] = [];
    let nodes = nav.rootNodes();
    for (const index of nav.path()) {
      const node = nodes[index];
      if (!node || node.kind === "leaf") break;
      if (node.kind === "group") path.push(node.id);
      nodes = node.children;
    }
    let highlight: Highlight | null = null;
    if (nav.escaping()) {
      const parent = nav.parent();
      if (parent?.kind === "group") highlight = { kind: "escape", groupId: parent.id };
    } else {
      const node = nav.current();
      if (node?.kind === "leaf") highlight = { kind: "item", id: node.value };
      else if (node?.kind === "group") highlight = { kind: "group", id: node.id };
    }
    return {
      active: true,
      paused: this.paused,
      suspended: this.scanner.suspended,
      waiting: this.scanner.waiting(),
      pending: this.scanner.pending(),
      highlight,
      path,
    };
  }
}
