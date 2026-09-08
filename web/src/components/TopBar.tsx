import { Combobox, type ComboOption } from "./Combobox";
import { DiffStatBadge } from "./DiffStatBadge";
import { IconRefresh, IconSettings, IconTrash } from "./icons";
import { ViewToggle } from "./ViewToggle";
import type { DiffStat } from "../diffStats";
import type { Review, Side } from "../types";

// Repo/head/base pickers + the diff-view controls + reload.
export interface Selection {
  repo: string;
  repoOptions: ComboOption[];
  onRepoChange: (v: string) => void;
  head: string;
  headOptions: ComboOption[];
  onHeadChange: (v: string) => void;
  base: string;
  baseOptions: ComboOption[];
  onBaseChange: (v: string) => void;
  baseRelevant: boolean;
  from: string;
  fromOptions: ComboOption[];
  onFromChange: (v: string) => void;
  commitCount: number;
  headIsCurrent: boolean;
  // The base resolves to head, so the committed range is empty by construction.
  baseIsHead: boolean;
  side: Side;
  onSideChange: (v: Side) => void;
  loading: boolean;
  onReload: () => void;
}

// Only two or more own commits give the from picker a choice; a held pick stays live as the way back to All.
function fromRelevant(s: Selection): boolean {
  return s.commitCount > 1 || s.from !== "all";
}
function fromDisabledTitle(s: Selection): string | undefined {
  if (fromRelevant(s)) return undefined;
  return s.commitCount === 0
    ? "The branch has no commits of its own over the base, so there is nowhere to start from"
    : "The branch has one commit, so starting from it is the whole branch";
}

const SIDE_OPTIONS: { value: Side; label: string; title: string; disabled?: boolean }[] = [
  { value: "head", label: "Committed", title: "Only what's committed on the branch" },
  { value: "index", label: "Staged", title: "Committed, plus what you've staged" },
  {
    value: "worktree",
    label: "Working tree",
    title: "Committed, plus every edit on disk — staged, unstaged and untracked",
  },
];

// merge-base(head, head) is head, so Committed is empty by construction; useReview already
// forces an uncommitted side, so this dims the option the reviewer can no longer be on.
function sideOptions(s: Selection): typeof SIDE_OPTIONS {
  if (!s.baseIsHead) return SIDE_OPTIONS;
  return SIDE_OPTIONS.map((o) =>
    o.value === "head"
      ? {
          ...o,
          disabled: true,
          title: `${s.head} is its own base, so there are no committed changes to compare — pick a different base branch to review them`,
        }
      : o
  );
}

export interface TopBarActions {
  onShowPrompts: () => void;
  onShowExport: () => void;
  onReset: () => void;
  onShowSettings: () => void;
}

// Review status shown on the right (only when a review is open).
export interface TopBarStatus {
  review: Review | null;
  shortSha?: string;
  baseSha: string;
  // Files the diff itself changes, never the synthetic cards: this is the number compared with a git client.
  fileCount: number;
  stat: DiffStat;
  openCommentCount: number;
  canReset: boolean;
}

