import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { useEditor } from "@/lib/store";
import { HistoryControls } from "./HistoryControls";

function reset() {
  useEditor.setState({ value: "", history: [], historyIndex: -1 });
}

describe("HistoryControls", () => {
  beforeEach(reset);

  it("Undo and Redo are disabled with no history", () => {
    render(<HistoryControls />);
    expect(screen.getByRole("button", { name: /undo/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /redo/i })).toBeDisabled();
  });

  it("clicking Undo calls the store's undo", () => {
    useEditor.getState().setField("value", "A");
    useEditor.getState().commit();
    useEditor.getState().setField("value", "B");
    useEditor.getState().commit();
    render(<HistoryControls />);
    fireEvent.click(screen.getByRole("button", { name: /undo/i }));
    expect(useEditor.getState().value).toBe("A");
  });

  it("Ctrl+Z triggers undo and Ctrl+Shift+Z triggers redo", () => {
    useEditor.getState().setField("value", "A");
    useEditor.getState().commit();
    useEditor.getState().setField("value", "B");
    useEditor.getState().commit();
    render(<HistoryControls />);

    fireEvent.keyDown(window, { key: "z", ctrlKey: true });
    expect(useEditor.getState().value).toBe("A");

    fireEvent.keyDown(window, { key: "z", ctrlKey: true, shiftKey: true });
    expect(useEditor.getState().value).toBe("B");
  });
});
