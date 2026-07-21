import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { useEditor } from "@/lib/store";
import { BarcodeSettings } from "./BarcodeSettings";

function reset() {
  useEditor.setState({
    symbology: "code128", value: "",
    options: { show_text: true, quiet_zone: 6.5, module_width: 0.2, module_height: 15 },
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
    fireEvent.click(screen.getByRole("switch"));
    expect(useEditor.getState().history).toHaveLength(1);
  });
});
