import { ScanController, type ScanControllerOptions, type Scheduler } from "../src";

function manualScheduler() {
  let now = 0;
  let callback: (() => void) | undefined;
  const scheduler: Scheduler = {
    setInterval: (cb) => {
      callback = cb;
      return 1;
    },
    clearInterval: () => {
      callback = undefined;
    },
    now: () => now,
  };
  return {
    scheduler,
    running: () => callback !== undefined,
    advance(ms: number) {
      for (let step = 0; step < ms; step += 33) {
        now += Math.min(33, ms - step);
        callback?.();
      }
    },
  };
}

function setup(config: ScanControllerOptions = {}) {
  const clock = manualScheduler();
  const controller = new ScanController({ scheduler: clock.scheduler, ...config });
  return { controller, clock };
}

const highlight = (controller: ScanController) => controller.getSnapshot().highlight;

test("select starts scanning and steps through items in registration order", () => {
  const { controller } = setup({ options: { automatic: false } });
  for (const id of ["a", "b", "c"]) controller.registerItem(id);
  controller.flush();
  expect(controller.getSnapshot().active).toBe(false);
  controller.dispatch("select");
  expect(highlight(controller)).toEqual({ kind: "item", id: "a" });
  controller.dispatch("next");
  controller.dispatch("next");
  expect(highlight(controller)).toEqual({ kind: "item", id: "c" });
  controller.dispatch("next");
  expect(highlight(controller)).toEqual({ kind: "item", id: "a" });
  controller.dispatch("back");
  expect(highlight(controller)).toEqual({ kind: "item", id: "c" });
});

test("explicit order wins over registration order", () => {
  const { controller } = setup({ options: { automatic: false } });
  controller.registerItem("late", { order: 2 });
  controller.registerItem("early", { order: 1 });
  controller.flush();
  controller.start();
  expect(highlight(controller)).toEqual({ kind: "item", id: "early" });
});

test("automatic scanning moves on the clock and stops when paused or exhausted", () => {
  const { controller, clock } = setup({ options: { intervalMs: 500, passLimit: 1 } });
  controller.registerItem("a");
  controller.registerItem("b");
  controller.flush();
  expect(clock.running()).toBe(false);
  controller.start();
  expect(clock.running()).toBe(true);
  clock.advance(500);
  expect(highlight(controller)).toEqual({ kind: "item", id: "b" });
  controller.dispatch("pause");
  expect(clock.running()).toBe(false);
  controller.dispatch("pause");
  clock.advance(500);
  expect(controller.getSnapshot().suspended).toBe(true);
  expect(clock.running()).toBe(false);
  controller.dispatch("select");
  expect(controller.getSnapshot().suspended).toBe(false);
  expect(highlight(controller)).toEqual({ kind: "item", id: "a" });
});

test("groups are entered and left through the escape slot", () => {
  const { controller } = setup({ options: { automatic: false } });
  controller.registerGroup("row1");
  controller.registerItem("copy", { parentId: "row1" });
  controller.registerItem("paste", { parentId: "row1" });
  controller.registerItem("close");
  controller.flush();
  controller.start();
  expect(highlight(controller)).toEqual({ kind: "group", id: "row1" });
  controller.dispatch("select");
  expect(controller.getSnapshot().path).toEqual(["row1"]);
  expect(highlight(controller)).toEqual({ kind: "item", id: "copy" });
  controller.dispatch("next");
  controller.dispatch("next");
  expect(highlight(controller)).toEqual({ kind: "escape", groupId: "row1" });
  controller.dispatch("select");
  expect(controller.getSnapshot().path).toEqual([]);
  expect(highlight(controller)).toEqual({ kind: "group", id: "row1" });
});

test("linear pattern flattens groups", () => {
  const { controller } = setup({ options: { automatic: false, pattern: "linear" } });
  controller.registerGroup("row1");
  controller.registerItem("copy", { parentId: "row1" });
  controller.registerItem("paste", { parentId: "row1" });
  controller.flush();
  controller.start();
  expect(highlight(controller)).toEqual({ kind: "item", id: "copy" });
  controller.setOptions({ pattern: "grouped" });
  controller.start();
  expect(highlight(controller)).toEqual({ kind: "group", id: "row1" });
});

test("activation runs the handler and continues from the start by default", () => {
  const onSelect = vi.fn();
  const { controller } = setup({ options: { automatic: false }, onSelect });
  const b = vi.fn();
  controller.registerItem("a");
  controller.registerItem("b", { onActivate: b });
  controller.flush();
  controller.start();
  controller.dispatch("next");
  controller.dispatch("select");
  expect(b).toHaveBeenCalledOnce();
  expect(onSelect).toHaveBeenCalledWith("b");
  expect(controller.getSnapshot().active).toBe(true);
  expect(highlight(controller)).toEqual({ kind: "item", id: "a" });
});

test("stop after selection ends the session", () => {
  const { controller } = setup({ afterSelection: "stop" });
  controller.registerItem("a");
  controller.flush();
  controller.start();
  controller.dispatch("select");
  expect(controller.getSnapshot().active).toBe(false);
});

