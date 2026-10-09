import { act, render, screen } from "@testing-library/react";
import { ScanProvider, scanItemAttributes, useKeyboardSwitches, useScanItem, useScanner, type SwitchSettings } from "../src/dom";

const settings: SwitchSettings = {
  holdIntervalMs: 1000,
  bindings: [
    { id: "select", name: "Select", key: "Space", pressAction: "select", holdActions: ["reverse"] },
    { id: "next", name: "Next", key: "Enter", pressAction: "next", holdActions: [] },
  ],
};

function Item({ id, onActivate }: { id: string; onActivate?: () => void }) {
  const item = useScanItem<HTMLButtonElement>(id, { onActivate });
  return <button ref={item.ref} data-testid={id} onClick={() => onActivate?.()} {...scanItemAttributes(item)}>{id}</button>;
}

let switches: ReturnType<typeof useKeyboardSwitches>;
let scanner: ReturnType<typeof useScanner>;
function Switches({ enabled = true }: { enabled?: boolean }) {
  switches = useKeyboardSwitches({ settings, enabled });
  scanner = useScanner();
  return null;
}

const key = (type: "keydown" | "keyup", code: string, target: EventTarget = window, repeat = false) =>
  act(() => { target.dispatchEvent(new KeyboardEvent(type, { code, repeat, bubbles: true, cancelable: true })); });
const tap = (code: string) => { key("keydown", code); key("keyup", code); };
const highlighted = (id: string) => screen.getByTestId(id).hasAttribute("data-scan-highlighted");

async function setup(enabled = true, onB = vi.fn()) {
  render(
    <ScanProvider options={{ automatic: false }}>
      <Switches enabled={enabled} />
      <Item id="a" />
      <Item id="b" onActivate={onB} />
      <input data-testid="field" />
    </ScanProvider>,
  );
  await act(async () => {});
  return onB;
}

test("a press of each switch performs its action", async () => {
  const onB = await setup();
  tap("Space");
  expect(highlighted("a")).toBe(true);
  tap("Enter");
  expect(highlighted("b")).toBe(true);
  tap("Space");
  expect(onB).toHaveBeenCalledOnce();
});

test("holding a switch offers its hold action and pauses movement", async () => {
  vi.useFakeTimers();
  try {
    await setup();
    tap("Space");
    key("keydown", "Space");
    expect(switches.held).toBe(true);
    await act(async () => { vi.advanceTimersByTime(1100); });
    expect(switches.prompt).toEqual({ switchName: "Select", action: "reverse" });
    key("keyup", "Space");
    expect(switches.held).toBe(false);
    expect(switches.prompt).toBeUndefined();
    expect(scanner.snapshot.highlight).toEqual({ kind: "item", id: "a" });
  } finally {
    vi.useRealTimers();
  }
});

test("bound keys are kept from the page, but text fields still get them", async () => {
  await setup();
  const event = new KeyboardEvent("keydown", { code: "Space", bubbles: true, cancelable: true });
  act(() => { window.dispatchEvent(event); });
  expect(event.defaultPrevented).toBe(true);
  key("keyup", "Space");
  const field = screen.getByTestId("field");
  const typed = new KeyboardEvent("keydown", { code: "Space", bubbles: true, cancelable: true });
  act(() => { field.dispatchEvent(typed); });
  expect(typed.defaultPrevented).toBe(false);
});

test("key repeat does not restart a press, and Escape stops scanning", async () => {
  await setup();
  key("keydown", "Space");
  key("keydown", "Space", window, true);
  key("keyup", "Space");
  expect(scanner.snapshot.active).toBe(true);
  key("keydown", "Escape");
  expect(scanner.snapshot.active).toBe(false);
});

test("nothing is captured while disabled", async () => {
  await setup(false);
  const event = new KeyboardEvent("keydown", { code: "Space", bubbles: true, cancelable: true });
  act(() => { window.dispatchEvent(event); });
  expect(event.defaultPrevented).toBe(false);
  expect(scanner.snapshot.active).toBe(false);
});
