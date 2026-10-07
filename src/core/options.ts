export type Direction = "forward" | "reverse";

/** Grouped scans rows (or groups) first and then the items inside; linear visits every item in turn. */
export type Pattern = "grouped" | "linear";

/** Whether scanning moves on by itself after a selection that performed an action. */
export type NextScan = "standard" | "automatic" | "wait";

/** Where scanning starts after a selection that performed an action. */
export type StartFrom = "standard" | "beginning" | "selection";

export interface ScanOptions {
  automatic: boolean;
  intervalMs: number;
  direction: Direction;
  /** Automatic passes without a selection before scanning waits for Select; 0 is unlimited. */
  passLimit: number;
  pattern: Pattern;
  nextScan: NextScan;
  startFrom: StartFrom;
}

export const MIN_INTERVAL_MS = 100;
export const MAX_INTERVAL_MS = 10000;
export const PASS_LIMITS: readonly number[] = [0, 1, 2, 3, 5];

export const DEFAULT_OPTIONS: Readonly<ScanOptions> = Object.freeze({
  automatic: true,
  intervalMs: 1000,
  direction: "forward",
  passLimit: 3,
  pattern: "grouped",
  nextScan: "standard",
  startFrom: "standard",
});

const DIRECTIONS: readonly Direction[] = ["forward", "reverse"];
const PATTERNS: readonly Pattern[] = ["grouped", "linear"];
const NEXT_SCANS: readonly NextScan[] = ["standard", "automatic", "wait"];
const START_FROMS: readonly StartFrom[] = ["standard", "beginning", "selection"];

function choice<T>(value: unknown, allowed: readonly T[], fallback: T): T {
  return allowed.includes(value as T) ? (value as T) : fallback;
}

/** Fills in defaults and lets any unknown or out-of-range choice fall back alone. */
export function resolveOptions(input: Partial<ScanOptions> = {}): ScanOptions {
  const interval = input.intervalMs;
  return {
    automatic: typeof input.automatic === "boolean" ? input.automatic : DEFAULT_OPTIONS.automatic,
    intervalMs:
      typeof interval === "number" &&
      Number.isFinite(interval) &&
      interval >= MIN_INTERVAL_MS &&
      interval <= MAX_INTERVAL_MS
        ? interval
        : DEFAULT_OPTIONS.intervalMs,
    direction: choice(input.direction, DIRECTIONS, DEFAULT_OPTIONS.direction),
    passLimit: choice(input.passLimit, PASS_LIMITS, DEFAULT_OPTIONS.passLimit),
    pattern: choice(input.pattern, PATTERNS, DEFAULT_OPTIONS.pattern),
    nextScan: choice(input.nextScan, NEXT_SCANS, DEFAULT_OPTIONS.nextScan),
    startFrom: choice(input.startFrom, START_FROMS, DEFAULT_OPTIONS.startFrom),
  };
}

export function exhausted(options: ScanOptions, passes: number): boolean {
  return options.passLimit !== 0 && passes >= options.passLimit;
}
