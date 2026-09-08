import { useState, type ReactNode } from "react";
import type { Comment, CommentType } from "../types";
import { CommentComposer } from "./CommentComposer";

interface Props {
  // Line-0 comments under a diff table; every comment on the file in the media and markdown views.
  comments: Comment[];
  renderThread: (c: Comment) => ReactNode;
  // A failure keeps the composer open with the text, so the reviewer can retry.
  onSubmit: (body: string, type: CommentType) => Promise<boolean>;
}

// A file's own comments plus the control to add one; owns the composer's open state so no view has to.
export function FileComments({ comments, renderThread, onSubmit }: Props) {
  const [composing, setComposing] = useState(false);

  async function submit(body: string, type: CommentType) {
    if (await onSubmit(body, type)) setComposing(false);
  }

  return (
    <div className="file-comments">
      {comments.map(renderThread)}
      {composing ? (
        <CommentComposer
          submitLabel="Add comment"
          onSubmit={submit}
          onCancel={() => setComposing(false)}
        />
      ) : (
        <button className="btn add-file-comment" onClick={() => setComposing(true)}>
          + Add file comment
        </button>
      )}
    </div>
  );
}
