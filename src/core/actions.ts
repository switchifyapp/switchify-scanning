export type ScanAction = "select" | "next" | "back" | "pause" | "reverse" | "stop";

export const SCAN_ACTIONS: readonly ScanAction[] = [
  "select",
  "next",
  "back",
  "pause",
  "reverse",
  "stop",
];

export const ACTION_LABELS: Readonly<Record<ScanAction, string>> = Object.freeze({
  select: "Select",
  next: "Next",
  back: "Previous",
  pause: "Pause / resume",
  reverse: "Reverse direction",
  stop: "Stop scanning",
});
