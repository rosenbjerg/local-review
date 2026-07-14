import type { ReactNode } from "react";
import type { Comment, CommentType } from "../types";
import { CommentComposer } from "./CommentComposer";
import { Markdown } from "./Markdown";

interface Props {
  source: string;
  comments: Comment[];
  renderThread: (c: Comment) => ReactNode;
  fileComposer: boolean;
  onSetFileComposer: (open: boolean) => void;
  onSubmitFileComment: (body: string, type: CommentType) => void;
}

// The rendered (as-published) view of a markdown file: the document itself plus
// file-level (line-0) comments, mirroring MediaView's image mode. Line-anchored
// commenting lives in the Code view, so the rendered view offers only file
// comments and keeps any existing threads visible.
export function MarkdownView({
  source,
  comments,
  renderThread,
  fileComposer,
  onSetFileComposer,
  onSubmitFileComment,
}: Props) {
  return (
    <div className="media-body">
      <Markdown className="markdown-body md-file" source={source} softBreaks={false} />
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
