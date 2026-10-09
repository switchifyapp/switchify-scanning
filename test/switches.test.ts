import {
  DEFAULT_SWITCH_SETTINGS,
  SwitchGestures,
  validateSwitchSettings,
  type SwitchSettings,
} from "../src";

const settings = (): SwitchSettings => ({
  holdIntervalMs: 1000,
  bindings: [
    { id: "one", name: "Head switch", key: "Space", pressAction: "select", holdActions: ["next", "stop"] },
    { id: "two", name: "Other", key: "Enter", pressAction: "back", holdActions: [] },
  ],
});

test("boundary and last hold action match Switchify PC", () => {
  for (const [duration, expected] of [
    [999, "select"],
    [1000, "next"],
    [1999, "next"],
    [2000, "stop"],
    [9000, "stop"],
  ] as const) {
    const gestures = new SwitchGestures();
    gestures.pressed("one", 0, settings());
    expect(gestures.released("one", duration)).toBe(expected);
    expect(gestures.released("one", duration)).toBeUndefined();
  }
});

test("cancellation discards the hold and the release", () => {
  const gestures = new SwitchGestures();
  gestures.pressed("one", 0, settings());
  expect(gestures.prompt(1000)).toEqual({ switchName: "Head switch", action: "next" });
  gestures.cancel();
  expect(gestures.released("one", 2000)).toBeUndefined();
  expect(gestures.prompt(2000)).toBeUndefined();
});

test("the first switch owns the gesture and repeats do not restart it", () => {
  const gestures = new SwitchGestures();
  gestures.pressed("one", 0, settings());
  gestures.pressed("one", 700, settings());
  gestures.pressed("two", 800, settings());
  expect(gestures.released("one", 1000)).toBe("next");
  expect(gestures.isHeld()).toBe(true);
  expect(gestures.released("two", 1200)).toBeUndefined();
  expect(gestures.isHeld()).toBe(false);
});

test("an unknown switch is held but never acts", () => {
  const gestures = new SwitchGestures();
  gestures.pressed("missing", 0, settings());
  expect(gestures.isHeld()).toBe(true);
  expect(gestures.released("missing", 10)).toBeUndefined();
});

test("settings need Select, and manual scanning also needs Next and Previous", () => {
  expect(validateSwitchSettings(DEFAULT_SWITCH_SETTINGS, true)).toBeNull();
  expect(validateSwitchSettings(DEFAULT_SWITCH_SETTINGS, false)).toMatch(/Manual scanning/);
  const holdsCoverManual = settings();
  holdsCoverManual.bindings[0]!.holdActions = ["next", "back"];
  expect(validateSwitchSettings(holdsCoverManual, false)).toBeNull();
  expect(validateSwitchSettings({ ...settings(), bindings: [] }, true)).toMatch(/Select/);
});

test("duplicate keys, Escape and bad intervals are rejected", () => {
  const duplicate = settings();
  duplicate.bindings[1]!.key = "Space";
  expect(validateSwitchSettings(duplicate, true)).toMatch(/different key/);
  const reserved = settings();
  reserved.bindings[1]!.key = "Escape";
  expect(validateSwitchSettings(reserved, true)).toMatch(/Escape/);
  expect(validateSwitchSettings({ ...settings(), holdIntervalMs: 100 }, true)).toMatch(/hold interval/);
  const unnamed = settings();
  unnamed.bindings[0]!.name = " ";
  expect(validateSwitchSettings(unnamed, true)).toMatch(/name/);
});
