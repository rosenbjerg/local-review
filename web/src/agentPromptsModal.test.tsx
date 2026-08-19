import { beforeEach, expect, test } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

// The two prompts are edited, saved and reset independently, and a save is scoped to
// the repo — so the storage key, not just the on-screen text, is what these check.
import { AgentPromptsModal } from "./components/AgentPromptsModal";
import { AGENT_PROMPTS, renderPrompt } from "./prompts";
import { LS } from "./storage";

const vars = { origin: "http://x", reviewId: 7, headRef: "feat/x", baseRef: "main" };
const REPLY = AGENT_PROMPTS[0];
const REVIEW = AGENT_PROMPTS[1];

function open(repo = "repo-a") {
  render(<AgentPromptsModal repo={repo} vars={vars} onClose={() => {}} />);
}

function editor() {
  return screen.getByRole("textbox") as HTMLTextAreaElement;
}

function btn(name: string) {
  return screen.getByRole("button", { name }) as HTMLButtonElement;
}

function stored() {
  return JSON.parse(localStorage.getItem(LS.agentPromptsByRepo) ?? "{}");
}

beforeEach(() => localStorage.clear());

test("an unedited prompt has nothing to save and nothing to reset", () => {
  open();
  expect(editor().value).toBe(REPLY.template);
  expect(btn("Save").disabled).toBe(true);
  expect(btn("Reset").disabled).toBe(true);
  expect(screen.queryByText("Unsaved changes")).toBeNull();
});

test("save stores the draft under this repo and this prompt only", () => {
  open();
  fireEvent.change(editor(), { target: { value: "mine {{reviewId}}" } });
  expect(screen.getByText("Unsaved changes")).toBeTruthy();

  fireEvent.click(btn("Save"));
  expect(stored()).toEqual({ "repo-a": { reply: "mine {{reviewId}}" } });
  // Saved is the new baseline: nothing left to save, but it's now resettable.
  expect(screen.queryByText("Unsaved changes")).toBeNull();
  expect(btn("Save").disabled).toBe(true);
  expect(btn("Reset").disabled).toBe(false);

  // The other prompt is untouched — the toggle switches what's edited, not what's saved.
  fireEvent.click(btn(REVIEW.label));
  expect(editor().value).toBe(REVIEW.template);
  expect(btn("Reset").disabled).toBe(true);
});

test("a saved prompt is what reopening the modal shows, per repo", () => {
  localStorage.setItem(LS.agentPromptsByRepo, JSON.stringify({ "repo-a": { review: "custom" } }));

  open("repo-a");
  fireEvent.click(btn(REVIEW.label));
  expect(editor().value).toBe("custom");
});

test("another repo keeps the built-in template", () => {
  localStorage.setItem(LS.agentPromptsByRepo, JSON.stringify({ "repo-a": { review: "custom" } }));
  open("repo-b");
  fireEvent.click(btn(REVIEW.label));
  expect(editor().value).toBe(REVIEW.template);
});

test("reset drops the stored override and restores the built-in text", () => {
  localStorage.setItem(
    LS.agentPromptsByRepo,
    JSON.stringify({ "repo-a": { reply: "custom", review: "also custom" } })
  );
  open();
  expect(editor().value).toBe("custom");

  fireEvent.click(btn("Reset"));
  expect(editor().value).toBe(REPLY.template);
  expect(btn("Reset").disabled).toBe(true);
  // Only this kind is cleared; the sibling override survives.
  expect(stored()).toEqual({ "repo-a": { review: "also custom" } });
});

test("clearing the last override drops the repo's entry entirely", () => {
  localStorage.setItem(LS.agentPromptsByRepo, JSON.stringify({ "repo-a": { reply: "custom" } }));
  open();
  fireEvent.click(btn("Reset"));
  expect(stored()).toEqual({});
});

test("a blank prompt can't be saved", () => {
  open();
  fireEvent.change(editor(), { target: { value: "   " } });
  // Dirty, so the state is visible, but saving it would store a template that reads
  // back as absent — the editor refuses instead.
  expect(screen.getByText("Unsaved changes")).toBeTruthy();
  expect(btn("Save").disabled).toBe(true);
});

test("unsaved edits to one prompt survive a switch to the other", () => {
  open();
  fireEvent.change(editor(), { target: { value: "draft A" } });
  fireEvent.click(btn(REVIEW.label));
  fireEvent.change(editor(), { target: { value: "draft B" } });

  fireEvent.click(btn(REPLY.label));
  expect(editor().value).toBe("draft A");
  fireEvent.click(btn(REVIEW.label));
  expect(editor().value).toBe("draft B");
  expect(stored()).toEqual({});
});

test("copy renders the draft, including edits not saved yet", async () => {
  let copied = "";
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText: (t: string) => ((copied = t), Promise.resolve()) },
  });

  open();
  fireEvent.change(editor(), { target: { value: "review {{reviewId}} on {{headRef}}" } });
  fireEvent.click(btn("Copy"));
  await screen.findByRole("button", { name: "Copied ✓" });
  expect(copied).toBe("review 7 on feat/x");
  expect(copied).toBe(renderPrompt("review {{reviewId}} on {{headRef}}", vars));
});
