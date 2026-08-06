import { Modal } from "./Modal";

interface Props {
  commentCount: number;
  reviewedCount: number;
  hasSummary: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}

// Confirms the destructive Reset (delete all comments, unmark all reviewed files,
// clear the summary).
export function ResetConfirmModal({
  commentCount,
  reviewedCount,
  hasSummary,
  onCancel,
  onConfirm,
}: Props) {
  return (
    <Modal onClose={onCancel} labelledBy="reset-title" className="modal-sm">
      <div className="modal-head">
        <h2 id="reset-title">Reset review?</h2>
      </div>
      <div className="confirm-body">
        <p>
          This deletes{" "}
          <strong>
            {commentCount} comment{commentCount === 1 ? "" : "s"}
          </strong>{" "}
          and unmarks{" "}
          <strong>
            {reviewedCount} reviewed file{reviewedCount === 1 ? "" : "s"}
          </strong>{" "}
          in this review{hasSummary && ", along with the review summary"}. It can't be undone.
        </p>
      </div>
      <div className="confirm-actions">
        <button className="btn" data-autofocus onClick={onCancel}>
          Cancel
        </button>
        <button className="btn danger" onClick={onConfirm}>
          Delete everything
        </button>
      </div>
    </Modal>
  );
}
