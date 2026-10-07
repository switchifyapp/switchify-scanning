import { branch, leaf, Navigator } from "../src";

const tree = () =>
  new Navigator([leaf("outside"), branch([leaf("a"), branch([leaf("b"), leaf("c")])])]);

test("nested escape preserves parent and never selects a leaf", () => {
  const n = tree();
  n.step(true);
  expect(n.select()).toEqual({ kind: "entered" });
  n.step(true);
  expect(n.select()).toEqual({ kind: "entered" });
  expect(n.select()).toEqual({ kind: "leaf", value: "b" });
  expect(n.step(false)).toBe(false);
  expect(n.escaping()).toBe(true);
  expect(n.select()).toEqual({ kind: "escaped" });
  expect(n.path()).toEqual([1]);
  expect(n.index()).toBe(1);
  expect(n.step(true)).toBe(false);
  expect(n.select()).toEqual({ kind: "escaped" });
  expect(n.path()).toEqual([]);
  expect(n.index()).toBe(1);
  expect(n.step(true)).toBe(true);
  expect(n.escaping()).toBe(false);
  expect(n.select()).toEqual({ kind: "leaf", value: "outside" });
});

test("ignored escape wraps in either direction and reset clears it", () => {
  for (const forward of [true, false]) {
    const n = new Navigator([branch([leaf(10), leaf(20)])]);
    n.select();
    if (forward) n.step(true);
    expect(n.step(forward)).toBe(false);
    expect(n.escaping()).toBe(true);
    expect(n.step(forward)).toBe(true);
    expect(n.select()).toEqual({ kind: "leaf", value: forward ? 10 : 20 });
    n.step(forward);
    n.step(forward);
    n.reset();
    expect(n.path()).toEqual([]);
    expect(n.escaping()).toBe(false);
    expect(n.index()).toBe(0);
  }
});

test("empty branches are removed and single children collapse", () => {
  const n = new Navigator([branch<number>([]), branch([branch([leaf(42)])])]);
  expect(n.select()).toEqual({ kind: "leaf", value: 42 });
  expect(n.step(false)).toBe(true);
  const empty = new Navigator<number>([branch([])]);
  expect(empty.select()).toEqual({ kind: "none" });
  expect(empty.step(true)).toBe(false);
});
