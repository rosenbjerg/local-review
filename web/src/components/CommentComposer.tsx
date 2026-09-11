import { useRef, useState } from "react";
import { COMMENT_TYPES, type CommentType } from "../types";

/** One-click type picker with radiogroup semantics: a single tab stop, arrows move the selection. */
function TypePills({
  value,
  onChange,
  onPick,
}: {
  value: CommentType;
  onChange: (type: CommentType) => void;
  /** A click hands the caret back to the body; arrow-keying doesn't, since focus must stay in the group. */
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
    // Focus follows the selection: the unselected pills are tabIndex -1, so nothing else can hold it.
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
  // The review summary is cleared by saving it blank.
  allowEmpty?: boolean;
}

export function CommentComposer({
  initialBody = "",
  initialType = "suggestion",
  onSubmit,
  onCancel,
  submitLabel = "Add comment",
  hideType = false,
  placeholder = "Leave a comment for the agent…",
  allowEmpty = false,
}: Props) {
  const [body, setBody] = useState(initialBody);
  const [type, setType] = useState<CommentType>(initialType);
  const [submitting, setSubmitting] = useState(false);
  const bodyRef = useRef<HTMLTextAreaElement>(null);

  const submittable = allowEmpty || body.trim() !== "";

  // Block re-entry so a second click or ⌘+Enter mid-save can't post a duplicate.
  async function submit() {
    if (!submittable || submitting) return;
    const trimmed = body.trim();
    setSubmitting(true);
    // Was a try/finally, which the compiler can't lower. onSubmit reports failure by
    // returning false rather than throwing, so the catch is belt-and-braces — but either
    // way the composer has to stop blocking re-entry, so the reset sits after both.
    try {
      await onSubmit(trimmed, type);
    } catch {
      // fall through — the caller surfaces the error
    }
    setSubmitting(false);
  }

  // Bound on the root, not the textarea: the global shortcuts bail on this whole subtree, so the
  // keys would otherwise be dead on the pills and buttons.
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
          disabled={!submittable || submitting}
          onClick={submit}
        >
          {submitLabel}
        </button>
      </div>
    </div>
  );
}
