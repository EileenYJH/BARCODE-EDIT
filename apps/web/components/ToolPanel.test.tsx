import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { useEditor } from "@/lib/store";
import { ToolPanel } from "./ToolPanel";

function reset() {
  useEditor.setState({
    retouching: true, tool: "brush", activeLayer: "retouch",
    brushSize: 12, brushColor: "#000000", brushOpacity: 1,
  });
}

describe("ToolPanel", () => {
  beforeEach(reset);

  it("renders nothing when not retouching", () => {
    useEditor.setState({ retouching: false });
    const { container } = render(<ToolPanel />);
    expect(container).toBeEmptyDOMElement();
  });

  it("clicking Eraser switches the tool and reveals the active-layer toggle", () => {
    render(<ToolPanel />);
    expect(screen.queryByRole("button", { name: /^retouch$/i })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /eraser/i }));
    expect(useEditor.getState().tool).toBe("eraser");
  });

  it("active-layer buttons update the store", () => {
    useEditor.setState({ tool: "eraser" });
    render(<ToolPanel />);
    fireEvent.click(screen.getByRole("button", { name: /^result$/i }));
    expect(useEditor.getState().activeLayer).toBe("result");
  });

  it("the color input is hidden when tool is eraser", () => {
    useEditor.setState({ tool: "eraser" });
    render(<ToolPanel />);
    expect(screen.queryByDisplayValue("#000000")).toBeNull();
  });

  it("changing the color input updates the store", () => {
    render(<ToolPanel />);
    const colorInput = screen.getByDisplayValue("#000000");
    fireEvent.change(colorInput, { target: { value: "#ff0000" } });
    expect(useEditor.getState().brushColor).toBe("#ff0000");
  });

  it("the opacity control is visible for the brush tool", () => {
    render(<ToolPanel />);
    expect(screen.getByText("Opacity")).toBeInTheDocument();
  });

  it("the opacity control is also visible for the eraser tool", () => {
    useEditor.setState({ tool: "eraser" });
    render(<ToolPanel />);
    expect(screen.getByText("Opacity")).toBeInTheDocument();
  });
});
