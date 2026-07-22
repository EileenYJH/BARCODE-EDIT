# Independent Text Font-Size Control Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the user control the separately-placed text region's size via a percentage input, independent of the box's position/rotation. The box becomes move+rotate only (no free corner-drag, no scale-handle); its size is derived from the font-size percentage.

**Architecture:** Backend: `GenerateOptions` gains a `text_font_scale` multiplier applied to the existing proportional font-size default, defaulting to `1.0` (no behavior change for existing callers). Frontend: `text_font_scale` lives inside the existing `options`/`BarcodeOptions` object (no new top-level store field), a new `setTextFontScale` action rescales `textCorners` in sync, `QuadTransformBox` gets a `resizable` prop to hide its corner/scale handles for the text box, and `AdjustPanel`'s 4 free text-corner inputs are replaced with center X/Y + rotation (since the box can no longer be skewed).

**Tech Stack:** Python 3.14, opencv 5.0, pytest (backend). TypeScript, React 19, Zustand, Konva, Vitest + Testing Library (frontend).

---

### Task 1: Backend — `text_font_scale` option

**Files:**
- Modify: `services/api/pipeline/generate.py:15-21` (GenerateOptions), `services/api/pipeline/generate.py:60-63` (`_generate_linear`'s `common` dict)
- Modify: `services/api/schemas.py:17-21` (OptionsIn)
- Test: `services/api/tests/test_generate.py`

- [ ] **Step 1: Write the failing test**

Add to `services/api/tests/test_generate.py` (near the other `generate_barcode_split` tests):

```python
def test_text_font_scale_changes_text_height_independent_of_bars():
    base_full, base_bars, base_text = generate_barcode_split(
        "code128", "HELLO123", GenerateOptions(show_text=True), target_aspect=2.5)
    scaled_full, scaled_bars, scaled_text = generate_barcode_split(
        "code128", "HELLO123", GenerateOptions(show_text=True, text_font_scale=1.8),
        target_aspect=2.5)
    # bars crop comes from a text-off render, so it must be pixel-identical
    # regardless of text_font_scale -- confirms the two are truly decoupled
    assert np.array_equal(scaled_bars, base_bars)
    # a bigger font_size renders taller text
    assert scaled_text.shape[0] > base_text.shape[0]
```

Check the top of `test_generate.py` for its existing `import numpy as np` (it's already used elsewhere in the file for bitmap comparisons) — add it if missing.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd services/api && .venv/Scripts/python.exe -m pytest tests/test_generate.py::test_text_font_scale_changes_text_height_independent_of_bars -v`
Expected: FAIL with `TypeError: __init__() got an unexpected keyword argument 'text_font_scale'` (the field doesn't exist yet).

- [ ] **Step 3: Add the field and wire it into font-size computation**

In `services/api/pipeline/generate.py`, change:

```python
@dataclass
class GenerateOptions:
    show_text: bool = True
    quiet_zone: float = 6.5      # mm, python-barcode units
    module_width: float = 0.2    # mm
    module_height: float = 15.0  # mm
```

to:

```python
@dataclass
class GenerateOptions:
    show_text: bool = True
    quiet_zone: float = 6.5      # mm, python-barcode units
    module_width: float = 0.2    # mm
    module_height: float = 15.0  # mm
    text_font_scale: float = 1.0 # multiplier on the proportional font-size
                                  # default, independent of module_height --
                                  # lets a separately-placed text region's
                                  # size be controlled without affecting bars
                                  # sizing. 1.0 reproduces today's exact
                                  # output for every existing caller.
```

Then change the `common` dict inside `_generate_linear` (currently around line 60-63):

```python
    common = {"write_text": opts.show_text, "quiet_zone": opts.quiet_zone,
              "module_width": opts.module_width, "module_height": opts.module_height,
              "font_size": _proportional_font_size(opts.module_height),
              "dpi": dpi}
```

to:

```python
    common = {"write_text": opts.show_text, "quiet_zone": opts.quiet_zone,
              "module_width": opts.module_width, "module_height": opts.module_height,
              "font_size": _proportional_font_size(opts.module_height) * opts.text_font_scale,
              "dpi": dpi}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd services/api && .venv/Scripts/python.exe -m pytest tests/test_generate.py::test_text_font_scale_changes_text_height_independent_of_bars -v`
Expected: PASS

- [ ] **Step 5: Expose the field on the API schema**

In `services/api/schemas.py`, change:

```python
class OptionsIn(BaseModel):
    show_text: bool = True
    quiet_zone: float = 6.5
    module_width: float = 0.2
    module_height: float = 15.0
```

to:

```python
class OptionsIn(BaseModel):
    show_text: bool = True
    quiet_zone: float = 6.5
    module_width: float = 0.2
    module_height: float = 15.0
    text_font_scale: float = 1.0
```

`routes.py`'s `GenerateOptions(**req.options.model_dump())` (line 43) already forwards every `OptionsIn` field by name — no change needed there.

- [ ] **Step 6: Run the full backend suite**

Run: `cd services/api && .venv/Scripts/python.exe -m pytest tests/ -q`
Expected: all pass (48 total: 47 existing + 1 new).

- [ ] **Step 7: Commit**

```bash
git add services/api/pipeline/generate.py services/api/schemas.py services/api/tests/test_generate.py
git commit -m "feat: add text_font_scale option, independent of bars sizing"
```

### Task 2: Frontend — `quadRotation` helper

**Files:**
- Modify: `apps/web/lib/transform.ts:39-70` (extract `quadRotation` from `straightenQuad`)
- Test: `apps/web/lib/transform.test.ts`

- [ ] **Step 1: Write the failing tests**

Add to `apps/web/lib/transform.test.ts`, after the `rotateQuad` describe block:

```ts
describe("quadRotation", () => {
  it("returns 0 for an axis-aligned rectangle", () => {
    const corners: Corner[] = [[0, 0], [100, 0], [100, 50], [0, 50]];
    expect(quadRotation(corners)).toBeCloseTo(0, 5);
  });

  it("matches the angle used to rotate a rectangle via rotateQuad", () => {
    const rect: Corner[] = [[0, 0], [100, 0], [100, 50], [0, 50]];
    const rotated = rotateQuad(rect, Math.PI / 6);
    expect(quadRotation(rotated)).toBeCloseTo(Math.PI / 6, 5);
  });
});
```

Add `quadRotation` to the existing import line at the top of the file:

```ts
import { quadCenter, scaleQuad, rotateQuad, quadRotation, offsetTextQuad, scaleFactorFromDrag, straightenQuad } from "./transform";
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/web && npx vitest run lib/transform.test.ts -t quadRotation`
Expected: FAIL — `quadRotation` is not exported yet.

- [ ] **Step 3: Extract `quadRotation` from `straightenQuad` and export it**

In `apps/web/lib/transform.ts`, `straightenQuad` currently computes its angle inline (around lines 55-61):

```ts
  // average the top and bottom edges' directions as vectors (not just their
  // angles) so the two average correctly even near the +-pi wraparound
  const topAngle = Math.atan2(tr[1] - tl[1], tr[0] - tl[0]);
  const bottomAngle = Math.atan2(br[1] - bl[1], br[0] - bl[0]);
  const avgDx = Math.cos(topAngle) + Math.cos(bottomAngle);
  const avgDy = Math.sin(topAngle) + Math.sin(bottomAngle);
  const angle = Math.atan2(avgDy, avgDx);
```

Replace `straightenQuad`'s body so it calls a new standalone function instead. First add this new exported function right before `straightenQuad`:

```ts
export function quadRotation(corners: Corner[]): number {
  // average the top and bottom edges' directions as vectors (not just their
  // angles) so the two average correctly even near the +-pi wraparound
  const [tl, tr, br, bl] = corners;
  const topAngle = Math.atan2(tr[1] - tl[1], tr[0] - tl[0]);
  const bottomAngle = Math.atan2(br[1] - bl[1], br[0] - bl[0]);
  const avgDx = Math.cos(topAngle) + Math.cos(bottomAngle);
  const avgDy = Math.sin(topAngle) + Math.sin(bottomAngle);
  return Math.atan2(avgDy, avgDx);
}
```

Then update `straightenQuad` to use it — replace the block quoted above (the 5 lines computing `topAngle` through `angle`) with:

```ts
  const angle = quadRotation(corners);
```

(Leave the rest of `straightenQuad` — the width/height calculation and the final corner reconstruction — exactly as it is.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/web && npx vitest run lib/transform.test.ts`
Expected: all PASS, including the 2 new `quadRotation` tests and every pre-existing `straightenQuad` test (confirms the extraction didn't change `straightenQuad`'s behavior).

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/transform.ts apps/web/lib/transform.test.ts
git commit -m "refactor: extract quadRotation helper from straightenQuad"
```

### Task 3: Frontend — `text_font_scale` in store + `setTextFontScale` action

**Files:**
- Modify: `apps/web/lib/types.ts:11-16` (BarcodeOptions)
- Modify: `apps/web/lib/store.ts` (initial options, new action, `resetCorners`)
- Test: `apps/web/lib/store.test.ts`

- [ ] **Step 1: Write the failing tests**

Add to `apps/web/lib/store.test.ts`, inside (or right after) the `describe("separate text placement", ...)` block:

```ts
it("setTextFontScale updates options.text_font_scale and rescales textCorners around their center", () => {
  useEditor.getState().setTextCorners([[0, 0], [100, 0], [100, 40], [0, 40]]); // center [50, 20]
  useEditor.getState().setTextFontScale(1.5);
  expect(useEditor.getState().options.text_font_scale).toBe(1.5);
  expect(useEditor.getState().textCorners).toEqual([[-25, -10], [125, -10], [125, 50], [-25, 50]]);
});

it("setTextFontScale updates the option even when there are no text corners yet", () => {
  useEditor.getState().setTextFontScale(1.2);
  expect(useEditor.getState().options.text_font_scale).toBe(1.2);
  expect(useEditor.getState().textCorners).toBeNull();
});

it("resetCorners preserves the current text_font_scale instead of snapping back to 100%", () => {
  useEditor.getState().setDetectedCorners([[0, 0], [200, 0], [200, 50], [0, 50]]);
  useEditor.getState().setCorners([[0, 0], [200, 0], [200, 50], [0, 50]]);
  useEditor.getState().setSeparateTextPlacement(true); // textCorners = offsetTextQuad(...): [[0,50],[200,50],[200,70],[0,70]]
  useEditor.getState().setTextFontScale(2.0); // textCorners doubles around its own center
  useEditor.getState().resetCorners();
  // offsetTextQuad(detectedCorners) is [[0,50],[200,50],[200,70],[0,70]] (center [100,60]),
  // scaled by 2.0 around that same center
  expect(useEditor.getState().textCorners).toEqual([[-100, 40], [300, 40], [300, 80], [-100, 80]]);
});
```

Update the `reset()` helper at the top of `store.test.ts` to include the new options field (TypeScript will otherwise reject the incomplete `BarcodeOptions` object once Step 3 below lands):

```ts
    options: { show_text: true, quiet_zone: 6.5, module_width: 0.2, module_height: 15, text_font_scale: 1 },
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/web && npx vitest run lib/store.test.ts -t setTextFontScale`
Expected: FAIL — `setTextFontScale` is not a function yet.

- [ ] **Step 3: Add `text_font_scale` to `BarcodeOptions`**

In `apps/web/lib/types.ts`, change:

```ts
export interface BarcodeOptions {
  show_text: boolean;
  quiet_zone: number;
  module_width: number;
  module_height: number;
}
```

to:

```ts
export interface BarcodeOptions {
  show_text: boolean;
  quiet_zone: number;
  module_width: number;
  module_height: number;
  text_font_scale: number;
}
```

- [ ] **Step 4: Add the action and wire up `resetCorners`**

In `apps/web/lib/store.ts`:

1. Add `scaleQuad` to the existing import from `./transform` (currently only `offsetTextQuad` is imported):

```ts
import { offsetTextQuad, scaleQuad } from "./transform";
```

2. Update the initial `options` value:

```ts
  options: { show_text: true, quiet_zone: 6.5, module_width: 0.2, module_height: 15, text_font_scale: 1.0 },
```

3. Add `setTextFontScale: (pct: number) => void;` to the `EditorState` interface, near `setSeparateTextPlacement`.

4. Add the action implementation, near `setSeparateTextPlacement`:

```ts
  setTextFontScale: (pct) => set((s) => {
    const options = { ...s.options, text_font_scale: pct };
    if (!s.textCorners) return { options };
    return { options, textCorners: scaleQuad(s.textCorners, pct / s.options.text_font_scale) };
  }),
```

5. Update `resetCorners` — change:

```ts
      return {
        corners: s.detectedCorners,
        textCorners: s.separateTextPlacement ? offsetTextQuad(s.detectedCorners) : s.textCorners,
      };
```

to:

```ts
      return {
        corners: s.detectedCorners,
        textCorners: s.separateTextPlacement
          ? scaleQuad(offsetTextQuad(s.detectedCorners), s.options.text_font_scale)
          : s.textCorners,
      };
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd apps/web && npx vitest run lib/store.test.ts`
Expected: all PASS.

- [ ] **Step 6: Run the full frontend test suite**

Run: `cd apps/web && npx vitest run`
Expected: all PASS (this will also catch any other test files whose `options`/`BarcodeOptions` literals need the new field — fix any you find the same way the `store.test.ts` fixture was fixed in Step 1, i.e. add `text_font_scale: 1` to the literal).

- [ ] **Step 7: Commit**

```bash
git add apps/web/lib/types.ts apps/web/lib/store.ts apps/web/lib/store.test.ts
git commit -m "feat: add text_font_scale to store, sync textCorners size to it"
```

(If Step 6 required fixing other test files, `git add` those too.)

### Task 4: Frontend — `resizable` prop on `QuadTransformBox`

**Files:**
- Modify: `apps/web/components/EditorCanvas.tsx`

No test file exists for this component today (Konva canvas interactions aren't unit tested in this codebase) — this task is verified manually in Task 6.

- [ ] **Step 1: Add the `resizable` prop**

In `apps/web/components/EditorCanvas.tsx`, update `QuadTransformBoxProps` (around line 22-30):

```ts
interface QuadTransformBoxProps {
  corners: Corner[];
  scale: number;
  color: string;
  resizable?: boolean;
  onUpdateCorner: (i: number, c: Corner) => void;
  onMoveQuad: (delta: Corner) => void;
  onSetCorners: (c: Corner[]) => void;
  onCommit: () => void;
}
```

Update the function signature (around line 32) to destructure it with a default:

```ts
function QuadTransformBox({ corners, scale, color, resizable = true, onUpdateCorner, onMoveQuad, onSetCorners, onCommit }: QuadTransformBoxProps) {
```

- [ ] **Step 2: Conditionally render the corner-drag and scale handles**

In the same component's returned JSX (around lines 97-127), wrap the corner `Circle`s and the scale `Rect`s in a `resizable` check. Change:

```tsx
      {corners.map((c, i) => (
        <Circle key={i} x={c[0] * scale} y={c[1] * scale} radius={7}
                fill={color} draggable
                onDragMove={(e) => onUpdateCorner(i, [e.target.x() / scale, e.target.y() / scale])}
                onDragEnd={() => onCommit()} />
      ))}
      {edgeMidpoints.map((m, i) => (
        <Rect key={`scale-${i}`} x={m[0] * scale - 5} y={m[1] * scale - 5} width={10} height={10}
              fill="#f97316" draggable
              onDragStart={handleScaleDragStart}
              onDragMove={handleScaleDragMove}
              onDragEnd={handleTransformDragEnd} />
      ))}
```

to:

```tsx
      {resizable && corners.map((c, i) => (
        <Circle key={i} x={c[0] * scale} y={c[1] * scale} radius={7}
                fill={color} draggable
                onDragMove={(e) => onUpdateCorner(i, [e.target.x() / scale, e.target.y() / scale])}
                onDragEnd={() => onCommit()} />
      ))}
      {resizable && edgeMidpoints.map((m, i) => (
        <Rect key={`scale-${i}`} x={m[0] * scale - 5} y={m[1] * scale - 5} width={10} height={10}
              fill="#f97316" draggable
              onDragStart={handleScaleDragStart}
              onDragMove={handleScaleDragMove}
              onDragEnd={handleTransformDragEnd} />
      ))}
```

Leave the body `Line` (move) and the rotate-handle `Circle` exactly as they are — both stay active regardless of `resizable`.

- [ ] **Step 3: Pass `resizable={false}` for the text box**

Find the text box's `QuadTransformBox` usage (around line 159-161):

```tsx
        {textCorners && separateTextPlacement && adjusting && (
          <QuadTransformBox corners={textCorners} scale={scale} color="#a855f7"
            onUpdateCorner={updateTextCorner} onMoveQuad={moveTextQuad} onSetCorners={setTextCorners} onCommit={commit} />
        )}
```

Add `resizable={false}`:

```tsx
        {textCorners && separateTextPlacement && adjusting && (
          <QuadTransformBox corners={textCorners} scale={scale} color="#a855f7" resizable={false}
            onUpdateCorner={updateTextCorner} onMoveQuad={moveTextQuad} onSetCorners={setTextCorners} onCommit={commit} />
        )}
```

The bars box's own `QuadTransformBox` usage (a few lines above) is untouched — its `resizable` prop is omitted, so it defaults to `true`.

- [ ] **Step 4: Type-check**

Run: `cd apps/web && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add apps/web/components/EditorCanvas.tsx
git commit -m "feat: make the text placement box move+rotate only, not freely resizable"
```

### Task 5: Frontend — `AdjustPanel` center/rotation/font-size controls

**Files:**
- Modify: `apps/web/components/AdjustPanel.tsx`
- Test: `apps/web/components/AdjustPanel.test.tsx`

- [ ] **Step 1: Update the failing/changing tests**

In `apps/web/components/AdjustPanel.test.tsx`:

1. Update the `reset()` helper to include an `options` field (it's read by the new font-size input), matching the store's shape:

```ts
function reset() {
  useEditor.setState({
    corners: [[10, 10], [20, 10], [20, 20], [10, 20]],
    detectedCorners: [[10, 10], [20, 10], [20, 20], [10, 20]],
    adjusting: true,
    result: null,
    history: [],
    historyIndex: -1,
    separateTextPlacement: false,
    textCorners: null,
    options: { show_text: true, quiet_zone: 6.5, module_width: 0.2, module_height: 15, text_font_scale: 1 },
  });
}
```

2. Replace this test (it asserts the old 4-corner-input count, which no longer applies to the text box):

```ts
  it("shows a second placement grid for text corners when separateTextPlacement is on", () => {
    useEditor.setState({ separateTextPlacement: true, textCorners: [[1, 1], [2, 1], [2, 2], [1, 2]] });
    render(<AdjustPanel onConfirm={() => {}} isPending={false} />);
    const inputs = screen.getAllByRole("spinbutton");
    expect(inputs).toHaveLength(16); // 4 bars corners + 4 text corners, x2 each
  });
```

with:

```ts
  it("shows center X/Y, rotation, and text-size inputs when separateTextPlacement is on", () => {
    useEditor.setState({ separateTextPlacement: true, textCorners: [[0, 0], [100, 0], [100, 40], [0, 40]] });
    render(<AdjustPanel onConfirm={() => {}} isPending={false} />);
    const inputs = screen.getAllByRole("spinbutton");
    // 4 bars corners x2 (8) + center X, center Y, rotation, text size (4) = 12
    expect(inputs).toHaveLength(12);
  });
```

3. Update this test (still true, just the count changes from 8 to 8 — the bars-only case is unaffected, but double check by reading `AdjustPanel.tsx` — it's unchanged, skip if already correct):

```ts
  it("hides the text placement grid when separateTextPlacement is off", () => {
    useEditor.setState({ separateTextPlacement: false, textCorners: null });
    render(<AdjustPanel onConfirm={() => {}} isPending={false} />);
    const inputs = screen.getAllByRole("spinbutton");
    expect(inputs).toHaveLength(8);
  });
```

This one is unchanged — leave it as-is.

4. Replace this test (it edits a raw text-corner input, which no longer exists):

```ts
  it("editing a text corner input updates textCorners", () => {
    useEditor.setState({ separateTextPlacement: true, textCorners: [[1, 1], [2, 1], [2, 2], [1, 2]] });
    render(<AdjustPanel onConfirm={() => {}} isPending={false} />);
    const inputs = screen.getAllByRole("spinbutton");
    fireEvent.change(inputs[8], { target: { value: "50" } }); // first text-corner input
    expect(useEditor.getState().textCorners![0][0]).toBe(50);
  });
```

with:

```ts
  it("editing the text center X input moves the text quad", () => {
    useEditor.setState({ separateTextPlacement: true, textCorners: [[0, 0], [100, 0], [100, 40], [0, 40]] });
    render(<AdjustPanel onConfirm={() => {}} isPending={false} />);
    const inputs = screen.getAllByRole("spinbutton");
    fireEvent.change(inputs[8], { target: { value: "60" } }); // center X, first text input
    // center was [50, 20]; moving center X to 60 shifts every corner +10 in x
    expect(useEditor.getState().textCorners).toEqual([[10, 0], [110, 0], [110, 40], [10, 40]]);
  });

  it("editing the text rotation input rotates the text quad in place", () => {
    useEditor.setState({ separateTextPlacement: true, textCorners: [[0, 0], [100, 0], [100, 40], [0, 40]] });
    render(<AdjustPanel onConfirm={() => {}} isPending={false} />);
    const inputs = screen.getAllByRole("spinbutton");
    fireEvent.change(inputs[10], { target: { value: "90" } }); // rotation input
    const [tl, tr] = useEditor.getState().textCorners!;
    // after a 90-degree rotation the top edge should now point roughly vertically
    expect(Math.abs(tr[0] - tl[0])).toBeLessThan(1);
  });

  it("editing the text size input calls setTextFontScale", () => {
    useEditor.setState({ separateTextPlacement: true, textCorners: [[0, 0], [100, 0], [100, 40], [0, 40]] });
    render(<AdjustPanel onConfirm={() => {}} isPending={false} />);
    const inputs = screen.getAllByRole("spinbutton");
    fireEvent.change(inputs[11], { target: { value: "150" } }); // text size, %
    expect(useEditor.getState().options.text_font_scale).toBe(1.5);
  });
```

5. Remove the "second Straighten button" test entirely (the text box can no longer be skewed — via drag or via numeric corner input — so there's nothing left for a text "Straighten" button to do; Step 3 below removes it from the component):

```ts
  it("a second Straighten button snaps the text quad when separate text placement is on", () => {
    useEditor.setState({ separateTextPlacement: true, textCorners: [[10, 10], [90, 15], [85, 40], [5, 35]] });
    render(<AdjustPanel onConfirm={() => {}} isPending={false} />);
    const buttons = screen.getAllByRole("button", { name: /straighten/i });
    expect(buttons).toHaveLength(2);
    fireEvent.click(buttons[1]);

    const [tl, tr, br, bl] = useEditor.getState().textCorners!;
    const topVec = [tr[0] - tl[0], tr[1] - tl[1]];
    const leftVec = [bl[0] - tl[0], bl[1] - tl[1]];
    expect(topVec[0] * leftVec[0] + topVec[1] * leftVec[1]).toBeCloseTo(0, 3); // right angle
  });
```

Delete this test entirely — remove it from the file.

- [ ] **Step 2: Run tests to verify the new/changed ones fail**

Run: `cd apps/web && npx vitest run components/AdjustPanel.test.tsx`
Expected: FAIL (the new center/rotation/text-size inputs don't exist in the component yet).

- [ ] **Step 3: Update `AdjustPanel.tsx`**

Replace the whole file with:

```tsx
"use client";
import { useEditor } from "@/lib/store";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { straightenQuad, quadCenter, quadRotation, rotateQuad } from "@/lib/transform";
import type { Corner } from "@/lib/types";

interface AdjustPanelProps {
  onConfirm: () => void;
  isPending: boolean;
}

export function AdjustPanel({ onConfirm, isPending }: AdjustPanelProps) {
  const {
    corners, detectedCorners, adjusting, result, updateCorner, commit, resetCorners,
    textCorners, separateTextPlacement, options, moveTextQuad, setTextCorners, setTextFontScale,
    setCorners,
  } = useEditor();

  if (!adjusting || !corners) return null;

  function handleNumberChange(i: number, axis: 0 | 1, raw: string) {
    const n = Number(raw);
    if (Number.isNaN(n)) return;
    const c: Corner = [...corners![i]] as Corner;
    c[axis] = n;
    updateCorner(i, c);
  }

  function handleTextCenterChange(axis: 0 | 1, raw: string) {
    const n = Number(raw);
    if (Number.isNaN(n)) return;
    const center = quadCenter(textCorners!);
    const delta: Corner = axis === 0 ? [n - center[0], 0] : [0, n - center[1]];
    moveTextQuad(delta);
  }

  function handleTextRotationChange(raw: string) {
    const n = Number(raw);
    if (Number.isNaN(n)) return;
    const targetRad = (n * Math.PI) / 180;
    const currentRad = quadRotation(textCorners!);
    setTextCorners(rotateQuad(textCorners!, targetRad - currentRad));
  }

  function handleTextFontScaleChange(raw: string) {
    const n = Number(raw);
    if (Number.isNaN(n)) return;
    setTextFontScale(n / 100);
  }

  function straightenBars() {
    setCorners(straightenQuad(corners!));
    commit();
  }

  return (
    <div className="space-y-3">
      <Label>Placement</Label>
      <div className="grid grid-cols-2 gap-2">
        {corners.map((c, i) => (
          <div key={i} className="contents">
            <Input type="number" value={c[0]}
                   onChange={(e) => handleNumberChange(i, 0, e.target.value)}
                   onBlur={() => commit()} />
            <Input type="number" value={c[1]}
                   onChange={(e) => handleNumberChange(i, 1, e.target.value)}
                   onBlur={() => commit()} />
          </div>
        ))}
      </div>
      <Button variant="outline" size="sm" onClick={straightenBars}>
        Straighten
      </Button>
      {separateTextPlacement && textCorners && (
        <>
          <Label>Value text placement</Label>
          <div className="grid grid-cols-2 gap-2">
            <Input type="number" value={quadCenter(textCorners)[0]}
                   onChange={(e) => handleTextCenterChange(0, e.target.value)}
                   onBlur={() => commit()} />
            <Input type="number" value={quadCenter(textCorners)[1]}
                   onChange={(e) => handleTextCenterChange(1, e.target.value)}
                   onBlur={() => commit()} />
          </div>
          <Label>Rotation (degrees)</Label>
          <Input type="number"
                 value={Math.round(((quadRotation(textCorners) * 180) / Math.PI) * 10) / 10}
                 onChange={(e) => handleTextRotationChange(e.target.value)}
                 onBlur={() => commit()} />
          <Label>Text size (%)</Label>
          <Input type="number" min={50} max={200}
                 value={Math.round(options.text_font_scale * 100)}
                 onChange={(e) => handleTextFontScaleChange(e.target.value)}
                 onBlur={() => commit()} />
        </>
      )}
      <div className="flex gap-2">
        {detectedCorners && (
          <Button variant="outline" size="sm" onClick={resetCorners}>
            Reset to detected
          </Button>
        )}
        {result && (
          <Button size="sm" disabled={isPending} onClick={onConfirm}>
            {isPending ? "Confirming..." : "Confirm placement"}
          </Button>
        )}
      </div>
    </div>
  );
}
```

Note what changed from the original: `updateTextCorner` and `setTextCorners`-for-corner-editing are gone from the destructured store fields (replaced by `moveTextQuad`, `setTextCorners`-for-rotation, and `setTextFontScale`); `straightenText` and its button are removed entirely (the text box can no longer become skewed, so there's nothing to straighten); the 4-corner grid for text is replaced by center X/Y + rotation + text size.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/web && npx vitest run components/AdjustPanel.test.tsx`
Expected: all PASS.

- [ ] **Step 5: Run the full frontend test suite and type-check**

Run: `cd apps/web && npx vitest run && npx tsc --noEmit`
Expected: all PASS, no type errors.

- [ ] **Step 6: Commit**

```bash
git add apps/web/components/AdjustPanel.tsx apps/web/components/AdjustPanel.test.tsx
git commit -m "feat: replace text-corner inputs with center/rotation/text-size controls"
```

### Task 6: Manual browser verification

**Files:** none modified — verification only.

- [ ] **Step 1: Start both dev servers**

`.claude/launch.json` already defines both: `preview_start({name: "api"})` (uvicorn on port 8000) and `preview_start({name: "web"})` (Next dev server on port 3000). Start both, then open the web one in the browser.

- [ ] **Step 2: Walk through the feature in the browser**

Upload a test image (any barcode photo, or use one of the fixtures under `services/api/tests/` if a suitable image exists), detect/adjust placement, turn on "Separate text placement", and confirm:
- The bars box still shows all 4 corner-drag handles and the orange scale-handles (unchanged).
- The text (purple) box shows only the move-by-drag body and the rotate handle — no corner circles, no scale-handles.
- The side panel shows "Value text placement" with 2 center inputs, a rotation input, and a "Text size (%)" input (not 4 corner x/y pairs).
- Changing "Text size (%)" visibly grows/shrinks the purple box on canvas, centered in place.
- Dragging the purple box's body moves it; dragging its rotate handle rotates it.
- Clicking Replace produces a result where the text renders at roughly the expected size, not stretched/squashed.

- [ ] **Step 3: Report findings**

If anything looks wrong, stop and report the specifics (what you did, what you expected, what you saw) rather than making further code changes within this plan.
