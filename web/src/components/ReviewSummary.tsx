import { useState } from "react";
import { Markdown } from "./Markdown";

interface Props {
  summary: string;
  onSave: (summary: string) => void;
}

// The review's overall note, above the per-line comments: what the export leads
// with, so the agent gets the framing before the list of tasks.
export function ReviewSummary({ summary, onSave }: Props) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(summary);

  function open() {
    setDraft(summary);
    setEditing(true);
  }

  function save() {
    onSave(draft);
    setEditing(false);
  }

  if (editing) {
    return (
      <div className="review-summary">
        <div className="review-summary-head">
          <h2>Summary</h2>
        </div>
        <textarea
          autoFocus
          className="review-summary-input"
          value={draft}
          placeholder="What should the agent know before working through the comments?"
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
              e.preventDefault();
              save();
            }
            if (e.key === "Escape") setEditing(false);
          }}
        />
        <div className="composer-actions">
          <span className="composer-hint">⌘/Ctrl+Enter to save · Esc to cancel</span>
          <button className="btn" onClick={() => setEditing(false)}>
            Cancel
          </button>
          {/* No empty guard: clearing the box is how you delete the summary. */}
          <button className="btn btn-primary" onClick={save}>
            Save
          </button>
        </div>
      </div>
    );
  }

  if (!summary) {
    return (
      <div className="review-summary">
        <button className="link review-summary-add" onClick={open}>
          + Add a review summary
        </button>
      </div>
    );
  }

  return (
    <div className="review-summary">
      <div className="review-summary-head">
        <h2>Summary</h2>
        <span className="spacer" />
        <button className="link" onClick={open}>
          edit
        </button>
      </div>
      <Markdown className="review-summary-body md-body" source={summary} />
    </div>
  );
}
