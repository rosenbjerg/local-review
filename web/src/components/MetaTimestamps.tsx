import { absoluteTime, relativeTime, wasEdited } from "../time";

// The shared tail of a comment/reply meta row: author, a relative timestamp
// (full time on hover), and an (edited) marker when the body changed after
// creation. Rendered as a fragment so callers place it among their own leading
// meta bits (id, badges) inside the flex row.
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
