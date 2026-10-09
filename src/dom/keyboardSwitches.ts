import { useEffect, useRef, useState } from "react";
import type { ScanAction } from "../core/actions";
import { RESERVED_KEY, SwitchGestures, type HoldPrompt, type SwitchSettings } from "../core/switches";
import { useScanController } from "../react";

export interface KeyboardSwitchOptions {
  settings: SwitchSettings;
  /** Defaults to true. While false, keys pass through untouched. */
  enabled?: boolean;
  /**
   * Leave keys alone while focus is in a text field, so typing a space or pressing
   * Enter still works there. Defaults to true. Escape still stops scanning.
   */
  ignoreWhileTyping?: boolean;
  onAction?: (action: ScanAction, switchId: string) => void;
}

export interface KeyboardSwitchState {
  /** A switch is held down. */
  held: boolean;
  /** The hold action releasing now would perform. */
  prompt: HoldPrompt | undefined;
}

const PROMPT_TICK_MS = 100;

export function isTextEntry(target: EventTarget | null): boolean {
  if (typeof Element === "undefined" || !(target instanceof Element)) return false;
  if (target instanceof HTMLTextAreaElement) return !target.readOnly && !target.disabled;
  if (target instanceof HTMLInputElement) {
    const textual = ["", "text", "search", "email", "url", "tel", "password", "number"];
    return textual.includes(target.type) && !target.readOnly && !target.disabled;
  }
  return target.closest('[contenteditable=""], [contenteditable="true"]') !== null;
}

/**
 * Turns keyboard-style switch interfaces into scan actions. A press gives the
 * binding's press action, a longer hold gives its hold actions in turn, and
 * Escape stops scanning. Bound keys never reach the page while scanning has
 * them, so Space and Enter do not also click whatever has focus.
 */
export function useKeyboardSwitches({
  settings,
  enabled = true,
  ignoreWhileTyping = true,
  onAction,
}: KeyboardSwitchOptions): KeyboardSwitchState {
  const controller = useScanController();
  const [state, setState] = useState<KeyboardSwitchState>({ held: false, prompt: undefined });
  const latest = useRef({ settings, ignoreWhileTyping, onAction });
  latest.current = { settings, ignoreWhileTyping, onAction };

  useEffect(() => {
    if (!enabled || typeof window === "undefined") return;
    const gestures = new SwitchGestures();
    const captured = new Set<string>();
    let timer: ReturnType<typeof setInterval> | undefined;
    const now = () => (globalThis.performance ?? Date).now();
    const show = () => {
      const held = gestures.isHeld();
      const prompt = gestures.prompt(now());
      setState((previous) =>
        previous.held === held &&
        previous.prompt?.action === prompt?.action &&
        previous.prompt?.switchName === prompt?.switchName
          ? previous
          : { held, prompt },
      );
    };
    const stopTimer = () => {
      if (timer !== undefined) clearInterval(timer);
      timer = undefined;
    };
    const reset = () => {
      gestures.cancel();
      captured.clear();
      stopTimer();
      controller.setSwitchHeld(false);
      show();
    };
    const binding = (code: string) => latest.current.settings.bindings.find((candidate) => candidate.key === code);

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.code === RESERVED_KEY) {
        if (!controller.getSnapshot().active) return;
        event.preventDefault();
        reset();
        controller.dispatch("stop");
        return;
      }
      const match = binding(event.code);
      if (!match) return;
      if (!captured.has(event.code) && latest.current.ignoreWhileTyping && isTextEntry(event.target)) return;
      event.preventDefault();
      event.stopPropagation();
      captured.add(event.code);
      if (event.repeat) return;
      gestures.pressed(match.id, now(), latest.current.settings);
      controller.setSwitchHeld(true);
      timer ??= setInterval(show, PROMPT_TICK_MS);
      show();
    };

    const onKeyUp = (event: KeyboardEvent) => {
      if (!captured.delete(event.code)) return;
      event.preventDefault();
      event.stopPropagation();
      const match = binding(event.code);
      const action = match ? gestures.released(match.id, now()) : undefined;
      if (!gestures.isHeld()) {
        stopTimer();
        controller.setSwitchHeld(false);
      }
      show();
      if (match && action) {
        controller.dispatch(action);
        latest.current.onAction?.(action, match.id);
      }
    };

    const onHidden = () => {
      if (document.visibilityState === "hidden") reset();
    };

    window.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("keyup", onKeyUp, true);
    window.addEventListener("blur", reset);
    document.addEventListener("visibilitychange", onHidden);
    return () => {
      window.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("keyup", onKeyUp, true);
      window.removeEventListener("blur", reset);
      document.removeEventListener("visibilitychange", onHidden);
      reset();
    };
  }, [controller, enabled]);

  return state;
}