interface Props {
  selection: Selection;
  actions: TopBarActions;
  status: TopBarStatus;
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

// Both ends spelled out, since no control says what they resolve to — nor that a picked "from"
// commit's own changes are included (the before side is its parent).
function rangeLines(s: Selection, st: TopBarStatus): string {
  const sha = st.baseSha ? `${st.baseSha.slice(0, 7)} — ` : "";
  const from =
    s.from === "all"
      ? `${sha}the merge-base with ${s.base || "the main branch"}, so the diff is everything ${s.head} adds`
      : `${sha}the parent of ${s.from.slice(0, 7)}, so that commit's own changes are included`;
  const to =
    s.side === "worktree"
      ? "your working tree — staged and unstaged edits, plus untracked files"
      : s.side === "index"
        ? "the git index — staged changes only"
        : `${s.head}${st.shortSha ? ` at ${st.shortSha}` : ""}`;
  return `From: ${from}\nTo: ${to}`;
}

function compareTitle(s: Selection, st: TopBarStatus): string {
  return `${rangeLines(s, st)}\n${plural(st.fileCount, "file")} changed`;
}

// Same range, plus what the count excludes: the synthetic cards for files opened only to comment on.
function fileCountTitle(s: Selection, st: TopBarStatus): string {
  return `${compareTitle(s, st)}\nA file opened only to comment on isn't counted`;
}

// The top toolbar: the selection cluster, the review's readout and actions, and the settings gear.
export function TopBar({ selection: s, actions, status }: Props) {
  return (
    <header className="topbar">
      <div className="topbar-side">
        <span className="logo">local-review</span>
      </div>
      {/* The selection wraps as one cluster, so a narrow window folds it onto its own line. */}
      <div className="topbar-center">
        <div className="crumbs">
          <Combobox
            ariaLabel="repository"
            value={s.repo}
            options={s.repoOptions}
            onChange={s.onRepoChange}
            disabled={s.loading}
            emptyText="(none found)"
          />
          <span className="crumb-sep" aria-hidden="true">
            /
          </span>
          <Combobox
            ariaLabel="head branch"
            value={s.head}
            options={s.headOptions}
            onChange={s.onHeadChange}
            disabled={s.loading}
          />
          <span className="crumb-sep" aria-hidden="true">
            →
          </span>
          <Combobox
            ariaLabel="base branch"
            value={s.base}
            options={s.baseOptions}
            onChange={s.onBaseChange}
            disabled={s.loading || !s.baseRelevant}
          />
        </div>
        {/* The range as a phrase, "from … to …": neither knob names a ref, so it sits apart from the crumbs. */}
        <div className="topbar-group range">
          <span
            className="range-word"
            title="Start the diff at one of the branch's own commits — that commit's own changes are included, so picking the oldest one is the same as All."
          >
            from
          </span>
          <span title={fromDisabledTitle(s)}>
            <Combobox
              ariaLabel="diff from"
              value={s.from}
              options={s.fromOptions}
              onChange={s.onFromChange}
              disabled={s.loading || !fromRelevant(s)}
              rangePreview
            />
          </span>
          <span
            className="range-word"
            title="Where the diff ends: what's committed on the branch, or the index or working tree on top of it"
          >
            to
          </span>
          <span
            title={
              s.headIsCurrent
                ? undefined
                : "Staged and working-tree changes are only available when reviewing the branch you have checked out"
            }
          >
            <ViewToggle
              ariaLabel="diff side"
              value={s.side}
              options={sideOptions(s)}
              onChange={s.onSideChange}
              disabled={s.loading || !s.headIsCurrent}
            />
          </span>
          <button
            className={`btn btn-icon${s.loading ? " is-loading" : ""}`}
            onClick={s.onReload}
            disabled={s.loading || !s.repo || !s.head}
            title={s.loading ? "Loading…" : "Re-run the review to pick up new commits"}
            aria-label="Reload"
            aria-busy={s.loading}
          >
            <IconRefresh />
          </button>
        </div>
      </div>
      <div className="topbar-side topbar-side-end">
        {status.review && (
          <>
            {/* Only the count: the sha and side are already on screen; what the ends resolve to is its title. */}
            <div className="topbar-readout">
              <span title={fileCountTitle(s, status)}>{plural(status.fileCount, "file")}</span>
              <DiffStatBadge stat={status.stat} title="Lines added and removed in this diff" />
            </div>
            <div className="topbar-group">
              <button
                className="btn"
                onClick={actions.onShowPrompts}
                title="Copyable, editable prompts: hand a coding agent this review to address, or have an agent review the branch itself"
              >
                Agent prompts
              </button>
              <button
                className="btn"
                onClick={actions.onShowExport}
                title="Exports unresolved threads"
              >
                Export ({status.openCommentCount})
              </button>
              {/* `.btn.danger` outranks `.btn-icon` on color, so the destructive one stays red, not muted. */}
              <button
                className="btn btn-icon danger"
                onClick={actions.onReset}
                disabled={!status.canReset}
                title="Delete all comments, unmark all reviewed files, and clear the summary"
                aria-label="Reset review"
              >
                <IconTrash />
              </button>
            </div>
          </>
        )}
        <button
          className="btn btn-icon"
          onClick={actions.onShowSettings}
          title="Settings — theme, keyboard shortcuts (?)"
          aria-label="Settings"
        >
          <IconSettings />
        </button>
      </div>
    </header>
  );
}
