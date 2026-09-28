import type { ReactNode } from "react";
import type { Comment, CommentType } from "../types";
import { FileComments } from "./FileComments";
import { Markdown } from "./Markdown";

interface Props {
  path: string;
  source: string;
  comments: Comment[];
  renderThread: (c: Comment) => ReactNode;
  onSubmitFileComment: (body: string, type: CommentType) => Promise<boolean>;
}

// The rendered view of a markdown file plus file-level comments; line-anchored commenting stays in Code view.
export function MarkdownView({ path, source, comments, renderThread, onSubmitFileComment }: Props) {
  return (
    <div className="media-body">
      <Markdown className="markdown-body md-file" source={source} softBreaks={false} />
      <FileComments path={path} comments={comments} renderThread={renderThread} onSubmit={onSubmitFileComment} />
    </div>
  );
}
