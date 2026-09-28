import { useEffect, useRef, useState } from "react";
import { type DraftRef, draftDomId, dropDraft, getDraft, putDraft } from "../drafts";
import { COMMENT_TYPES, type CommentType } from "../types";
import { MOD_KEY } from "../util";

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
  // Resolving to false means the save failed: the composer stays open and the draft is kept.
  onSubmit: (body: string, type: CommentType) => boolean | void | Promise<boolean | void>;
  onCancel: () => void;
  draft?: DraftRef;
  submitLabel?: string;
  hideType?: boolean;
  placeholder?: string;
  // The review summary is cleared by saving it blank.
  allowEmpty?: boolean;
}

export function CommentComposer({
  initialBody = "",
  initialType = "general",
  onSubmit,
  onCancel,
  submitLabel = "Add comment",
  hideType = false,
  placeholder = "Leave a comment for the agent…",
  allowEmpty = false,
  draft,
}: Props) {
  const [body, setBody] = useState(() => (draft && getDraft(draft.key)?.body) ?? initialBody);
  const [type, setType] = useState<CommentType>(
    () => (draft && getDraft(draft.key)?.type) ?? initialType
  );
  const [submitting, setSubmitting] = useState(false);
  const [confirmingDiscard, setConfirmingDiscard] = useState(false);
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const ended = useRef(false);

  const submittable = allowEmpty || body.trim() !== "";
  const dirty = body.trim() !== initialBody.trim() || (!hideType && type !== initialType);
  const unposted = dirty && (body.trim() !== "" || initialBody.trim() !== "");

  // Don't drop the `ended` check: the host closes this with a normal update while dropDraft
  // re-renders it at sync priority first, and that render would put the posted draft back.
  useEffect(() => {
    if (!draft || ended.current) return;
    if (unposted) putDraft({ ...draft, body, type });
    else dropDraft(draft.key);
  }, [draft, unposted, body, type]);

  function endDraft() {
    ended.current = true;
    if (draft) dropDraft(draft.key);
  }

  function cancel() {
    endDraft();
    onCancel();
  }

  function escape() {
    if (dirty && !confirmingDiscard) setConfirmingDiscard(true);
    else cancel();
  }

  function keepEditing() {
    setConfirmingDiscard(false);
    bodyRef.current?.focus();
  }

  // Block re-entry so a second click or ⌘+Enter mid-save can't post a duplicate.
  async function submit() {
    if (!submittable || submitting) return;
    const trimmed = body.trim();
    setSubmitting(true);
    // Was a try/finally, which the compiler can't lower. onSubmit reports failure by
    // returning false rather than throwing, so the catch is belt-and-braces — but either
    // way the composer has to stop blocking re-entry, so the reset sits after both.
    let saved = false;
    try {
      saved = (await onSubmit(trimmed, type)) !== false;
    } catch {
      // fall through — the caller surfaces the error
    }
    if (saved) endDraft();
    setSubmitting(false);
  }

  // Bound on the root, not the textarea: the global shortcuts bail on this whole subtree, so the
  // keys would otherwise be dead on the pills and buttons.
  function onKeyDown(e: React.KeyboardEvent) {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault();
      submit();
    }
    if (e.key === "Escape") escape();
  }

  return (
    <div className="composer" id={draft && draftDomId(draft.key)} onKeyDown={onKeyDown}>
      {!hideType && (
        <div className="composer-row">
          <TypePills
            value={type}
            onChange={(t) => {
              ended.current = false;
              setType(t);
            }}
            onPick={() => bodyRef.current?.focus()}
          />
        </div>
      )}
      <textarea
        ref={bodyRef}
        autoFocus
        value={body}
        placeholder={placeholder}
        onChange={(e) => {
          ended.current = false;
          setBody(e.target.value);
          setConfirmingDiscard(false);
        }}
      />
      {confirmingDiscard ? (
        <div className="composer-actions composer-discard" role="alert">
          <span className="composer-hint">Discard what you've written? Esc again to discard</span>
          <button className="btn" onClick={keepEditing}>
            Keep editing
          </button>
          <button className="btn danger" onClick={cancel}>
            Discard
          </button>
        </div>
      ) : (
        <div className="composer-actions">
          <span className="composer-hint">{MOD_KEY}+Enter to submit · Esc to cancel</span>
          <button className="btn" onClick={cancel}>
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
      )}
    </div>
  );
}
