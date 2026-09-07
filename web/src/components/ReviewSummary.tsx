import { useState } from "react";
import { CommentComposer } from "./CommentComposer";
import { Markdown } from "./Markdown";

interface Props {
  summary: string;
  onSave: (summary: string) => void;
}

// The review's overall note, above the per-line comments: what the export leads
// with, so the agent gets the framing before the list of tasks.
export function ReviewSummary({ summary, onSave }: Props) {
  const [editing, setEditing] = useState(false);

  function open() {
    setEditing(true);
  }

  // The editor is the comment composer with the type row off — same keys, same
  // actions row, and its `.composer` root is what the global shortcuts stand down
  // for, so `v` or `e` can't fire off a focused Save button mid-edit. The composer
  // seeds its draft from `initialBody` on mount, and it only mounts while editing,
  // so reopening always starts from the saved summary.
  if (editing) {
    return (
      <div className="review-summary">
        <div className="review-summary-head">
          <h2>Summary</h2>
        </div>
        <CommentComposer
          hideType
          // No empty guard: clearing the box is how you delete the summary.
          allowEmpty
          initialBody={summary}
          submitLabel="Save"
          placeholder="What should the agent know before working through the comments?"
          onCancel={() => setEditing(false)}
          onSubmit={(body) => {
            onSave(body);
            setEditing(false);
          }}
        />
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
