import { useEffect, useState, type ReactNode } from "react";
import { draftKey, getDraft, onDraftDiscarded } from "../drafts";
import type { Comment, CommentType } from "../types";
import { CommentComposer } from "./CommentComposer";

interface Props {
  path: string;
  // Line-0 comments under a diff table; every comment on the file in the media and markdown views.
  comments: Comment[];
  renderThread: (c: Comment) => ReactNode;
  // A failure keeps the composer open with the text, so the reviewer can retry.
  onSubmit: (body: string, type: CommentType) => Promise<boolean>;
}

// A file's own comments plus the control to add one; owns the composer's open state so no view has to.
export function FileComments({ path, comments, renderThread, onSubmit }: Props) {
  const key = draftKey.file(path);
  const [composing, setComposing] = useState(() => !!getDraft(key));

  useEffect(
    () =>
      onDraftDiscarded((d) => {
        if (d.key === key) setComposing(false);
      }),
    [key]
  );

  async function submit(body: string, type: CommentType) {
    const ok = await onSubmit(body, type);
    if (ok) setComposing(false);
    return ok;
  }

  return (
    <div className="file-comments">
      {comments.map(renderThread)}
      {composing ? (
        <CommentComposer
          draft={{ key, target: { kind: "file", path } }}
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
