import type { ScanAction } from "./actions";

/** A switch the user presses, identified by the key code its interface sends. */
export interface SwitchBinding {
  id: string;
  name: string;
  /** A `KeyboardEvent.code` such as `Space`, `Enter`, `F8` or `ArrowUp`. */
  key: string;
  pressAction: ScanAction;
  /** Actions offered in turn while the switch is held, one per hold interval. */
  holdActions: ScanAction[];
}

export interface SwitchSettings {
  holdIntervalMs: number;
  bindings: SwitchBinding[];
}

export const MIN_HOLD_INTERVAL_MS = 250;
export const MAX_HOLD_INTERVAL_MS = 5000;
export const RESERVED_KEY = "Escape";

export const DEFAULT_SWITCH_SETTINGS: Readonly<SwitchSettings> = Object.freeze<SwitchSettings>({
  holdIntervalMs: 1000,
  bindings: [
    { id: "select", name: "Select", key: "Space", pressAction: "select", holdActions: [] },
    { id: "next", name: "Next", key: "Enter", pressAction: "next", holdActions: [] },
  ],
});

/** Returns why the settings cannot be used, or null. Messages match Switchify PC. */
export function validateSwitchSettings(settings: SwitchSettings, automatic: boolean): string | null {
  const { holdIntervalMs, bindings } = settings;
  if (
    !Number.isFinite(holdIntervalMs) ||
    holdIntervalMs < MIN_HOLD_INTERVAL_MS ||
    holdIntervalMs > MAX_HOLD_INTERVAL_MS ||
    bindings.length > 128
  ) {
    return "Unsupported switch settings or hold interval.";
  }
  const ids = new Set<string>();
  const keys = new Set<string>();
  for (const binding of bindings) {
    if (
      !binding.id ||
      binding.id.length > 128 ||
      ids.has(binding.id) ||
      !binding.name.trim() ||
      [...binding.name].length > 64 ||
      binding.holdActions.length > 32
    ) {
      return "Each switch needs a name, a unique ID, and at most 32 hold actions.";
    }
    ids.add(binding.id);
    if (!binding.key || binding.key === RESERVED_KEY || keys.has(binding.key)) {
      return "Each switch needs a different key. Escape is reserved for stopping scanning.";
    }
    keys.add(binding.key);
  }
  const has = (action: ScanAction) =>
    bindings.some((binding) => binding.pressAction === action || binding.holdActions.includes(action));
  if (!has("select")) {
    return "Scanning starts once a switch has the Select action.";
  }
  if (!automatic && (!has("next") || !has("back"))) {
    return "Manual scanning starts once switches cover Select, Next and Previous.";
  }
  return null;
}

export interface HoldPrompt {
  switchName: string;
  action: ScanAction;
}

/**
 * Release and hold selection, ported from Switchify PC. The first switch pressed
 * owns the gesture; releasing it gives its press action, or the hold action reached
 * by how long it was held. Others pressed meanwhile are ignored, and a cancelled
 * gesture never becomes an action.
 */
export class SwitchGestures {
  private readonly held = new Set<string>();
  private press: { binding: SwitchBinding; started: number } | undefined;
  private intervalMs = DEFAULT_SWITCH_SETTINGS.holdIntervalMs;

  pressed(id: string, now: number, settings: SwitchSettings): void {
    if (this.held.has(id)) return;
    this.held.add(id);
    if (this.held.size !== 1) return;
    const binding = settings.bindings.find((candidate) => candidate.id === id);
    if (!binding) return;
    this.intervalMs = settings.holdIntervalMs;
    this.press = { binding, started: now };
  }

  private candidate(now: number): ScanAction | undefined {
    const press = this.press;
    if (!press) return undefined;
    const elapsed = Math.max(0, now - press.started);
    const actions = press.binding.holdActions;
    if (elapsed < this.intervalMs || actions.length === 0) return undefined;
    const index = Math.min(Math.floor(elapsed / this.intervalMs) - 1, actions.length - 1);
    return actions[index];
  }

  /** The hold action that releasing now would perform, for showing to the user. */
  prompt(now: number): HoldPrompt | undefined {
    const action = this.candidate(now);
    return this.press && action ? { switchName: this.press.binding.name, action } : undefined;
  }

  released(id: string, now: number): ScanAction | undefined {
    if (!this.held.delete(id)) return undefined;
    if (this.press?.binding.id !== id) return undefined;
    const action = this.candidate(now) ?? this.press.binding.pressAction;
    this.press = undefined;
    return action;
  }

  isHeld(): boolean {
    return this.held.size > 0;
  }

  cancel(): void {
    this.held.clear();
    this.press = undefined;
  }
}
