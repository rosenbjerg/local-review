import type { ReactNode } from "react";
import type { Comment, CommentType } from "../types";
import { FileComments } from "./FileComments";
import { Markdown } from "./Markdown";

interface Props {
  source: string;
  comments: Comment[];
  renderThread: (c: Comment) => ReactNode;
  onSubmitFileComment: (body: string, type: CommentType) => Promise<boolean>;
}

// The rendered (as-published) view of a markdown file: the document itself plus
// file-level (line-0) comments, mirroring MediaView's image mode. Line-anchored
// commenting lives in the Code view, so the rendered view offers only file
// comments and keeps any existing threads visible.
export function MarkdownView({ source, comments, renderThread, onSubmitFileComment }: Props) {
  return (
    <div className="media-body">
      <Markdown className="markdown-body md-file" source={source} softBreaks={false} />
      <FileComments comments={comments} renderThread={renderThread} onSubmit={onSubmitFileComment} />
    </div>
  );
}
