import { useRef, useState } from "react";
import { COMMENT_TYPES, type CommentType } from "../types";

/** One-click type picker: the type badges themselves, made selectable, so the
 *  target is recognized by its color rather than read out of a dropdown.
 *  Radiogroup semantics (single tab stop, arrows move the selection) keep four
 *  pills costing the keyboard no more than the one select they replaced. */
function TypePills({
  value,
  onChange,
  onPick,
}: {
  value: CommentType;
  onChange: (type: CommentType) => void;
  /** A click is a finished choice, so it hands the caret back to the body.
   *  Arrow-keying deliberately doesn't: focus has to stay in the group for the
   *  next arrow to land, and it's the roving tabIndex's only holder. */
  onPick: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);

  function onKeyDown(e: React.KeyboardEvent) {
    const step =
      e.key === "ArrowRight" || e.key === "ArrowDown"
        ? 1
        : e.key === "ArrowLeft" || e.key === "ArrowUp"
          ? -1
          : 0;
    if (!step) return;
    e.preventDefault();
    const i = COMMENT_TYPES.indexOf(value);
    const next = COMMENT_TYPES[(i + step + COMMENT_TYPES.length) % COMMENT_TYPES.length];
    onChange(next);
    // Focus follows the selection, as it does in a native radiogroup — the
    // unselected pills are tabIndex -1, so nothing else can hold it.
    ref.current?.querySelector<HTMLButtonElement>(`[data-type="${next}"]`)?.focus();
  }

  return (
    <div
      ref={ref}
      className="type-pills"
      role="radiogroup"
      aria-label="Comment type"
      onKeyDown={onKeyDown}
    >
      {COMMENT_TYPES.map((t) => {
        const active = t === value;
        return (
          <button
            key={t}
            type="button"
            role="radio"
            aria-checked={active}
            tabIndex={active ? 0 : -1}
            data-type={t}
            className={`badge badge-${t} type-pill${active ? " active" : ""}`}
            onClick={() => {
              onChange(t);
              onPick();
            }}
          >
            {t}
          </button>
        );
      })}
    </div>
  );
}

interface Props {
  initialBody?: string;
  initialType?: CommentType;
  onSubmit: (body: string, type: CommentType) => void | Promise<unknown>;
  onCancel: () => void;
  submitLabel?: string;
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
  const bodyRef = useRef<HTMLTextAreaElement>(null);

  // Block re-entry so a second click or ⌘+Enter mid-save can't post a duplicate.
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

  // Submit/cancel are bound on the root rather than the textarea, so they work from
  // the pills and buttons too — the global shortcuts bail on this whole subtree
  // (`useKeyboardShortcuts`), which would otherwise leave both keys dead there.
  function onKeyDown(e: React.KeyboardEvent) {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault();
      submit();
    }
    if (e.key === "Escape") onCancel();
  }

  return (
    <div className="composer" onKeyDown={onKeyDown}>
      {!hideType && (
        <div className="composer-row">
          <TypePills
            value={type}
            onChange={setType}
            onPick={() => bodyRef.current?.focus()}
          />
        </div>
      )}
      <textarea
        ref={bodyRef}
        autoFocus
        value={body}
        placeholder={placeholder}
        onChange={(e) => setBody(e.target.value)}
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
