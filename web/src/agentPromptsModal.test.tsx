import { beforeEach, expect, test } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

// Every prompt is edited, saved and reset independently, and a save is scoped to the
// repo — so the storage key, not just the on-screen text, is what these check. The
// two rows have different jobs: the first picks the group, the second the review
// focus within it, and only the second decides which author the copy files under.
import { AgentPromptsModal } from "./components/AgentPromptsModal";
import { AGENT_PROMPTS, renderPrompt } from "./prompts";
import type { PromptKind } from "./prompts";
import { LS } from "./storage";

const vars = { origin: "http://x", reviewId: 7, headRef: "feat/x", baseRef: "main" };

function prompt(kind: PromptKind) {
  return AGENT_PROMPTS.find((p) => p.kind === kind) ?? AGENT_PROMPTS[0];
}

const REPLY = prompt("reply");
const CORRECTNESS = prompt("review");
const SECURITY = prompt("review:security");
const DESIGN = prompt("review:design");

const REVIEW_GROUP = "Do a review";
const REPLY_GROUP = "Address the review";

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

test("the focus row appears only for the group that has focuses", () => {
  open();
  // One prompt in the reply group: a toggle with a single option would be furniture.
  expect(screen.queryByRole("group", { name: "Review focus" })).toBeNull();

  fireEvent.click(btn(REVIEW_GROUP));
  expect(screen.getByRole("group", { name: "Review focus" })).toBeTruthy();
  expect(editor().value).toBe(CORRECTNESS.template);
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

  // The other prompts are untouched — the toggles switch what's edited, not what's saved.
  fireEvent.click(btn(REVIEW_GROUP));
  expect(editor().value).toBe(CORRECTNESS.template);
  expect(btn("Reset").disabled).toBe(true);
});

test("each review focus saves under its own key", () => {
  // The focuses share a group and a row, but not a stored template: editing the
  // security brief must not touch the correctness one.
  open();
  fireEvent.click(btn(REVIEW_GROUP));
  fireEvent.click(btn(SECURITY.label));
  fireEvent.change(editor(), { target: { value: "sec draft" } });
  fireEvent.click(btn("Save"));

  expect(stored()).toEqual({ "repo-a": { "review:security": "sec draft" } });
  fireEvent.click(btn(CORRECTNESS.label));
  expect(editor().value).toBe(CORRECTNESS.template);
  expect(btn("Reset").disabled).toBe(true);
});

test("correctness still reads the original `review` key", () => {
  // Its label and author changed when the focuses landed; its storage key deliberately
  // did not, so a template saved before that still resolves.
  localStorage.setItem(LS.agentPromptsByRepo, JSON.stringify({ "repo-a": { review: "custom" } }));
  open("repo-a");
  fireEvent.click(btn(REVIEW_GROUP));
  expect(editor().value).toBe("custom");
});

test("another repo keeps the built-in template", () => {
  localStorage.setItem(LS.agentPromptsByRepo, JSON.stringify({ "repo-a": { review: "custom" } }));
  open("repo-b");
  fireEvent.click(btn(REVIEW_GROUP));
  expect(editor().value).toBe(CORRECTNESS.template);
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

test("unsaved edits to one prompt survive a switch to another", () => {
  open();
  fireEvent.change(editor(), { target: { value: "draft A" } });
  fireEvent.click(btn(REVIEW_GROUP));
  fireEvent.change(editor(), { target: { value: "draft B" } });
  fireEvent.click(btn(DESIGN.label));
  fireEvent.change(editor(), { target: { value: "draft C" } });

  fireEvent.click(btn(REPLY_GROUP));
  expect(editor().value).toBe("draft A");
  fireEvent.click(btn(REVIEW_GROUP));
  // Back to the focus that was open, not to the group's first one.
  expect(editor().value).toBe("draft C");
  fireEvent.click(btn(CORRECTNESS.label));
  expect(editor().value).toBe("draft B");
  expect(stored()).toEqual({});
});

test("copy renders the draft under the selected focus's author", async () => {
  let copied = "";
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText: (t: string) => ((copied = t), Promise.resolve()) },
  });

  open();
  fireEvent.click(btn(REVIEW_GROUP));
  fireEvent.click(btn(SECURITY.label));
  // The author is the one placeholder that comes from the prompt rather than the
  // review, so it's the one a wrong merge would silently blank.
  expect(screen.getByText(SECURITY.author)).toBeTruthy();

  fireEvent.change(editor(), { target: { value: "review {{reviewId}} as {{author}}" } });
  fireEvent.click(btn("Copy"));
  await screen.findByRole("button", { name: "Copied ✓" });
  expect(copied).toBe(`review 7 as ${SECURITY.author}`);
  expect(copied).toBe(
    renderPrompt("review {{reviewId}} as {{author}}", { ...vars, author: SECURITY.author })
  );
});
