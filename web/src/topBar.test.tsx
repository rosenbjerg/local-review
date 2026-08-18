import { expect, test } from "vitest";
import { render, screen } from "@testing-library/react";

import { TopBar } from "./components/TopBar";
import type { Selection, TopBarStatus } from "./components/TopBar";
import type { Review } from "./types";

// The "from" picker used to leave a reviewer guessing whether the picked commit's
// own changes were in the diff, and the file count had nothing to explain itself
// against — so the readout's wording is the fix and worth pinning.

const selection: Selection = {
  repo: "proj",
  repoOptions: [],
  onRepoChange: () => {},
  head: "feature",
  headOptions: [],
  onHeadChange: () => {},
  base: "main",
  baseOptions: [],
  onBaseChange: () => {},
  baseRelevant: true,
  from: "all",
  fromOptions: [],
  onFromChange: () => {},
  headIsCurrent: true,
  uncommitted: false,
  onUncommittedChange: () => {},
  unstaged: true,
  onUnstagedChange: () => {},
  loading: false,
  onReload: () => {},
};

const review = { id: 1, headRef: "feature", headSha: "9f8e7d6c" } as Review;

const status: TopBarStatus = {
  review,
  shortSha: "9f8e7d6",
  baseSha: "1a2b3c4d5e",
  fileCount: 5,
  stat: { added: 10, removed: 2 },
  openCommentCount: 0,
  canReset: false,
};

const actions = {
  onShowPrompts: () => {},
  onShowExport: () => {},
  onReset: () => {},
  onShowHelp: () => {},
};

function titleOf(text: string): string {
  return screen.getByText(text).getAttribute("title") ?? "";
}

test("the whole-branch view names the merge-base and counts the changed files", () => {
  render(<TopBar selection={selection} actions={actions} status={status} />);

  const title = titleOf("5 files");
  expect(title).toContain("1a2b3c4");
  expect(title).toContain("the merge-base with main");
  expect(title).toContain("feature at 9f8e7d6");
  expect(title).toContain("5 files changed");
  // The denominator difference a reviewer would otherwise trip over.
  expect(title).toContain("opened only to comment on isn't counted");
});

test("a picked commit reads as inclusive, against its parent", () => {
  render(
    <TopBar
      selection={{ ...selection, from: "abc1234def" }}
      actions={actions}
      status={status}
    />
  );

  expect(screen.getByText(/from abc1234/)).toBeTruthy();
  const title = titleOf("5 files");
  expect(title).toContain("the parent of abc1234");
  expect(title).toContain("own changes are included");
});

test("the uncommitted axes name the side they read", () => {
  const { rerender } = render(
    <TopBar
      selection={{ ...selection, uncommitted: true, unstaged: true }}
      actions={actions}
      status={status}
    />
  );
  expect(titleOf("5 files")).toContain("your working tree");

  rerender(
    <TopBar
      selection={{ ...selection, uncommitted: true, unstaged: false }}
      actions={actions}
      status={status}
    />
  );
  expect(titleOf("5 files")).toContain("the git index");
});
