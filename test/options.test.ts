import { DEFAULT_OPTIONS, exhausted, Interval, resolveOptions } from "../src";

test("an unknown choice falls back alone", () => {
  const resolved = resolveOptions({
    direction: "reverse",
    passLimit: 5,
    nextScan: "later" as never,
    startFrom: 7 as never,
    pattern: "linear",
  });
  expect(resolved).toEqual({
    ...DEFAULT_OPTIONS,
    direction: "reverse",
    passLimit: 5,
    pattern: "linear",
  });
});

test("invalid numeric values use validated defaults", () => {
  expect(resolveOptions({ intervalMs: 0, passLimit: 9 })).toMatchObject({
    intervalMs: 1000,
    passLimit: 3,
  });
  expect(resolveOptions({ intervalMs: Number.NaN }).intervalMs).toBe(1000);
  expect(resolveOptions({ intervalMs: 250 }).intervalMs).toBe(250);
});

test("unlimited passes are never exhausted", () => {
  expect(exhausted(resolveOptions({ passLimit: 0 }), 10000)).toBe(false);
  expect(exhausted(resolveOptions({ passLimit: 2 }), 2)).toBe(true);
});

test("interval reset discards previous progress", () => {
  const timer = new Interval();
  expect(timer.elapsed(70, 100)).toBe(false);
  timer.reset();
  expect(timer.elapsed(40, 100)).toBe(false);
  expect(timer.elapsed(60, 100)).toBe(true);
});
