import { useState } from "react";
import { expect, test } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

import { FontCombobox } from "./components/FontCombobox";

// Unlike Combobox, the value here is free text — a face the availability probe never listed, or a
// whole stack — so what is typed has to survive closing the list, and the suggestions are only
// suggestions. Clearing back to the fallback is a row rather than an empty field, since an empty
// field reads as "nothing" when it actually means "whatever the theme brings".
function open(initial = "") {
  function Harness() {
    const [v, setV] = useState(initial);
    return (
      <FontCombobox
        label="Code font"
        value={v}
        fallback="Monaspace Neon"
        fallbackLabel="Theme default"
        bundled={["Monaspace Neon", "JetBrains Mono"]}
        installed={["Fira Code"]}
        fallbackVar="--mono-fallback"
        sample="0O1lI"
        onChange={setV}
      />
    );
  }
  render(<Harness />);
  const input = screen.getByRole("combobox") as HTMLInputElement;
  fireEvent.click(input);
  return input;
}

test("the list offers the fallback as a row, each face drawn in itself", () => {
  open();
  expect(screen.getByText("Theme default")).toBeTruthy();
  // Where a face came from is the list's way of saying it is not the limit of what can be typed.
  expect(screen.getByText("Bundled")).toBeTruthy();
  expect(screen.getByText("On this machine")).toBeTruthy();
  expect(screen.getByText(/type its name/)).toBeTruthy();
  const jetbrains = screen.getByText("JetBrains Mono");
  expect(jetbrains.style.fontFamily).toBe('"JetBrains Mono", var(--mono-fallback)');
  expect(screen.getAllByText("0O1lI").length).toBe(3);
});

test("picking a face sets it, and the fallback row clears back to inheriting", () => {
  const input = open();
  fireEvent.mouseDown(screen.getByText("Fira Code"));
  expect(input.value).toBe("Fira Code");

  fireEvent.click(input);
  fireEvent.mouseDown(screen.getByText("Theme default"));
  expect(input.value).toBe("");
  expect(input.placeholder).toBe("Monaspace Neon");
});

test("typing filters, drops the clear row, and survives closing the list", () => {
  const input = open();
  // Spacing is where font names go wrong, so the filter reads through it.
  fireEvent.change(input, { target: { value: "jet brains" } });
  expect(screen.getByText("JetBrains Mono")).toBeTruthy();

  fireEvent.change(input, { target: { value: "jet" } });
  expect(screen.queryByText("Theme default")).toBeNull();
  expect(screen.getByText("JetBrains Mono")).toBeTruthy();
  expect(screen.queryByText("Fira Code")).toBeNull();

  // A face the probe never listed is still a legitimate value; Escape must not take it back.
  fireEvent.change(input, { target: { value: "Berkeley Mono" } });
  fireEvent.keyDown(input, { key: "Escape" });
  expect(input.value).toBe("Berkeley Mono");
});

test("the keyboard walks the list and Enter takes the active row", () => {
  const input = open();
  fireEvent.keyDown(input, { key: "ArrowDown" });
  fireEvent.keyDown(input, { key: "ArrowDown" });
  fireEvent.keyDown(input, { key: "Enter" });
  expect(input.value).toBe("JetBrains Mono");
});
