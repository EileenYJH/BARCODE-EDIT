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
});
