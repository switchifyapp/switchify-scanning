import {
  DEFAULT_OPTIONS,
  group as namedGroup,
  ItemScanner,
  leaf,
  Policy,
  type NextScan,
  type ScanOptions,
  type StartFrom,
} from "../src";

const opts = (overrides: Partial<ScanOptions>): ScanOptions => ({ ...DEFAULT_OPTIONS, ...overrides });
const scanner = (policy: Policy) =>
  ItemScanner.rows([["copy", "paste"], ["close"]], policy);
const group = (id: string, keys: string[]) => namedGroup(id, keys.map((key) => leaf(key)));

test("nested back restores parent and gives it a full interval", () => {
  const scan = scanner(Policy.MENU);
  expect(scan.handle("select")).toBeUndefined();
  scan.advance(499, 500);
  scan.handle("back");
  expect(scan.nav.escaping()).toBe(true);
  expect(scan.handle("select")).toBeUndefined();
  expect(scan.nav.path()).toEqual([]);
  expect(scan.nav.index()).toBe(0);
  expect(scan.advance(499, 500)).toBe(false);
  expect(scan.advance(1, 500)).toBe(true);
  expect(scan.handle("select")).toBe("close");
});

test("suspension consumes resume without selecting", () => {
  for (const policy of [Policy.MENU, Policy.KEYBOARD]) {
    const scan = scanner(policy);
    for (let i = 0; i < 6; i++) scan.advance(500, 500);
    expect(scan.suspended).toBe(true);
    expect(scan.handle("next")).toBeUndefined();
    expect(scan.suspended).toBe(true);
    expect(scan.handle("select")).toBeUndefined();
    expect(scan.suspended).toBe(false);
    expect(scan.advance(499, 500)).toBe(false);
  }
});

test("reverse and manual steps restart the clock", () => {
  const scan = scanner(Policy.MENU);
  scan.advance(499, 500);
  scan.handle("reverse");
  expect(scan.advance(499, 500)).toBe(false);
  expect(scan.advance(1, 500)).toBe(true);
  expect(scan.handle("select")).toBe("close");
  scan.handle("next");
  expect(scan.nav.index()).toBe(0);
  expect(scan.advance(499, 500)).toBe(false);
});

test("after a selection scanning continues as the user chose", () => {
  const rows = [["copy", "paste"], ["save", "close"]];
  for (const nextScan of ["standard", "automatic", "wait"] as NextScan[]) {
    for (const startFrom of ["standard", "beginning", "selection"] as StartFrom[]) {
      for (const automatic of [false, true]) {
        const scan = ItemScanner.configuredRows(
          rows,
          Policy.KEYBOARD,
          opts({ automatic, nextScan, startFrom }),
        );
        scan.handle("next");
        scan.handle("select");
        scan.handle("next");
        scan.advance(499, 500);
        expect(scan.handle("select")).toBe("close");
        scan.continueAfterSelection();
        const stays = startFrom === "selection";
        const place = stays ? [1, 1] : [0, undefined];
        expect(scan.position(rows)).toEqual(place);
        const waits = automatic && nextScan === "wait";
        expect([scan.suspended, scan.waiting()]).toEqual([waits, waits]);
        if (waits) {
          expect(scan.advance(500, 500)).toBe(false);
          expect(scan.handle("next")).toBeUndefined();
          expect(scan.handle("select")).toBeUndefined();
          expect(scan.suspended || scan.waiting()).toBe(false);
          expect(scan.position(rows)).toEqual(place);
        }
        expect(scan.advance(499, 500)).toBe(false);
        expect(scan.advance(1, 500)).toBe(true);
      }
    }
  }
});

test("a menu left alone stays at the selection", () => {
  const rows = [["copy", "paste"], ["save", "close"]];
  for (const [startFrom, place] of [
    ["standard", [1, 1]],
    ["selection", [1, 1]],
    ["beginning", [0, undefined]],
  ] as [StartFrom, [number, number | undefined]][]) {
    for (const wait of [false, true]) {
      const scan = ItemScanner.configuredRows(
        rows,
        Policy.MENU,
        opts({ startFrom, nextScan: wait ? "wait" : "standard" }),
      );
      scan.handle("next");
      scan.handle("select");
      scan.handle("next");
      expect(scan.handle("select")).toBe("close");
      scan.continueAfterSelection();
      expect(scan.position(rows)).toEqual(place);
      expect(scan.waiting()).toBe(wait);
      if (wait) {
        expect(scan.handle("select")).toBeUndefined();
        expect(scan.position(rows)).toEqual(place);
      }
      expect(scan.advance(499, 500)).toBe(false);
      expect(scan.advance(1, 500)).toBe(true);
    }
  }
  for (const [startFrom, turned] of [
    ["standard", true],
    ["selection", false],
  ] as [StartFrom, boolean][]) {
    const scan = ItemScanner.configuredRows(rows, Policy.MENU, opts({ startFrom }));
    scan.handle("select");
    scan.handle("next");
    scan.handle("reverse");
    expect(scan.handle("select")).toBe("paste");
    scan.continueAfterSelection();
    scan.advance(500, 500);
    expect(scan.position(rows)).toEqual([0, turned ? 0 : undefined]);
  }
});

