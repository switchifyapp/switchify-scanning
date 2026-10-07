import { act, render } from "@testing-library/react";
import { forwardRef, useImperativeHandle } from "react";
import { ScanProvider, screenOrder, useScanItem, useScanner, type Measurable } from "../src/native";
import type { ScanEntry } from "../src";

const entry = (id: string, anchor: unknown, sequence: number, order?: number): ScanEntry => ({
  kind: "item",
  id,
  parentId: undefined,
  order,
  sequence,
  anchor,
});

test("screen order reads rows top to bottom, then left to right", () => {
  const entries = [
    entry("right", { x: 100, y: 2, width: 10, height: 10 }, 0),
    entry("below", { x: 0, y: 50, width: 10, height: 10 }, 1),
    entry("left", { x: 0, y: 0, width: 10, height: 10 }, 2),
    entry("unmeasured", undefined, 3),
  ];
  expect(entries.sort(screenOrder).map((e) => e.id)).toEqual(["left", "right", "below", "unmeasured"]);
  expect(
    [entry("a", { x: 0, y: 0 }, 0, 2), entry("b", { x: 50, y: 50 }, 1, 1)].sort(screenOrder).map((e) => e.id),
  ).toEqual(["b", "a"]);
});

const View = forwardRef<Measurable, { x: number; y: number }>(({ x, y }, ref) => {
  useImperativeHandle(ref, () => ({ measureInWindow: (callback) => callback(x, y, 10, 10) }), [x, y]);
  return null;
});

let scanner: ReturnType<typeof useScanner>;
function Capture() {
  scanner = useScanner();
  return null;
}

function Item({ id, x, y }: { id: string; x: number; y: number }) {
  const item = useScanItem(id);
  return <View ref={item.ref} x={x} y={y} />;
}

test("measured views are scanned in on-screen order", async () => {
  render(
    <ScanProvider options={{ automatic: false }}>
      <Capture />
      <Item id="bottom" x={0} y={100} />
      <Item id="top" x={0} y={0} />
    </ScanProvider>,
  );
  await act(async () => {});
  act(() => scanner.start());
  expect(scanner.snapshot.highlight).toEqual({ kind: "item", id: "top" });
});
