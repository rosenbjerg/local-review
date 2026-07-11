import { useState } from "react";
import { COMMENT_TYPES, type CommentType } from "../types";

interface Props {
  initialBody?: string;
  initialType?: CommentType;
  // May be async; the composer awaits it to guard against a double-submit.
  onSubmit: (body: string, type: CommentType) => void | Promise<unknown>;
  onCancel: () => void;
  submitLabel?: string;
  // Replies inherit their type from the thread root, so their composer hides the
  // type picker (the type value is emitted but ignored by the caller).
  hideType?: boolean;
  placeholder?: string;
}

export function CommentComposer({
  initialBody = "",
  initialType = "suggestion",
  onSubmit,
  onCancel,
  submitLabel = "Add comment",
  hideType = false,
  placeholder = "Leave a comment for the agent…",
}: Props) {
  const [body, setBody] = useState(initialBody);
  const [type, setType] = useState<CommentType>(initialType);
  const [submitting, setSubmitting] = useState(false);

  // Await the (possibly async) submit and block re-entry, so a second click or
  // ⌘+Enter while a save is in flight can't post a duplicate.
  async function submit() {
    const trimmed = body.trim();
    if (!trimmed || submitting) return;
    setSubmitting(true);
    try {
      await onSubmit(trimmed, type);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="composer">
      {!hideType && (
        <div className="composer-row">
          <select
            aria-label="Comment type"
            value={type}
            onChange={(e) => setType(e.target.value as CommentType)}
          >
            {COMMENT_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </div>
      )}
      <textarea
        autoFocus
        value={body}
        placeholder={placeholder}
        onChange={(e) => setBody(e.target.value)}
        onKeyDown={(e) => {
          if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
            e.preventDefault();
            submit();
          }
          if (e.key === "Escape") onCancel();
        }}
      />
      <div className="composer-actions">
        <span className="composer-hint">⌘/Ctrl+Enter to submit · Esc to cancel</span>
        <button className="btn" onClick={onCancel}>
          Cancel
        </button>
        <button
          className="btn btn-primary"
          disabled={!body.trim() || submitting}
          onClick={submit}
        >
          {submitLabel}
        </button>
      </div>
    </div>
  );
}