test("staying at a selection keeps the direction and pass limit", () => {
  const rows = [["copy", "paste", "undo"], ["save", "close"]];
  const scan = ItemScanner.configuredRows(
    rows,
    Policy.KEYBOARD,
    opts({ startFrom: "selection", passLimit: 1 }),
  );
  scan.handle("select");
  scan.handle("next");
  scan.handle("next");
  scan.handle("back");
  expect(scan.handle("select")).toBe("paste");
  scan.continueAfterSelection();
  expect(scan.advance(500, 500)).toBe(true);
  expect(scan.position(rows)).toEqual([0, 2]);
  expect(scan.advance(500, 500)).toBe(true);
  expect(scan.nav.escaping() && !scan.suspended).toBe(true);
  expect(scan.advance(500, 500)).toBe(true);
  expect(scan.suspended && !scan.waiting()).toBe(true);
});

test("a pause that was not chosen still resumes at the start", () => {
  const scan = ItemScanner.configuredRows(
    [["copy", "paste"], ["save", "close"]],
    Policy.KEYBOARD,
    opts({ nextScan: "wait", startFrom: "selection" }),
  );
  scan.handle("next");
  scan.handle("select");
  scan.suspended = true;
  scan.handle("select");
  expect(scan.nav.path()).toEqual([]);
  expect(scan.nav.index()).toBe(0);
});

test("adapters preserve their existing resume policy", () => {
  for (const policy of [Policy.MENU, Policy.KEYBOARD]) {
    const scan = scanner(policy);
    scan.handle("select");
    scan.handle("next");
    scan.suspended = true;
    scan.handle("select");
    expect(scan.nav.path().length === 0).toBe(policy.resumeAtRoot);
    expect(scan.nav.index()).toBe(policy.resumeAtRoot ? 0 : 1);
  }
});

test("reordered groups and keys keep identity and elapsed time", () => {
  const scan = new ItemScanner(
    [group("edit", ["copy", "paste"]), group("window", ["close", "minimise"])],
    Policy.MENU,
  );
  scan.handle("select");
  scan.handle("next");
  scan.advance(400, 500);
  expect(
    scan.replace([group("window", ["close", "minimise"]), group("edit", ["paste", "copy", "undo"])]),
  ).toBe(true);
  expect(scan.nav.path()).toEqual([1]);
  expect(scan.nav.index()).toBe(0);
  expect(scan.advance(99, 500)).toBe(false);
  expect(scan.advance(1, 500)).toBe(true);
  expect(scan.handle("select")).toBe("copy");
});

test("missing item returns to safe parent with a fresh interval", () => {
  const scan = new ItemScanner([group("edit", ["copy", "paste", "undo"])], Policy.MENU);
  scan.handle("select");
  scan.handle("next");
  scan.advance(499, 500);
  scan.replace([group("edit", ["copy", "undo"])]);
  expect(scan.advance(499, 500)).toBe(false);
  expect(scan.handle("select")).toBe("copy");
  scan.replace([]);
  expect(scan.handle("select")).toBeUndefined();
});

test("unchanged content does not cancel activation or reset interval", () => {
  const nodes = () => [group("edit", ["copy", "paste"])];
  const scan = new ItemScanner(nodes(), Policy.MENU);
  scan.handle("select");
  scan.advance(499, 500);
  expect(scan.replace(nodes())).toBe(false);
  expect(scan.advance(1, 500)).toBe(true);
  const token = scan.beginActivation()!;
  expect(scan.replace(nodes())).toBe(false);
  expect(scan.completeActivation(token)).toBe(true);
  expect(scan.completeActivation(token)).toBe(false);
});

test("pending activation blocks steps and selection and stale completion", () => {
  const scan = scanner(Policy.KEYBOARD);
  const first = scan.beginActivation()!;
  expect(scan.beginActivation()).toBeUndefined();
  expect(scan.handle("select")).toBeUndefined();
  expect(scan.handle("next")).toBeUndefined();
  expect(scan.advance(500, 500)).toBe(false);
  scan.restart();
  expect(scan.completeActivation(first)).toBe(false);
  const second = scan.beginActivation()!;
  expect(second).not.toBe(first);
  expect(scan.completeActivation(first)).toBe(false);
  scan.replace([leaf("save")]);
  expect(scan.completeActivation(second)).toBe(false);
  expect(scan.handle("select")).toBe("save");
});