test("async activation blocks scanning until it settles, even on failure", async () => {
  const onError = vi.fn();
  const { controller, clock } = setup({ onError });
  let finish!: (value?: unknown) => void;
  let fail!: (error: unknown) => void;
  controller.registerItem("a", {
    onActivate: () => new Promise((resolve) => (finish = resolve)),
  });
  controller.registerItem("b", {
    onActivate: () => new Promise((_, reject) => (fail = reject)),
  });
  controller.flush();
  controller.start();
  controller.dispatch("select");
  expect(controller.getSnapshot().pending).toBe(true);
  expect(clock.running()).toBe(false);
  controller.dispatch("next");
  expect(highlight(controller)).toEqual({ kind: "item", id: "a" });
  finish();
  await Promise.resolve();
  expect(controller.getSnapshot().pending).toBe(false);
  controller.dispatch("next");
  controller.dispatch("select");
  fail(new Error("nope"));
  await Promise.resolve();
  await Promise.resolve();
  expect(onError).toHaveBeenCalledWith(expect.any(Error), "b");
  expect(controller.getSnapshot().pending).toBe(false);
});

test("a throwing handler is reported and scanning carries on", () => {
  const onError = vi.fn();
  const { controller } = setup({ onError });
  controller.registerItem("a", {
    onActivate: () => {
      throw new Error("boom");
    },
  });
  controller.flush();
  controller.start();
  controller.dispatch("select");
  expect(onError).toHaveBeenCalledOnce();
  expect(controller.getSnapshot().active).toBe(true);
});

test("removing the highlighted item keeps scanning on what remains", async () => {
  const { controller } = setup({ options: { automatic: false } });
  controller.registerItem("a");
  const removeB = controller.registerItem("b");
  controller.registerItem("c");
  controller.flush();
  controller.start();
  controller.dispatch("next");
  expect(highlight(controller)).toEqual({ kind: "item", id: "b" });
  removeB();
  await Promise.resolve();
  expect(highlight(controller)).toEqual({ kind: "item", id: "a" });
});

test("disabled items are skipped", () => {
  const { controller } = setup({ options: { automatic: false } });
  controller.registerItem("a", { disabled: true });
  controller.registerItem("b");
  controller.flush();
  controller.start();
  expect(highlight(controller)).toEqual({ kind: "item", id: "b" });
});

test("subscribers hear only real changes and stop clears state", () => {
  const { controller, clock } = setup({ options: { intervalMs: 500 } });
  controller.registerItem("a");
  controller.registerItem("b");
  controller.flush();
  const listener = vi.fn();
  controller.subscribe(listener);
  controller.start();
  expect(listener).toHaveBeenCalledTimes(1);
  clock.advance(400);
  expect(listener).toHaveBeenCalledTimes(1);
  clock.advance(100);
  expect(listener).toHaveBeenCalledTimes(2);
  controller.dispatch("stop");
  expect(controller.getSnapshot()).toMatchObject({ active: false, highlight: null });
  expect(clock.running()).toBe(false);
});

test("long gaps between ticks are bounded", () => {
  const { controller } = setup({ options: { intervalMs: 100 } });
  for (const id of ["a", "b", "c", "d", "e"]) controller.registerItem(id);
  controller.flush();
  controller.start();
  controller.tick(10000);
  expect(highlight(controller)).toEqual({ kind: "item", id: "b" });
});

test("comparators see anchors set before registration", () => {
  const { controller } = setup({
    options: { automatic: false },
    compare: (a, b) => (a.anchor as number) - (b.anchor as number),
  });
  controller.setAnchor("a", 2);
  controller.setAnchor("b", 1);
  controller.registerItem("a");
  controller.registerItem("b");
  controller.flush();
  controller.start();
  expect(highlight(controller)).toEqual({ kind: "item", id: "b" });
});

test("a held switch pauses automatic movement until release", () => {
  const { controller, clock } = setup({ options: { intervalMs: 500 } });
  controller.registerItem("a");
  controller.registerItem("b");
  controller.flush();
  controller.start();
  controller.setSwitchHeld(true);
  expect(clock.running()).toBe(false);
  controller.tick(1000);
  expect(highlight(controller)).toEqual({ kind: "item", id: "a" });
  controller.setSwitchHeld(false);
  expect(clock.running()).toBe(true);
  clock.advance(500);
  expect(highlight(controller)).toEqual({ kind: "item", id: "b" });
});

test("an exclusive group confines scanning until it is removed", async () => {
  const { controller } = setup({ options: { automatic: false } });
  controller.registerItem("page-a");
  controller.registerItem("page-b");
  controller.flush();
  controller.start();
  controller.dispatch("next");
  const closeDialog = controller.registerGroup("dialog", { exclusive: true });
  const dialogItems = [controller.registerItem("ok", { parentId: "dialog" }), controller.registerItem("cancel", { parentId: "dialog" })];
  controller.flush();
  expect(highlight(controller)).toEqual({ kind: "item", id: "ok" });
  controller.dispatch("next");
  controller.dispatch("next");
  expect(highlight(controller)).toEqual({ kind: "item", id: "ok" });
  const closeNested = controller.registerGroup("nested", { exclusive: true });
  const removeInner = controller.registerItem("inner", { parentId: "nested" });
  controller.flush();
  expect(highlight(controller)).toEqual({ kind: "item", id: "inner" });
  removeInner();
  closeNested();
  await Promise.resolve();
  expect(highlight(controller)).toEqual({ kind: "item", id: "ok" });
  dialogItems.forEach((remove) => remove());
  closeDialog();
  await Promise.resolve();
  expect(highlight(controller)).toEqual({ kind: "item", id: "page-a" });
});

test("options left undefined keep their current values", () => {
  const { controller, clock } = setup({ options: { automatic: false, intervalMs: 700 } });
  controller.setOptions({ automatic: undefined, intervalMs: undefined, pattern: "linear" });
  expect(controller.options).toMatchObject({ automatic: false, intervalMs: 700, pattern: "linear" });
  controller.registerItem("a");
  controller.flush();
  controller.start();
  expect(clock.running()).toBe(false);
});
