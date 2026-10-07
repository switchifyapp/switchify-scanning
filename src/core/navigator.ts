export type ScanNode<T> =
  | { kind: "branch"; children: ScanNode<T>[] }
  | { kind: "group"; id: string; children: ScanNode<T>[] }
  | { kind: "leaf"; value: T };

export type NavigatorSelection<T> =
  | { kind: "none" }
  | { kind: "entered" }
  | { kind: "escaped" }
  | { kind: "leaf"; value: T };

export const leaf = <T>(value: T): ScanNode<T> => ({ kind: "leaf", value });

export const group = <T>(id: string, children: ScanNode<T>[]): ScanNode<T> => ({
  kind: "group",
  id,
  children,
});

export const branch = <T>(children: ScanNode<T>[]): ScanNode<T> => ({
  kind: "branch",
  children,
});

function normalized<T>(node: ScanNode<T>): ScanNode<T> | undefined {
  switch (node.kind) {
    case "leaf":
      return node;
    case "group": {
      const children = normalizeAll(node.children);
      return children.length === 0 ? undefined : { kind: "group", id: node.id, children };
    }
    case "branch": {
      const children = normalizeAll(node.children);
      if (children.length === 0) return undefined;
      if (children.length === 1) return children[0];
      return { kind: "branch", children };
    }
  }
}

function normalizeAll<T>(nodes: ScanNode<T>[]): ScanNode<T>[] {
  const output: ScanNode<T>[] = [];
  for (const node of nodes) {
    const result = normalized(node);
    if (result) output.push(result);
  }
  return output;
}

function nodesEqual<T>(a: ScanNode<T>, b: ScanNode<T>): boolean {
  if (a.kind === "leaf" || b.kind === "leaf") {
    return a.kind === "leaf" && b.kind === "leaf" && Object.is(a.value, b.value);
  }
  if (a.kind !== b.kind) return false;
  if (a.kind === "group" && b.kind === "group" && a.id !== b.id) return false;
  return listsEqual(a.children, b.children);
}

function listsEqual<T>(a: ScanNode<T>[], b: ScanNode<T>[]): boolean {
  return a.length === b.length && a.every((node, index) => nodesEqual(node, b[index]!));
}

function sameIdentity<T>(a: ScanNode<T>, b: ScanNode<T>): boolean {
  if (a.kind === "group" && b.kind === "group") return a.id === b.id;
  return nodesEqual(a, b);
}

function childrenOf<T>(node: ScanNode<T>): ScanNode<T>[] {
  if (node.kind === "leaf") throw new Error("A leaf has no children.");
  return node.children;
}

/** Pure hierarchical scan navigation, shared by grouped and linear scanning. */
export class Navigator<T> {
  private roots: ScanNode<T>[];
  private trail: number[] = [];
  private cursor = 0;
  private isEscaping = false;

  constructor(roots: ScanNode<T>[]) {
    this.roots = normalizeAll(roots);
  }

  rootNodes(): readonly ScanNode<T>[] {
    return this.roots;
  }

  siblings(): ScanNode<T>[] {
    let nodes = this.roots;
    for (const index of this.trail) nodes = childrenOf(nodes[index]!);
    return nodes;
  }

  /** The group or branch that contains the current siblings, if any. */
  parent(): ScanNode<T> | undefined {
    let nodes = this.roots;
    let parent: ScanNode<T> | undefined;
    for (const index of this.trail) {
      parent = nodes[index]!;
      nodes = childrenOf(parent);
    }
    return parent;
  }

  current(): ScanNode<T> | undefined {
    return this.isEscaping ? undefined : this.siblings()[this.cursor];
  }

  path(): readonly number[] {
    return this.trail;
  }

  index(): number {
    return this.cursor;
  }

  escaping(): boolean {
    return this.isEscaping;
  }

  startAtEnd(): void {
    this.cursor = Math.max(0, this.siblings().length - 1);
    this.isEscaping = false;
  }

  reset(): void {
    this.trail = [];
    this.cursor = 0;
    this.isEscaping = false;
  }

  /** Returns true only when a full traversal wraps, after any escape slot. */
  step(forward: boolean): boolean {
    const count = this.siblings().length;
    if (count === 0) return false;
    if (this.isEscaping) {
      this.isEscaping = false;
      this.cursor = forward ? 0 : count - 1;
      return true;
    }
    const atEdge = forward ? this.cursor === count - 1 : this.cursor === 0;
    if (atEdge) {
      if (this.trail.length === 0) {
        this.cursor = forward ? 0 : count - 1;
        return true;
      }
      this.isEscaping = true;
    } else if (forward) {
      this.cursor += 1;
    } else {
      this.cursor -= 1;
    }
    return false;
  }

  select(): NavigatorSelection<T> {
    if (this.isEscaping) {
      const parent = this.trail.pop();
      if (parent === undefined) throw new Error("An escape has a parent.");
      this.cursor = parent;
      this.isEscaping = false;
      return { kind: "escaped" };
    }
    const node = this.siblings()[this.cursor];
    if (!node) return { kind: "none" };
    if (node.kind === "leaf") return { kind: "leaf", value: node.value };
    this.trail.push(this.cursor);
    this.cursor = 0;
    return { kind: "entered" };
  }

  /**
   * Swaps in new content, keeping the position when the same groups and items
   * are still present. Returns undefined when nothing changed, otherwise
   * whether the position was preserved.
   */
  replace(next: ScanNode<T>[]): boolean | undefined {
    const roots = normalizeAll(next);
    if (listsEqual(roots, this.roots)) return undefined;
    let oldNodes = this.roots;
    let newNodes = roots;
    const trail: number[] = [];
    let preserved = true;
    for (const index of this.trail) {
      const previous = oldNodes[index]!;
      const position = newNodes.findIndex((node) => sameIdentity(previous, node));
      if (position < 0) {
        preserved = false;
        break;
      }
      trail.push(position);
      oldNodes = childrenOf(previous);
      newNodes = childrenOf(newNodes[position]!);
    }
    let index: number | undefined;
    if (preserved) {
      const selected = oldNodes[this.cursor];
      if (selected) {
        const position = newNodes.findIndex((node) => sameIdentity(selected, node));
        index = position < 0 ? undefined : position;
      }
    }
    preserved &&= index !== undefined || (this.isEscaping && trail.length > 0);
    this.cursor = index ?? 0;
    this.isEscaping &&= preserved && trail.length > 0;
    this.trail = trail;
    this.roots = roots;
    return preserved;
  }
}
