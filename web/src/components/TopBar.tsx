import { Combobox, type ComboOption } from "./Combobox";
import { DiffStatBadge } from "./DiffStatBadge";
import type { DiffStat } from "../diffStats";
import type { Review } from "../types";

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
  uncommitted: boolean;
  onUncommittedChange: (v: boolean) => void;
  unstaged: boolean;
  onUnstagedChange: (v: boolean) => void;
  loading: boolean;
  onReload: () => void;
}

// The review-scoped buttons.
export interface TopBarActions {
  onShowPrompts: () => void;
  onShowExport: () => void;
  onReset: () => void;
  onShowHelp: () => void;
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

// A compact indicator of a non-default view, shown next to the sha. Keep it terse —
// just the short sha for a picked "from", not the full "sha  subject" option label.
// "from", not "since": the picked commit's own changes are part of the diff.
function viewLabel(s: Selection): string {
  const parts: string[] = [];
  if (s.from !== "all") parts.push(`from ${s.from.slice(0, 7)}`);
  if (s.uncommitted && s.headIsCurrent) parts.push(s.unstaged ? "uncommitted" : "staged");
  return parts.join(" · ");
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
    s.uncommitted && s.headIsCurrent
      ? s.unstaged
        ? "your working tree — staged and unstaged edits, plus untracked files"
        : "the git index — staged changes only"
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
// review-scoped actions (agent prompts / export / reset) plus help & repo links.
export function TopBar({ selection: s, actions, status }: Props) {
  return (
    <header className="topbar">
      <span className="logo">local-review</span>
      <label>
        repo
        <Combobox
          ariaLabel="repository"
          value={s.repo}
          options={s.repoOptions}
          onChange={s.onRepoChange}
          disabled={s.loading}
          emptyText="(none found)"
        />
      </label>
      <label>
        head
        <Combobox
          ariaLabel="head branch"
          value={s.head}
          options={s.headOptions}
          onChange={s.onHeadChange}
          disabled={s.loading}
        />
      </label>
      <span className="arrow">→</span>
      <label>
        base
        <Combobox
          ariaLabel="base branch"
          value={s.base}
          options={s.baseOptions}
          onChange={s.onBaseChange}
          disabled={s.loading || !s.baseRelevant}
        />
      </label>
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
      <label
        className="checkbox"
        title={
          s.headIsCurrent
            ? "Include uncommitted changes (working tree / index) on top of the selected range"
            : "Only available when reviewing the branch you have checked out"
        }
      >
        <input
          type="checkbox"
          checked={s.uncommitted && s.headIsCurrent}
          onChange={(e) => s.onUncommittedChange(e.target.checked)}
          disabled={s.loading || !s.headIsCurrent}
        />
        uncommitted
      </label>
      {s.uncommitted && s.headIsCurrent && (
        <label className="checkbox" title="Include unstaged edits; uncheck to show only staged changes">
          <input
            type="checkbox"
            checked={s.unstaged}
            onChange={(e) => s.onUnstagedChange(e.target.checked)}
            disabled={s.loading}
          />
          unstaged
        </label>
      )}
      <button
        className="btn"
        onClick={s.onReload}
        disabled={s.loading || !s.repo || !s.head}
        title="Re-run the review to pick up new commits"
      >
        {s.loading ? "Loading…" : "Reload"}
      </button>
      <span className="spacer" />
      {status.review && (
        <>
          <span className="muted" title={compareTitle(s, status)}>
            {status.shortSha}
            {viewLabel(s) && ` · ${viewLabel(s)}`}
          </span>
          <span className="muted" title={fileCountTitle(s, status)}>
            {plural(status.fileCount, "file")}
          </span>
          <DiffStatBadge stat={status.stat} title="Lines added and removed in this diff" />
          <button
            className="btn"
            onClick={actions.onShowPrompts}
            title="Copyable prompts: hand a coding agent this review to address, or have an agent review the branch itself"
          >
            Agent prompts
          </button>
          <button className="btn" onClick={actions.onShowExport} title="Exports unresolved threads">
            Export ({status.openCommentCount})
          </button>
          <button
            className="btn danger"
            onClick={actions.onReset}
            disabled={!status.canReset}
            title="Delete all comments, unmark all reviewed files, and clear the summary"
          >
            Reset
          </button>
        </>
      )}
      <button
        className="btn btn-icon"
        onClick={actions.onShowHelp}
        title="Keyboard shortcuts (?)"
        aria-label="Keyboard shortcuts"
      >
        ?
      </button>
      <a
        className="btn btn-icon"
        href="https://github.com/rosenbjerg/local-review"
        target="_blank"
        rel="noopener noreferrer"
        title="View local-review on GitHub"
        aria-label="View local-review on GitHub"
      >
        <svg aria-hidden="true" viewBox="0 0 24 24" width="18" height="18" fill="currentColor">
          <path d="M10.226 17.284c-2.965-.36-5.054-2.493-5.054-5.256 0-1.123.404-2.336 1.078-3.144-.292-.741-.247-2.314.09-2.965.898-.112 2.111.36 2.83 1.01.853-.269 1.752-.404 2.853-.404 1.1 0 1.999.135 2.807.382.696-.629 1.932-1.1 2.83-.988.315.606.36 2.179.067 2.942.72.854 1.101 2 1.101 3.167 0 2.763-2.089 4.852-5.098 5.234.763.494 1.28 1.572 1.28 2.807v2.336c0 .674.561 1.056 1.235.786 4.066-1.55 7.255-5.615 7.255-10.646C23.5 6.188 18.334 1 11.978 1 5.62 1 .5 6.188.5 12.545c0 4.986 3.167 9.12 7.435 10.669.606.225 1.19-.18 1.19-.786V20.63a2.9 2.9 0 0 1-1.078.224c-1.483 0-2.359-.808-2.987-2.313-.247-.607-.517-.966-1.034-1.033-.27-.023-.359-.135-.359-.27 0-.27.45-.471.898-.471.652 0 1.213.404 1.797 1.235.45.651.921.943 1.483.943.561 0 .92-.202 1.437-.719.382-.381.674-.718.944-.943"></path>
        </svg>
      </a>
    </header>
  );
}
