import type { ReactNode } from "react";
import { api } from "../api";
import type { Comment, CommentType, FileDiff } from "../types";
import { CommentComposer } from "./CommentComposer";

interface Props {
  file: FileDiff;
  repo: string;
  headRef: string;
  baseRef: string;
  uncommitted: boolean;
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
  uncommitted,
  asImage,
  comments,
  renderThread,
  fileComposer,
  onSetFileComposer,
  onSubmitFileComment,
}: Props) {
  const showBefore = file.status !== "added" && file.oldPath && baseRef;
  const showAfter = file.status !== "deleted" && file.newPath;
  return (
    <div className="media-body">
      {asImage ? (
        <div className="image-diff">
          {showBefore && (
            <figure className="image-side">
              <figcaption>before</figcaption>
              <img src={api.blobURL(repo, file.oldPath, baseRef)} alt={`${file.oldPath} (before)`} />
            </figure>
          )}
          {showAfter && (
            <figure className="image-side">
              <figcaption>after</figcaption>
              <img src={api.blobURL(repo, file.newPath, headRef, uncommitted)} alt={`${file.newPath} (after)`} />
            </figure>
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
