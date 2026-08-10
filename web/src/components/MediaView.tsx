import { useState, type ReactNode } from "react";
import { api } from "../api";
import type { Comment, CommentType, FileDiff } from "../types";
import { CommentComposer } from "./CommentComposer";

// One side of the before/after pair. The blob can 404 — the path may not exist on
// that side, e.g. a comment outliving a renamed image — which the browser would
// otherwise render as a broken-image icon. Callers mount it keyed on src and the
// file's status, so switching view axis or the file reappearing retries the load
// rather than leaving it stuck on the note.
function ImageSide({
  label,
  src,
  alt,
  absent,
}: {
  label: string;
  src: string;
  alt: string;
  absent: string;
}) {
  const [failed, setFailed] = useState(false);
  return (
    <figure className="image-side">
      <figcaption>{label}</figcaption>
      {failed ? (
        <div className="binary-note">{absent}</div>
      ) : (
        <img src={src} alt={alt} onError={() => setFailed(true)} />
      )}
    </figure>
  );
}

interface Props {
  file: FileDiff;
  repo: string;
  headRef: string;
  baseRef: string;
  worktree: boolean;
  indexed: boolean;
  asImage: boolean;
  comments: Comment[];
  renderThread: (c: Comment) => ReactNode;
  fileComposer: boolean;
  onSetFileComposer: (open: boolean) => void;
  onSubmitFileComment: (body: string, type: CommentType) => void;
}

// The media (raster image / non-image binary) view of a file: a before/after
// image pair when previewable, plus file-level (line-0) comments and composer.
export function MediaView({
  file,
  repo,
  headRef,
  baseRef,
  worktree,
  indexed,
  asImage,
  comments,
  renderThread,
  fileComposer,
  onSetFileComposer,
  onSubmitFileComment,
}: Props) {
  const showBefore = file.status !== "added" && file.oldPath && baseRef;
  const showAfter = file.status !== "deleted" && file.newPath;
  const beforeSrc = api.blobURL(repo, file.oldPath, baseRef);
  const afterSrc = api.blobURL(repo, file.newPath, headRef, worktree, indexed);
  const afterSide = indexed ? "the index" : worktree ? "the working tree" : headRef;
  return (
    <div className="media-body">
      {asImage ? (
        <div className="image-diff">
          {showBefore && (
            <ImageSide
              key={`${file.status}:${beforeSrc}`}
              label="before"
              src={beforeSrc}
              alt={`${file.oldPath} (before)`}
              absent="Not in the base revision."
            />
          )}
          {showAfter && (
            <ImageSide
              key={`${file.status}:${afterSrc}`}
              label="after"
              src={afterSrc}
              alt={`${file.newPath} (after)`}
              absent={`No longer in ${afterSide} — renamed or deleted.`}
            />
          )}
        </div>
      ) : (
        <div className="binary-note">Binary file — no preview</div>
      )}
      <div className="file-comments">
        {comments.map(renderThread)}
        {fileComposer ? (
          <CommentComposer
            submitLabel="Add comment"
            onSubmit={onSubmitFileComment}
            onCancel={() => onSetFileComposer(false)}
          />
        ) : (
          <button className="btn add-file-comment" onClick={() => onSetFileComposer(true)}>
            + Add file comment
          </button>
        )}
      </div>
    </div>
  );
}
