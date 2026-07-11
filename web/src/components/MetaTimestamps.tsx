import { absoluteTime, relativeTime, wasEdited } from "../time";

// Shared tail of a comment/reply meta row: author, relative time (full on
// hover), and an (edited) marker. A fragment so callers prepend their own
// id/badges.
export function MetaTimestamps({
  author,
  createdAt,
  updatedAt,
}: {
  author: string;
  createdAt: string;
  updatedAt: string;
}) {
  return (
    <>
      <span className="muted">{author}</span>
      {createdAt && (
        <span className="muted" title={absoluteTime(createdAt)}>
          {relativeTime(createdAt)}
        </span>
      )}
      {wasEdited(createdAt, updatedAt) && (
        <span className="muted" title={`edited ${absoluteTime(updatedAt)}`}>
          (edited)
        </span>
      )}
    </>
  );
}
