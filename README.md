# @switchify/scanning

Switch scanning for React and React Native. The scanning engine is a TypeScript port of the item scanner in [Switchify PC](https://github.com/switchifyapp/switchify-pc) (`scan_tree.rs`, `scan_items.rs`, `scan_preferences.rs`), with its tests carried over.

The library is headless: it tells each item and group whether it is highlighted, and your app draws the highlight. Switches either come through `useKeyboardSwitches` (DOM), or your own input calling `dispatch` with `select`, `next`, `back`, `pause`, `reverse` or `stop`.

| Import | Use |
|---|---|
| `@switchify/scanning` | Engine and `ScanController`, no React |
| `@switchify/scanning/react` | Hooks for any renderer, ordered by `order` or registration |
| `@switchify/scanning/dom` | React DOM, ordered by document position |
| `@switchify/scanning/native` | React Native, ordered by on-screen position |

## React DOM

```tsx
import { ScanProvider, ScanGroupScope, useScanGroup, useScanItem, useScanner, scanItemAttributes, scanGroupAttributes } from "@switchify/scanning/dom";

function Key({ id, onPress }: { id: string; onPress: () => void }) {
  const item = useScanItem<HTMLButtonElement>(id, { onActivate: onPress });
  return <button ref={item.ref} onClick={onPress} {...scanItemAttributes(item)}>{id}</button>;
}

function Row({ id, children }: { id: string; children: React.ReactNode }) {
  const row = useScanGroup<HTMLDivElement>(id);
  return (
    <div ref={row.ref} {...scanGroupAttributes(row)}>
      <ScanGroupScope id={id}>{children}</ScanGroupScope>
    </div>
  );
}

function SwitchKeys() {
  const { dispatch } = useScanner();
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.code === "Space") dispatch("select");
      if (event.code === "Enter") dispatch("next");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [dispatch]);
  return null;
}

<ScanProvider options={{ intervalMs: 1000, pattern: "grouped" }}>
  <SwitchKeys />
  <Row id="row-1"><Key id="a" onPress={...} /><Key id="b" onPress={...} /></Row>
</ScanProvider>
```

Style with `[data-scan-highlighted]`, `[data-scan-group-highlighted]`, `[data-scan-entered]` and `[data-scan-escape-highlighted]`.

## Switches

`useKeyboardSwitches` (from `/dom`) reads keyboard-style switch interfaces. Each binding has a `KeyboardEvent.code`, a press action, and hold actions offered in turn every `holdIntervalMs`, matching Switchify PC:

```tsx
const { held, prompt } = useKeyboardSwitches({
  settings: {
    holdIntervalMs: 1000,
    bindings: [
      { id: "select", name: "Select", key: "Space", pressAction: "select", holdActions: ["reverse", "stop"] },
      { id: "next", name: "Next", key: "Enter", pressAction: "next", holdActions: [] },
    ],
  },
});
// prompt?.action is what releasing now would do.
```

- Bound keys are kept from the page, so Space and Enter don't also click whatever has focus.
- Keys pass through while focus is in a text field, unless you set `ignoreWhileTyping: false`.
- Escape stops scanning.
- `interceptPress(switchId)` runs when a switch goes down. Return true to consume the whole press, for example to let any press stop something the app is repeating.
- Automatic movement pauses while a switch is held. Call `controller.holdMovement(reason, held)` to hold it for reasons of your own, for example while something the app started is still repeating.
- `validateSwitchSettings` reports settings that can't drive scanning, for example ones with no Select, or manual scanning without Next and Previous.

## React Native

```tsx
import { ScanProvider, useScanItem } from "@switchify/scanning/native";

function Tile({ id, onPress }) {
  const item = useScanItem<View>(id, { onActivate: onPress });
  return (
    <View ref={item.ref} onLayout={item.onLayout} style={item.highlighted && styles.highlight}>
      ...
    </View>
  );
}
```

Call `item.measure()` after scrolling if the order should follow the new positions.

## Options

| Option | Values | Default |
|---|---|---|
| `automatic` | `true`, `false` | `true` |
| `intervalMs` | 100–10000 | 1000 |
| `direction` | `forward`, `reverse` | `forward` |
| `passLimit` | 0 (unlimited), 1, 2, 3, 5 | 3 |
| `pattern` | `grouped`, `linear` | `grouped` |
| `nextScan` | `standard`, `automatic`, `wait` | `standard` |
| `startFrom` | `standard`, `beginning`, `selection` | `standard` |

`ScanProvider` also takes `policy` (`Policy.KEYBOARD`, the default, restarts from the top; `Policy.MENU` stays where it was), `afterSelection` (`continue` or `stop`), `onSelect` and `onError`. If `onActivate` returns a promise, scanning holds until it settles.

Pass `exclusive` to `useScanGroup` or `<ScanGroup>` for a dialog: while it is mounted, scanning is confined to it. The most recently mounted exclusive group wins.

Ids must be unique across items and groups.

## License

AGPL-3.0-only, matching Switchify PC.
