import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { useEditor } from "@/lib/store";
import { AdjustPanel } from "./AdjustPanel";

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

describe("AdjustPanel", () => {
  beforeEach(reset);

  it("renders a numeric input per corner and updates the store on change", () => {
    render(<AdjustPanel onConfirm={() => {}} isPending={false} />);
    const inputs = screen.getAllByRole("spinbutton");
    expect(inputs).toHaveLength(8); // 4 corners x (x,y)
    fireEvent.change(inputs[0], { target: { value: "50" } });
    expect(useEditor.getState().corners![0][0]).toBe(50);
  });

  it("Reset button restores detectedCorners", () => {
    useEditor.getState().updateCorner(0, [99, 99]);
    render(<AdjustPanel onConfirm={() => {}} isPending={false} />);
    fireEvent.click(screen.getByRole("button", { name: /reset/i }));
    expect(useEditor.getState().corners![0]).toEqual([10, 10]);
  });

  it("Confirm button calls onConfirm when a result already exists", () => {
    useEditor.setState({ result: { result: "x", svg: "<svg/>", layers: { original: "a", new_barcode: "b", mask: "c" } } });
    const onConfirm = vi.fn();
    render(<AdjustPanel onConfirm={onConfirm} isPending={false} />);
    fireEvent.click(screen.getByRole("button", { name: /confirm/i }));
    expect(onConfirm).toHaveBeenCalledOnce();
  });

  it("Confirm button is absent before any result exists", () => {
    render(<AdjustPanel onConfirm={() => {}} isPending={false} />);
    expect(screen.queryByRole("button", { name: /confirm/i })).toBeNull();
  });

  it("shows center X/Y, rotation, and text-size inputs when separateTextPlacement is on", () => {
    useEditor.setState({ separateTextPlacement: true, textCorners: [[0, 0], [100, 0], [100, 40], [0, 40]] });
    render(<AdjustPanel onConfirm={() => {}} isPending={false} />);
    const inputs = screen.getAllByRole("spinbutton");
    // 4 bars corners x2 (8) + center X, center Y, rotation, text size (4) = 12
    expect(inputs).toHaveLength(12);
  });

  it("hides the text placement grid when separateTextPlacement is off", () => {
    useEditor.setState({ separateTextPlacement: false, textCorners: null });
    render(<AdjustPanel onConfirm={() => {}} isPending={false} />);
    const inputs = screen.getAllByRole("spinbutton");
    expect(inputs).toHaveLength(8);
  });

  it("editing the text center X input moves the text quad", () => {
    useEditor.setState({ separateTextPlacement: true, textCorners: [[0, 0], [100, 0], [100, 40], [0, 40]] });
    render(<AdjustPanel onConfirm={() => {}} isPending={false} />);
    const inputs = screen.getAllByRole("spinbutton");
    fireEvent.change(inputs[8], { target: { value: "60" } }); // center X, first text input
    // center was [50, 20]; moving center X to 60 shifts every corner +10 in x
    expect(useEditor.getState().textCorners).toEqual([[10, 0], [110, 0], [110, 40], [10, 40]]);
  });

  it("editing the text rotation input rotates the text quad exactly by the specified angle", () => {
    useEditor.setState({ separateTextPlacement: true, textCorners: [[0, 0], [100, 0], [100, 40], [0, 40]] });
    render(<AdjustPanel onConfirm={() => {}} isPending={false} />);
    const inputs = screen.getAllByRole("spinbutton");
    fireEvent.change(inputs[10], { target: { value: "90" } }); // rotation input
    const corners = useEditor.getState().textCorners!;
    // center is [50, 20]; rotating +90 degrees around it via the same
    // rotation-matrix convention rotateQuad uses
    expect(corners[0][0]).toBeCloseTo(70, 1);
    expect(corners[0][1]).toBeCloseTo(-30, 1);
    expect(corners[1][0]).toBeCloseTo(70, 1);
    expect(corners[1][1]).toBeCloseTo(70, 1);
  });

  it("editing the text size input calls setTextFontScale", () => {
    useEditor.setState({ separateTextPlacement: true, textCorners: [[0, 0], [100, 0], [100, 40], [0, 40]] });
    render(<AdjustPanel onConfirm={() => {}} isPending={false} />);
    const inputs = screen.getAllByRole("spinbutton");
    fireEvent.change(inputs[11], { target: { value: "150" } }); // text size, %
    expect(useEditor.getState().options.text_font_scale).toBe(1.5);
  });

  it("Straighten button snaps a skewed bars quad to a rectangle and commits", () => {
    useEditor.setState({ corners: [[20, 10], [100, 15], [95, 60], [15, 55]] });
    render(<AdjustPanel onConfirm={() => {}} isPending={false} />);
    fireEvent.click(screen.getAllByRole("button", { name: /straighten/i })[0]);

    const [tl, tr, br, bl] = useEditor.getState().corners!;
    const topLen = Math.hypot(tr[0] - tl[0], tr[1] - tl[1]);
    const leftLen = Math.hypot(bl[0] - tl[0], bl[1] - tl[1]);
    const topVec = [tr[0] - tl[0], tr[1] - tl[1]];
    const leftVec = [bl[0] - tl[0], bl[1] - tl[1]];
    expect(topVec[0] * leftVec[0] + topVec[1] * leftVec[1]).toBeCloseTo(0, 3); // right angle
    expect(topLen).toBeGreaterThan(0);
    expect(leftLen).toBeGreaterThan(0);
    expect(useEditor.getState().history).toHaveLength(1);
  });

  it("only one Straighten button shows when separate text placement is off", () => {
    render(<AdjustPanel onConfirm={() => {}} isPending={false} />);
    expect(screen.getAllByRole("button", { name: /straighten/i })).toHaveLength(1);
  });
});
