import type { ScanAction } from "./actions";
import { Interval } from "./interval";
import { group, leaf, Navigator, type ScanNode } from "./navigator";
import { DEFAULT_OPTIONS, exhausted, type ScanOptions } from "./options";

export interface Policy {
  resetPassesOnStep: boolean;
  resumeAtRoot: boolean;
}

export const Policy = Object.freeze({
  /** Stays where it was left and keeps counting passes across manual steps. */
  MENU: Object.freeze<Policy>({ resetPassesOnStep: false, resumeAtRoot: false }),
  /** Starts again from the top and treats a manual step as a fresh start. */
  KEYBOARD: Object.freeze<Policy>({ resetPassesOnStep: true, resumeAtRoot: true }),
});

function flatten<T>(nodes: ScanNode<T>[], output: ScanNode<T>[] = []): ScanNode<T>[] {
  for (const node of nodes) {
    if (node.kind === "leaf") output.push(node);
    else flatten(node.children, output);
  }
  return output;
}

export function rowsToNodes<T>(rows: T[][]): ScanNode<T>[] {
  return rows.map((row, index) =>
    row.length === 1 ? leaf(row[0]!) : group(`row-${index}`, row.map((value) => leaf(value))),
  );
}

export class ItemScanner<T> {
  nav: Navigator<T>;
  options: ScanOptions = { ...DEFAULT_OPTIONS };
  suspended = false;
  private interval = new Interval();
  private cycles = 0;
  private forward = true;
  private isPending = false;
  private revision = 0;
  /** Suspended by the user's choice to wait after a selection. */
  private isWaiting = false;

  constructor(
    nodes: ScanNode<T>[],
    private readonly policy: Policy,
  ) {
    this.nav = new Navigator(nodes);
  }

  static rows<T>(rows: T[][], policy: Policy): ItemScanner<T> {
    return new ItemScanner(rowsToNodes(rows), policy);
  }

  static configured<T>(nodes: ScanNode<T>[], policy: Policy, options: ScanOptions): ItemScanner<T> {
    const scanner = new ItemScanner(options.pattern === "linear" ? flatten(nodes) : nodes, policy);
    scanner.options = options;
    scanner.restart();
    return scanner;
  }

  static configuredRows<T>(rows: T[][], policy: Policy, options: ScanOptions): ItemScanner<T> {
    return ItemScanner.configured(rowsToNodes(rows), policy, options);
  }

  rowScan(): boolean {
    return this.options.pattern === "grouped" && this.nav.path().length === 0;
  }

  /** The highlighted row and, once inside it, the highlighted column. */
  position(rows: T[][]): [number, number | undefined] {
    if (this.options.pattern === "linear") {
      let index = this.nav.index();
      for (let r = 0; r < rows.length; r++) {
        const length = rows[r]!.length;
        if (index < length) return [r, index];
        index -= length;
      }
      return [0, undefined];
    }
    const path = this.nav.path();
    return [
      path[0] ?? this.nav.index(),
      path.length === 0 || this.nav.escaping() ? undefined : this.nav.index(),
    ];
  }

  pending(): boolean {
    return this.isPending;
  }

  waiting(): boolean {
    return this.isWaiting;
  }

  beginActivation(): number | undefined {
    if (this.isPending || this.suspended) return undefined;
    this.revision += 1;
    this.isPending = true;
    return this.revision;
  }

  completeActivation(revision: number): boolean {
    if (!this.isPending || revision !== this.revision) return false;
    this.isPending = false;
    return true;
  }

  restartInterval(): void {
    this.interval.reset();
    this.cycles = 0;
    this.suspended = false;
    this.isWaiting = false;
  }

  /** Left alone, a menu stays where it is and a keyboard starts again. */
  staysAtSelection(): boolean {
    switch (this.options.startFrom) {
      case "standard":
        return !this.policy.resumeAtRoot;
      case "beginning":
        return false;
      case "selection":
        return true;
    }
  }

  waitsAfterSelection(): boolean {
    return this.options.nextScan === "wait" && this.options.automatic;
  }

  /** Carries on after a selection that did something, as the user chose. */
  continueAfterSelection(): void {
    if (!this.staysAtSelection()) {
      this.restart();
    } else if (this.options.startFrom === "standard") {
      this.restartInterval();
    } else {
      this.restartInPlace();
    }
    if (this.waitsAfterSelection()) this.wait();
  }

  /** Starts again from the highlighted item, in the chosen direction. */
  restartInPlace(): void {
    this.isPending = false;
    this.forward = this.options.direction === "forward";
    this.restartInterval();
  }

  wait(): void {
    this.isWaiting = true;
    this.suspended = true;
  }

  resetClock(): void {
    this.interval.reset();
  }

  restart(): void {
    this.isPending = false;
    this.nav.reset();
    this.forward = this.options.direction === "forward";
    if (!this.forward) this.nav.startAtEnd();
    this.restartInterval();
  }

  skip(): void {
    this.nav.step(this.forward);
  }

  skipAutomatic(): void {
    if (this.nav.step(this.forward)) {
      this.cycles += 1;
      this.suspended = exhausted(this.options, this.cycles);
    }
  }

  advance(ms: number, period: number): boolean {
    if (this.isPending || this.suspended || !this.interval.elapsed(ms, period)) return false;
    this.skipAutomatic();
    return true;
  }

  handle(action: ScanAction): T | undefined {
    if (this.isPending) return undefined;
    if (this.suspended) {
      if (action === "select") {
        if (this.isWaiting && this.staysAtSelection()) this.restartInterval();
        else if (this.policy.resumeAtRoot) this.restart();
        else this.restartInterval();
      }
      return undefined;
    }
    switch (action) {
      case "select": {
        this.restartInterval();
        const selection = this.nav.select();
        if (selection.kind === "leaf") return selection.value;
        if (selection.kind === "entered") {
          this.forward = this.options.direction === "forward";
          if (!this.forward) this.nav.startAtEnd();
        } else if (selection.kind === "escaped") {
          this.forward = this.options.direction === "forward";
        }
        break;
      }
      case "next":
      case "back":
        this.resetClock();
        if (this.policy.resetPassesOnStep) this.cycles = 0;
        this.forward = action === "next";
        this.skip();
        break;
      case "reverse":
        this.forward = !this.forward;
        this.restartInterval();
        break;
    }
    return undefined;
  }

  /** Swaps in new content. Returns false when nothing changed. */
  replace(nodes: ScanNode<T>[]): boolean {
    const preserved = this.nav.replace(this.options.pattern === "linear" ? flatten(nodes) : nodes);
    if (preserved === undefined) return false;
    this.revision += 1;
    this.isPending = false;
    if (!preserved) {
      this.interval.reset();
      this.cycles = 0;
    }
    return true;
  }
}