test("back remains back when the hidden edge item disappears", () => {
  for (const forward of [false, true]) {
    const scan = new ItemScanner([group("edit", ["copy", "paste", "undo"])], Policy.MENU);
    scan.handle("select");
    if (forward) {
      scan.handle("next");
      scan.handle("next");
    }
    scan.handle(forward ? "next" : "back");
    expect(scan.nav.escaping()).toBe(true);
    scan.advance(400, 500);
    scan.replace([group("other", ["save", "close"]), group("edit", ["paste", "cut"])]);
    expect(scan.nav.escaping()).toBe(true);
    expect(scan.nav.path()).toEqual([1]);
    expect(scan.advance(99, 500)).toBe(false);
    expect(scan.handle("select")).toBeUndefined();
    expect(scan.nav.path()).toEqual([]);
    expect(scan.nav.index()).toBe(1);
  }
});

test("changing content never resumes a suspended scanner", () => {
  const scan = scanner(Policy.MENU);
  scan.handle("next");
  scan.suspended = true;
  scan.replace([leaf("save")]);
  expect(scan.suspended).toBe(true);
  expect(scan.advance(500, 500)).toBe(false);
  expect(scan.handle("select")).toBeUndefined();
  expect(scan.suspended).toBe(false);
  expect(scan.handle("select")).toBe("save");
});

test("identified group survives shrinking to one item while back is selected", () => {
  for (const forward of [false, true]) {
    const scan = new ItemScanner([group("edit", ["copy", "paste"])], Policy.MENU);
    scan.handle("select");
    if (forward) scan.handle("next");
    scan.handle(forward ? "next" : "back");
    scan.replace([group("edit", ["paste"])]);
    expect(scan.nav.escaping()).toBe(true);
    expect(scan.handle("select")).toBeUndefined();
    expect(scan.nav.path()).toEqual([]);
    expect(scan.handle("select")).toBeUndefined();
    expect(scan.handle("select")).toBe("paste");
  }
});

test("selected leaf survives its group shrinking to one child", () => {
  const scan = new ItemScanner([group("edit", ["copy", "paste"])], Policy.MENU);
  scan.handle("select");
  scan.handle("next");
  scan.replace([group("edit", ["paste"])]);
  expect(scan.nav.path()).toEqual([0]);
  expect(scan.handle("select")).toBe("paste");
});

test("fixed single item rows keep direct activation", () => {
  const scan = ItemScanner.rows([["close"]], Policy.MENU);
  expect(scan.handle("select")).toBe("close");
});

test("linear scanning visits each item once and reports its visual position", () => {
  const rows = [["copy", "paste"], ["save"]];
  const scan = ItemScanner.configuredRows(rows, Policy.MENU, opts({ pattern: "linear" }));
  for (const [r, c, expected] of [
    [0, 0, "copy"],
    [0, 1, "paste"],
    [1, 0, "save"],
  ] as const) {
    expect(scan.rowScan()).toBe(false);
    expect(scan.position(rows)).toEqual([r, c]);
    expect(scan.handle("select")).toBe(expected);
    scan.handle("next");
  }
  expect(scan.position(rows)).toEqual([0, 0]);
});

test("reverse starts at the last group and last item", () => {
  const rows = [["copy", "paste"], ["save", "close"]];
  const scan = ItemScanner.configuredRows(rows, Policy.KEYBOARD, opts({ direction: "reverse" }));
  expect(scan.position(rows)).toEqual([1, undefined]);
  scan.handle("select");
  expect(scan.position(rows)).toEqual([1, 1]);
  expect(scan.handle("select")).toBe("close");
  scan.advance(500, 500);
  expect(scan.handle("select")).toBe("save");
  scan.restart();
  expect(scan.position(rows)).toEqual([1, undefined]);
});

test("configurable pass limits and unlimited do not change resume semantics", () => {
  for (const limit of [0, 1, 2, 3, 5]) {
    const scan = ItemScanner.configuredRows(
      [["copy", "paste"]],
      Policy.MENU,
      opts({ pattern: "linear", passLimit: limit }),
    );
    const ticks = limit === 0 ? 40 : limit * 2;
    for (let i = 0; i < ticks; i++) scan.advance(500, 500);
    expect(scan.suspended).toBe(limit !== 0);
    if (limit !== 0) {
      expect(scan.handle("select")).toBeUndefined();
      expect(scan.suspended).toBe(false);
    }
  }
});
