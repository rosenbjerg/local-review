import type { CommentFilter, TypeFilter } from "../commentFilter";
import {
  ANY,
  NO_FILTER,
  STATUS_FILTERS,
  TYPE_FILTERS,
  isFiltered,
  queryNeedle,
} from "../commentFilter";
import type { CommentSort } from "../commentSort";
import { COMMENT_SORTS, sortTimestamp } from "../commentSort";
import { turnOf } from "../commentTurn";
import type { Comment } from "../types";
import { effectivePath } from "../types";
import { Combobox } from "./Combobox";
import { CommentPreview } from "./CommentPreview";
import { HighlightMatch } from "./HighlightMatch";
import { IconChevronRight, IconX } from "./icons";
import { SearchInput } from "./SearchInput";

interface Props {
  // Already filtered and sorted — the same list the n/p shortcuts step through.
  comments: Comment[];
  total: number;
  // Over the whole review, not the filtered list, so narrowing can't read as "nothing left to do".
  awaitingYou: number;
  sort: CommentSort;
  onSortChange: (sort: CommentSort) => void;
  filter: CommentFilter;
  onFilterChange: (filter: CommentFilter) => void;
  authors: string[];
  onJump: (id: number) => void;
  onDelete: (id: number) => void;
  onCollapse: () => void;
}

// `comments` arrives sorted with each file's comments contiguous, so the groups are runs of one path.
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
  onCollapse,
}: Props) {
  const narrowed = isFiltered(filter);
  const needle = queryNeedle(filter.query);
  // A filtered-on author whose last thread went away keeps its option, or the picker sits blank while hiding everything.
  const authorOptions =
    filter.author === ANY || authors.includes(filter.author) ? authors : [...authors, filter.author];
  const awaitingFilter = filter.status === "awaiting-you";
  return (
    <div className="comments-panel">
      <div className="comments-panel-header">
        <div className="comments-title">
          <button
            className="btn btn-icon pane-collapse"
            onClick={onCollapse}
            title="Hide the comments panel ( ] )"
            aria-label="Hide the comments panel"
            aria-expanded
          >
            <IconChevronRight />
          </button>
          <h2>
            Comments{" "}
            <span className="muted">({narrowed ? `${comments.length} of ${total}` : total})</span>
          </h2>
          {/* Stays while its filter is on, even at zero, or answering the last thread strands you with the toggle gone. */}
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
          <Combobox
            ariaLabel="Sort comments"
            value={sort}
            options={COMMENT_SORTS}
            onChange={(v) => onSortChange(v as CommentSort)}
            floating
          />
        )}
      </div>
      {total > 0 && (
        <div className="comments-search-row">
          <SearchInput
            value={filter.query}
            onChange={(query) => onFilterChange({ ...filter, query })}
            ariaLabel="Search comments"
            placeholder="Search comments…"
          />
        </div>
      )}
      {total > 0 && (
        <div className="comments-filter">
          <Combobox
            ariaLabel="Filter by status"
            value={filter.status}
            options={STATUS_FILTERS}
            onChange={(v) => onFilterChange({ ...filter, status: v as CommentFilter["status"] })}
            floating
          />
          <Combobox
            ariaLabel="Filter by type"
            value={filter.type}
            options={TYPE_FILTERS}
            onChange={(v) => onFilterChange({ ...filter, type: v as TypeFilter })}
            floating
          />
          {authorOptions.length > 1 && (
            <Combobox
              ariaLabel="Filter by author"
              value={filter.author}
              options={[
                { value: ANY, label: "Any author" },
                ...authorOptions.map((a) => ({ value: a, label: a })),
              ]}
              onChange={(v) => onFilterChange({ ...filter, author: v })}
              floating
            />
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
          <div className="comment-file-name">
            <HighlightMatch text={run.path} needle={needle} />
          </div>
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
                <IconX />
              </button>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
