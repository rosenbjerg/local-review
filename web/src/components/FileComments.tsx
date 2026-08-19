import { useState, type ReactNode } from "react";
import type { Comment, CommentType } from "../types";
import { CommentComposer } from "./CommentComposer";

interface Props {
  // Whichever threads this view is responsible for showing: the line-0 file
  // comments under a diff table, or every comment on the file in the media and
  // rendered-markdown views, which have no rows to anchor to.
  comments: Comment[];
  renderThread: (c: Comment) => ReactNode;
  // Reports whether the comment landed. A failure keeps the composer open with
  // the text still in it, so the reviewer can retry rather than retype.
  onSubmit: (body: string, type: CommentType) => Promise<boolean>;
}

// A file's own comments plus the control to add one — the surface every view of a
// file needs and no row can carry: a deleted file has no new-side line to click,
// an image has no lines at all, and a file may simply have something to say about
// itself.
//
// It owns the composer's open state rather than taking it as a prop. The three
// views that render this block each held that flag for it, which made the block
// itself a copy in all three — and the flag never meant anything to them beyond
// handing it straight back.
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
