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
  headIsCurrent: boolean;
  // The base resolves to head, so the committed range is empty by construction.
  baseIsHead: boolean;
  side: Side;
  onSideChange: (v: Side) => void;
  loading: boolean;
  onReload: () => void;
}

// The diff's after end, as one three-valued control rather than the two dependent
// checkboxes ("uncommitted", then "unstaged" appearing beside it) this used to be:
// the three reachable combinations are exactly `Side`, which is what the diff, the
// comment anchors and the reviewed marks all already speak.
const SIDE_OPTIONS: { value: Side; label: string; title: string; disabled?: boolean }[] = [
  { value: "head", label: "Committed", title: "Only what's committed on the branch" },
  { value: "index", label: "Staged", title: "Committed, plus what you've staged" },
  {
    value: "worktree",
    label: "Working tree",
    title: "Committed, plus every edit on disk — staged, unstaged and untracked",
  },
];

// Committed is dimmed when the base resolves to head (`auto` on the main branch, or
// head picked as its own base): merge-base(head, head) is head, so the range is empty
// whatever the repo holds. `useReview` forces an uncommitted side in that case, so
// this dims the option the reviewer can no longer be on rather than the one they are.
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

// The review-scoped buttons.
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
  // Files the diff itself changes — never the synthetic cards App adds for files
  // opened only to comment on, since this is the number a reviewer compares
  // against their git client.
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

// Both ends of the comparison spelled out. The four controls can't say this between
// them — least of all whether a picked "from" commit's own changes are in the diff
// (they are, so the before side is that commit's parent) — and it's what a reviewer
// needs to reconcile this diff with what their git client shows.
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

// Same range, plus what the number does *not* count — the synthetic cards for files
// opened only to comment on, which a reviewer comparing counts would trip over.
function fileCountTitle(s: Selection, st: TopBarStatus): string {
  return `${compareTitle(s, st)}\nA file opened only to comment on isn't counted`;
}

// The top toolbar: repo/head/base pickers, the diff-view controls, reload, and the
// review-scoped actions (agent prompts / export / reset), plus the gear that opens
// Settings — where the theme, the shortcut list and the repo link live, since none
// of them is part of reviewing and the bar is short of room for the ones that are.
export function TopBar({ selection: s, actions, status }: Props) {
  return (
    <header className="topbar">
      <div className="topbar-side">
        <span className="logo">local-review</span>
      </div>
      {/* Everything that picks what to look at, as one wrapping cluster: the
          breadcrumb naming the refs, the two knobs that narrow the range, and the
          reload that re-runs it. Together they're the selection, so they wrap
          together — a narrow window folds them onto their own line rather than
          stranding the range's knobs behind the review's actions. */}
      <div className="topbar-center">
        {/* What's being compared, as one breadcrumb: the pickers carry their own
            values, so the labels this used to put in front of each ("repo", "head",
            "base") only said again what the value shows. The separators say the rest —
            `/` for the repo the branch lives in, `→` for the comparison — and each
            picker keeps its aria-label for anyone not reading the shape. */}
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
        {/* The range's two remaining knobs: where the diff starts, and which side its
            after end reads. Kept together, and apart from the breadcrumb above, because
            neither names a ref — they narrow the comparison the breadcrumb states. */}
        <div className="topbar-group">
          <label title="Start the diff at one of the branch's own commits — that commit's own changes are included, so picking the oldest one is the same as All.">
            from
            <Combobox
              ariaLabel="diff from"
              value={s.from}
              options={s.fromOptions}
              onChange={s.onFromChange}
              disabled={s.loading}
            />
          </label>
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
          {/* Spinning while it loads is what the "Loading…" label used to say: the
              button is disabled either way, and a dimmed icon alone wouldn't
              distinguish "running" from "nothing to reload". */}
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
            {/* The head sha and the side it reads were printed here too, and both are
                already on screen: the branch is in the breadcrumb, the side is the lit
                segment of its own toggle, and the sha only ever named the tip of the
                branch beside it. What no control can say is what the two ends resolve
                to — so that stays, as the count's title. */}
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
              {/* Icon-only, but still `danger`: .btn.danger outranks .btn-icon on the
                  color, so it stays red rather than muted like the reload and gear —
                  the one control here that destroys something shouldn't read as chrome. */}
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
