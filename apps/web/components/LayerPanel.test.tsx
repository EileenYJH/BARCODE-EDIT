import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { useEditor } from "@/lib/store";
import { LayerPanel } from "./LayerPanel";

function reset() {
  useEditor.setState({
    result: { result: "x", svg: "<svg/>", layers: { original: "a", new_barcode: "b", mask: "c" } },
    layers: {
      original: { visible: true, opacity: 1 },
      new_barcode: { visible: true, opacity: 1 },
      result: { visible: true, opacity: 1 },
    },
    history: [], historyIndex: -1,
  });
}

describe("LayerPanel history commits", () => {
  beforeEach(reset);

  it("commits when a layer's visibility is toggled", () => {
    render(<LayerPanel />);
    const switches = screen.getAllByRole("switch");
    fireEvent.click(switches[0]);
    expect(useEditor.getState().history).toHaveLength(1);
  });
});
