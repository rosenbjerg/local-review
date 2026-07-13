import { Combobox, type ComboOption } from "./Combobox";
import type { Review } from "../types";

interface Props {
  repo: string;
  repoOptions: ComboOption[];
  onRepoChange: (v: string) => void;
  head: string;
  headOptions: ComboOption[];
  onHeadChange: (v: string) => void;
  base: string;
  baseOptions: ComboOption[];
  onBaseChange: (v: string) => void;
  headIsCurrent: boolean;
  uncommitted: boolean;
  onUncommittedChange: (v: boolean) => void;
  loading: boolean;
  onReload: () => void;
  review: Review | null;
  shortSha?: string;
  effectiveUncommitted: boolean;
  openCommentCount: number;
  canReset: boolean;
  onShowPrompts: () => void;
  onShowExport: () => void;
  onReset: () => void;
  onShowHelp: () => void;
}

// The top toolbar: repo/head/base pickers, the uncommitted toggle, reload, and the
// review-scoped actions (agent prompts / export / reset) plus help & repo links.
export function TopBar({
  repo,
  repoOptions,
  onRepoChange,
  head,
  headOptions,
  onHeadChange,
  base,
  baseOptions,
  onBaseChange,
  headIsCurrent,
  uncommitted,
  onUncommittedChange,
  loading,
  onReload,
  review,
  shortSha,
  effectiveUncommitted,
  openCommentCount,
  canReset,
  onShowPrompts,
  onShowExport,
  onReset,
  onShowHelp,
}: Props) {
  return (
    <header className="topbar">
      <span className="logo">local-review</span>
      <label>
        repo
        <Combobox
          ariaLabel="repository"
          value={repo}
          options={repoOptions}
          onChange={onRepoChange}
          disabled={loading}
          emptyText="(none found)"
        />
      </label>
      <label>
        head
        <Combobox
          ariaLabel="head branch"
          value={head}
          options={headOptions}
          onChange={onHeadChange}
          disabled={loading}
        />
      </label>
      <span className="arrow">→</span>
      <label>
        base
        <Combobox
          ariaLabel="base branch"
          value={base}
          options={baseOptions}
          onChange={onBaseChange}
          disabled={loading}
        />
      </label>
      {headIsCurrent && (
        <label className="checkbox" title="Diff against the working tree instead of the head commit (staged + unstaged tracked changes; excludes untracked files)">
          <input
            type="checkbox"
            checked={uncommitted}
            onChange={(e) => onUncommittedChange(e.target.checked)}
            disabled={loading}
          />
          uncommitted
        </label>
      )}
      <button
        className="btn"
        onClick={onReload}
        disabled={loading || !repo || !head}
        title="Re-run the review to pick up new commits"
      >
        {loading ? "Loading…" : "Reload"}
      </button>
      <span className="spacer" />
      {review && (
        <>
          <span className="muted">
            {shortSha}
            {effectiveUncommitted && " + uncommitted"}
          </span>
          <button
            className="btn"
            onClick={onShowPrompts}
            title="Copyable prompts: hand a coding agent this review to address, or have an agent review the branch itself"
          >
            Agent prompts
          </button>
          <button className="btn" onClick={onShowExport} title="Exports unresolved threads">
            Export ({openCommentCount})
          </button>
          <button
            className="btn danger"
            onClick={onReset}
            disabled={!canReset}
            title="Delete all comments and unmark all reviewed files"
          >
            Reset
          </button>
        </>
      )}
      <button
        className="btn btn-icon"
        onClick={onShowHelp}
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
