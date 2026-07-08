import { useState } from "react";
import { COMMENT_TYPES, type CommentType } from "../types";

interface Props {
  initialBody?: string;
  initialType?: CommentType;
  onSubmit: (body: string, type: CommentType) => void;
  onCancel: () => void;
  submitLabel?: string;
}

export function CommentComposer({
  initialBody = "",
  initialType = "suggestion",
  onSubmit,
  onCancel,
  submitLabel = "Add comment",
}: Props) {
  const [body, setBody] = useState(initialBody);
  const [type, setType] = useState<CommentType>(initialType);

  return (
    <div className="composer">
      <div className="composer-row">
        <select value={type} onChange={(e) => setType(e.target.value as CommentType)}>
          {COMMENT_TYPES.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
      </div>
      <textarea
        autoFocus
        value={body}
        placeholder="Leave a comment for the agent…"
        onChange={(e) => setBody(e.target.value)}
        onKeyDown={(e) => {
          if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && body.trim()) {
            onSubmit(body.trim(), type);
          }
          if (e.key === "Escape") onCancel();
        }}
      />
      <div className="composer-actions">
        <button className="btn" onClick={onCancel}>
          Cancel
        </button>
        <button
          className="btn btn-primary"
          disabled={!body.trim()}
          onClick={() => onSubmit(body.trim(), type)}
        >
          {submitLabel}
        </button>
      </div>
    </div>
  );
}
