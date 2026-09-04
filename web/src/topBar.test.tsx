import { afterEach, expect, test } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

import { TopBar } from "./components/TopBar";
import type { Selection, TopBarStatus } from "./components/TopBar";
import type { Review } from "./types";
import { DEFAULT_PREF, setThemePref } from "./theme";

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
  baseIsHead: false,
  side: "head",
  onSideChange: () => {},
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

test("the side control names the side it reads", () => {
  const { rerender } = render(
    <TopBar selection={{ ...selection, side: "worktree" }} actions={actions} status={status} />
  );
  expect(titleOf("5 files")).toContain("your working tree");

  rerender(
    <TopBar selection={{ ...selection, side: "index" }} actions={actions} status={status} />
  );
  expect(titleOf("5 files")).toContain("the git index");
});

// The three reachable states used to be two dependent checkboxes, the second only
// appearing once the first was on. As one control they're one click apart, and the
// value it reports is the `Side` the rest of the app already speaks — so what each
// segment maps to is worth pinning.
test("each segment picks its side, and the group is one control", () => {
  const picked: string[] = [];
  render(
    <TopBar
      selection={{ ...selection, side: "head", onSideChange: (v) => picked.push(v) }}
      actions={actions}
      status={status}
    />
  );
  const group = screen.getByRole("group", { name: "diff side" });
  expect(screen.getByText("Committed").getAttribute("aria-pressed")).toBe("true");

  fireEvent.click(screen.getByText("Staged"));
  fireEvent.click(screen.getByText("Working tree"));
  fireEvent.click(screen.getByText("Committed"));
  expect(picked).toEqual(["index", "worktree", "head"]);
  expect(group.querySelectorAll("button")).toHaveLength(3);
});

// Off the checked-out branch there is no working tree or index to read, so the whole
// group is disabled rather than the two unreachable segments — a partly-live group
// would still present them as a choice.
test("the side control is disabled off the checked-out branch", () => {
  render(
    <TopBar
      selection={{ ...selection, headIsCurrent: false }}
      actions={actions}
      status={status}
    />
  );
  for (const label of ["Committed", "Staged", "Working tree"]) {
    expect((screen.getByText(label) as HTMLButtonElement).disabled).toBe(true);
  }
});

// The one segment that may be dimmed on its own: when the base resolves to head the
// committed range is empty whatever the repo holds, while the other two still read
// something. It carries a title, since a dimmed control with no explanation reads as
// a bug — and `useReview` has already moved the value off it.
test("Committed is dimmed, with a reason, when the base resolves to head", () => {
  render(
    <TopBar
      selection={{ ...selection, baseIsHead: true, side: "worktree" }}
      actions={actions}
      status={status}
    />
  );
  const committed = screen.getByText("Committed") as HTMLButtonElement;
  expect(committed.disabled).toBe(true);
  expect(committed.getAttribute("title")).toContain("feature is its own base");
  expect((screen.getByText("Working tree") as HTMLButtonElement).disabled).toBe(false);
  expect((screen.getByText("Staged") as HTMLButtonElement).disabled).toBe(false);
});

afterEach(() => setThemePref(DEFAULT_PREF));

// The picker isn't review state: it reads and writes the theme store directly, and
// the store moves <html data-theme>, which is what the token blocks key on. It shows
// the stored preference — System by default, which resolves dark under jsdom — so
// following the OS stays visibly selected rather than showing as the theme it landed on.
test("the theme picker shows the stored preference and switches it", () => {
  render(<TopBar selection={selection} actions={actions} status={status} />);
  const picker = screen.getByLabelText("Theme") as HTMLSelectElement;
  expect(picker.value).toBe("system");
  expect(document.documentElement.dataset.theme).toBe("github-dark");

  fireEvent.change(picker, { target: { value: "github-light" } });
  expect(picker.value).toBe("github-light");
  expect(document.documentElement.dataset.theme).toBe("github-light");
});
