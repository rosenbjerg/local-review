import { useState } from "react";
import { CommentComposer } from "./CommentComposer";
import { IconChevronRight } from "./icons";
import { Markdown } from "./Markdown";

interface Props {
  summary: string;
  onSave: (summary: string) => void;
  onCollapse: () => void;
}

// The review's overall note: what the export leads with.
export function ReviewSummary({ summary, onSave, onCollapse }: Props) {
  const [editing, setEditing] = useState(false);

  const collapse = (
    <button
      className="btn btn-icon pane-collapse"
      onClick={onCollapse}
      title="Hide the comments panel ( ] )"
      aria-label="Hide the comments panel"
      aria-expanded
    >
      <IconChevronRight />
    </button>
  );

  // The composer's `.composer` root is what the global shortcuts stand down for; it only
  // mounts while editing, so reopening always starts from the saved summary.
  if (editing) {
    return (
      <div className="review-summary">
        <div className="review-summary-head">
          {collapse}
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
        <div className="review-summary-head">
          {collapse}
          <button className="link review-summary-add" onClick={() => setEditing(true)}>
            + Add a review summary
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="review-summary">
      <div className="review-summary-head">
        {collapse}
        <h2>Summary</h2>
        <span className="spacer" />
        <button className="link" onClick={() => setEditing(true)}>
          edit
        </button>
      </div>
      <Markdown className="review-summary-body md-body" source={summary} />
    </div>
  );
}
