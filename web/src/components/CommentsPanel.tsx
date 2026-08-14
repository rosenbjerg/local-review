import type { CommentFilter, TypeFilter } from "../commentFilter";
import { ANY, NO_FILTER, STATUS_FILTERS, TYPE_FILTERS, isFiltered } from "../commentFilter";
import type { CommentSort } from "../commentSort";
import { COMMENT_SORTS, sortTimestamp } from "../commentSort";
import { turnOf } from "../commentTurn";
import type { Comment } from "../types";
import { effectivePath } from "../types";
import { CommentPreview } from "./CommentPreview";

interface Props {
  // Already filtered and sorted — the same list the n/p shortcuts step through.
  comments: Comment[];
  total: number;
  // Threads awaiting the reviewer across the whole review — not just the filtered
  // list, so narrowing on another axis can't read as "nothing left to do".
  awaitingYou: number;
  sort: CommentSort;
  onSortChange: (sort: CommentSort) => void;
  filter: CommentFilter;
  onFilterChange: (filter: CommentFilter) => void;
  authors: string[];
  onJump: (id: number) => void;
  onDelete: (id: number) => void;
}

// `comments` arrives sorted (see commentSort.sortComments), which keeps each
// file's comments contiguous — so the groups are just runs of one path.
function fileRuns(comments: Comment[]): { path: string; items: Comment[] }[] {
  const runs: { path: string; items: Comment[] }[] = [];
  for (const c of comments) {
    const path = effectivePath(c);
    const last = runs[runs.length - 1];
    if (last && last.path === path) last.items.push(c);
    else runs.push({ path, items: [c] });
  }
  return runs;
}

export function CommentsPanel({
  comments,
  total,
  awaitingYou,
  sort,
  onSortChange,
  filter,
  onFilterChange,
  authors,
  onJump,
  onDelete,
}: Props) {
  const narrowed = isFiltered(filter);
  // A filtered-on author whose last thread just went away still needs its option,
  // or the select would sit blank on a filter that is quietly hiding everything.
  const authorOptions =
    filter.author === ANY || authors.includes(filter.author) ? authors : [...authors, filter.author];
  const awaitingFilter = filter.status === "awaiting-you";
  return (
    <div className="comments-panel">
      <div className="comments-panel-header">
        <div className="comments-title">
          <h2>
            Comments{" "}
            <span className="muted">({narrowed ? `${comments.length} of ${total}` : total})</span>
          </h2>
          {/* The count doubles as the filter for what it counts. It stays while
              that filter is on even at zero, so answering the last thread can't
              strand you in an empty pane with the toggle gone. */}
          {(awaitingYou > 0 || awaitingFilter) && (
            <button
              className="awaiting-toggle"
              aria-pressed={awaitingFilter}
              title="Threads whose latest comment or reply isn't yours"
              onClick={() =>
                onFilterChange({ ...filter, status: awaitingFilter ? ANY : "awaiting-you" })
              }
            >
              {awaitingYou} awaiting you
            </button>
          )}
        </div>
        {total > 0 && (
          <select
            aria-label="Sort comments"
            value={sort}
            onChange={(e) => onSortChange(e.target.value as CommentSort)}
          >
            {COMMENT_SORTS.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
        )}
      </div>
      {total > 0 && (
        <div className="comments-filter">
          <select
            aria-label="Filter by status"
            value={filter.status}
            onChange={(e) => onFilterChange({ ...filter, status: e.target.value as CommentFilter["status"] })}
          >
            {STATUS_FILTERS.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
          <select
            aria-label="Filter by type"
            value={filter.type}
            onChange={(e) => onFilterChange({ ...filter, type: e.target.value as TypeFilter })}
          >
            {TYPE_FILTERS.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
          {/* One author is every author — the choice only means something once a
              second identity (an agent) has commented. */}
          {authorOptions.length > 1 && (
            <select
              aria-label="Filter by author"
              value={filter.author}
              onChange={(e) => onFilterChange({ ...filter, author: e.target.value })}
            >
              <option value={ANY}>Any author</option>
              {authorOptions.map((a) => (
                <option key={a} value={a}>
                  {a}
                </option>
              ))}
            </select>
          )}
          {narrowed && (
            <button className="filter-clear" onClick={() => onFilterChange(NO_FILTER)}>
              Clear
            </button>
          )}
        </div>
      )}
      {total === 0 && <p className="muted">Click a line number in the diff to add a comment.</p>}
      {total > 0 && comments.length === 0 && (
        <p className="muted">No comments match the filter.</p>
      )}
      {fileRuns(comments).map((run) => (
        <div key={run.path} className="comment-file-group">
          <div className="comment-file-name">{run.path}</div>
          {run.items.map((c) => (
            // a <button> can't nest in another, so the delete button is a sibling
            <div key={c.id} className="comment-nav-item">
              <button
                className={`comment-nav${c.resolved ? " comment-nav-resolved" : ""}${
                  c.anchorStatus === "outdated" ? " comment-nav-outdated" : ""
                }${turnOf(c) === "you" ? " comment-nav-awaiting" : ""}`}
                onClick={() => onJump(c.id)}
              >
                <CommentPreview comment={c} inline stamp={sortTimestamp(c, sort)} />
              </button>
              <button
                className="comment-nav-delete"
                title="Delete comment"
                aria-label="Delete comment"
                onClick={() => onDelete(c.id)}
              >
                ×
              </button>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
