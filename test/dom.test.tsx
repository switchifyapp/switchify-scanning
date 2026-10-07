import { act, render, screen } from "@testing-library/react";
import { useState } from "react";
import {
  ScanGroupScope,
  ScanProvider,
  scanGroupAttributes,
  scanItemAttributes,
  useScanGroup,
  useScanItem,
  useScanner,
} from "../src/dom";

function Item({ id, onActivate }: { id: string; onActivate?: () => void }) {
  const item = useScanItem<HTMLButtonElement>(id, { onActivate });
  return (
    <button ref={item.ref} data-testid={id} {...scanItemAttributes(item)}>
      {id}
    </button>
  );
}

function Row({ id, children }: { id: string; children: React.ReactNode }) {
  const row = useScanGroup<HTMLDivElement>(id);
  return (
    <div ref={row.ref} data-testid={id} {...scanGroupAttributes(row)}>
      <ScanGroupScope id={id}>{children}</ScanGroupScope>
    </div>
  );
}

let scanner: ReturnType<typeof useScanner>;
function Capture() {
  scanner = useScanner();
  return null;
}

const flush = () => act(async () => {});
const highlighted = (id: string) =>
  screen.getByTestId(id).hasAttribute("data-scan-highlighted");

test("items are scanned in document order, not mount order", async () => {
  function App() {
    const [showFirst, setShowFirst] = useState(false);
    return (
      <ScanProvider options={{ automatic: false }}>
        <Capture />
        {showFirst && <Item id="first" />}
        <Item id="second" />
        <button onClick={() => setShowFirst(true)}>reveal</button>
      </ScanProvider>
    );
  }
  render(<App />);
  await flush();
  act(() => screen.getByText("reveal").click());
  await flush();
  act(() => scanner.dispatch("select"));
  expect(highlighted("first")).toBe(true);
  act(() => scanner.dispatch("next"));
  expect(highlighted("second")).toBe(true);
  expect(highlighted("first")).toBe(false);
});

test("rows highlight as groups, then their items, then the way out", async () => {
  const activate = vi.fn();
  render(
    <ScanProvider options={{ automatic: false }}>
      <Capture />
      <Row id="row1">
        <Item id="copy" />
        <Item id="paste" onActivate={activate} />
      </Row>
      <Item id="close" />
    </ScanProvider>,
  );
  await flush();
  act(() => scanner.dispatch("select"));
  expect(highlighted("row1")).toBe(true);
  expect(screen.getByTestId("copy").hasAttribute("data-scan-group-highlighted")).toBe(true);
  act(() => scanner.dispatch("select"));
  expect(screen.getByTestId("row1").hasAttribute("data-scan-entered")).toBe(true);
  expect(highlighted("copy")).toBe(true);
  act(() => scanner.dispatch("next"));
  act(() => scanner.dispatch("select"));
  expect(activate).toHaveBeenCalledOnce();
  act(() => scanner.dispatch("select"));
  act(() => scanner.dispatch("next"));
  act(() => scanner.dispatch("next"));
  expect(screen.getByTestId("row1").hasAttribute("data-scan-escape-highlighted")).toBe(true);
});

test("automatic scanning advances with real timers", async () => {
  vi.useFakeTimers();
  try {
    render(
      <ScanProvider options={{ intervalMs: 200 }}>
        <Capture />
        <Item id="a" />
        <Item id="b" />
      </ScanProvider>,
    );
    await flush();
    act(() => scanner.start());
    expect(highlighted("a")).toBe(true);
    await act(async () => {
      vi.advanceTimersByTime(240);
    });
    expect(highlighted("b")).toBe(true);
  } finally {
    vi.useRealTimers();
  }
});

test("the latest handler runs without re-registering", async () => {
  function App() {
    const [count, setCount] = useState(0);
    return (
      <ScanProvider options={{ automatic: false }}>
        <Capture />
        <Item id="inc" onActivate={() => setCount(count + 1)} />
        <output data-testid="count">{count}</output>
      </ScanProvider>
    );
  }
  render(<App />);
  await flush();
  act(() => scanner.dispatch("select"));
  act(() => scanner.dispatch("select"));
  act(() => scanner.dispatch("select"));
  expect(screen.getByTestId("count").textContent).toBe("2");
});
