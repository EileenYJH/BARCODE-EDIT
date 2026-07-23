import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { useEditor } from "@/lib/store";
import { BarcodeSettings } from "./BarcodeSettings";

function reset() {
  useEditor.setState({
    symbology: "code128", value: "",
    options: { show_text: true, quiet_zone: 6.5, module_width: 0.2, module_height: 15, text_font_scale: 1 },
    corners: [[0, 0], [200, 0], [200, 50], [0, 50]],
    textCorners: null,
    separateTextPlacement: false,
    history: [], historyIndex: -1,
  });
}

describe("BarcodeSettings history commits", () => {
  beforeEach(reset);

  it("commits once when the value input is blurred", () => {
    render(<BarcodeSettings />);
    const input = screen.getByPlaceholderText(/5901234123457/i);
    fireEvent.change(input, { target: { value: "HELLO" } });
    expect(useEditor.getState().history).toHaveLength(0); // no commit on keystroke
    fireEvent.blur(input);
    expect(useEditor.getState().history).toHaveLength(1);
  });

  it("commits when show_text is toggled", () => {
    render(<BarcodeSettings />);
    fireEvent.click(screen.getAllByRole("switch")[0]);
    expect(useEditor.getState().history).toHaveLength(1);
  });

  it("shows the separate text placement toggle only when show_text is on and symbology is not qr", () => {
    render(<BarcodeSettings />);
    expect(screen.getByText(/separate text placement/i)).toBeInTheDocument();

    act(() => {
      useEditor.getState().setOption("show_text", false);
    });
    expect(screen.queryByText(/separate text placement/i)).toBeNull();
  });

  it("commits when separate text placement is toggled", () => {
    render(<BarcodeSettings />);
    const switches = screen.getAllByRole("switch");
    fireEvent.click(switches[1]); // [0] is "Show text", [1] is "Separate text placement"
    expect(useEditor.getState().history).toHaveLength(1);
    expect(useEditor.getState().separateTextPlacement).toBe(true);
  });
});
