import { afterEach, expect, test, vi } from "vitest";
import { fireEvent, renderHook } from "@testing-library/react";

// The guard that decides whether a keypress is the app's or the surface's own. An
// open composer holds focusable controls (type pills, Cancel/Submit), so the bail
// has to cover its whole subtree — not just fields — or a stray `v`/`e` would act
// on the review while the reviewer is mid-comment.
import { useKeyboardShortcuts, type Shortcuts } from "./useKeyboardShortcuts";

function setup() {
  const handlers = {
    onNextFile: vi.fn(),
    onPrevFile: vi.fn(),
    onNextComment: vi.fn(),
    onPrevComment: vi.fn(),
    onExport: vi.fn(),
    onReload: vi.fn(),
    onMarkReviewed: vi.fn(),
    onOpenSettings: vi.fn(),
    onCloseSettings: vi.fn(),
    onFocusSearch: vi.fn(),
    onToggleFilesPane: vi.fn(),
    onToggleCommentsPane: vi.fn(),
    onNextMatch: vi.fn(),
    onPrevMatch: vi.fn(),
    onDismissHighlight: vi.fn(),
  };
  const opts: Shortcuts = {
    enabled: true,
    modalOpen: false,
    settingsOpen: false,
    loading: false,
    hasHighlight: false,
    ...handlers,
  };
  renderHook(() => useKeyboardShortcuts(opts));
  return handlers;
}

/** A target in the document, since a detached node's event never reaches window. */
function target(html: string) {
  const host = document.createElement("div");
  host.innerHTML = html;
  document.body.append(host);
  return host.querySelector("button")!;
}

afterEach(() => {
  document.body.innerHTML = "";
});

test("a control inside an open composer swallows the shortcut", () => {
  const h = setup();
  const inComposer = target(`<div class="composer"><button data-type="bug">bug</button></div>`);

  fireEvent.keyDown(inComposer, { key: "v" });
  fireEvent.keyDown(inComposer, { key: "e" });
  fireEvent.keyDown(inComposer, { key: "j" });
  expect(h.onMarkReviewed).not.toHaveBeenCalled();
  expect(h.onExport).not.toHaveBeenCalled();
  expect(h.onNextFile).not.toHaveBeenCalled();
});

test("a button outside the composer still fires them", () => {
  const h = setup();
  const elsewhere = target(`<div class="file-header"><button>Reply</button></div>`);

  fireEvent.keyDown(elsewhere, { key: "v" });
  expect(h.onMarkReviewed).toHaveBeenCalled();
});

// The pane toggles are ordinary single-key shortcuts, so they have to obey the
// same bail as the rest — a `]` typed into a comment is a bracket, not a command.
test("[ and ] toggle the panes, and not from inside a composer", () => {
  const h = setup();
  const elsewhere = target(`<div class="file-header"><button>Reply</button></div>`);
  const inComposer = target(`<div class="composer"><button>Cancel</button></div>`);

  fireEvent.keyDown(elsewhere, { key: "[" });
  fireEvent.keyDown(elsewhere, { key: "]" });
  expect(h.onToggleFilesPane).toHaveBeenCalledTimes(1);
  expect(h.onToggleCommentsPane).toHaveBeenCalledTimes(1);

  fireEvent.keyDown(inComposer, { key: "[" });
  fireEvent.keyDown(inComposer, { key: "]" });
  expect(h.onToggleFilesPane).toHaveBeenCalledTimes(1);
  expect(h.onToggleCommentsPane).toHaveBeenCalledTimes(1);
});
