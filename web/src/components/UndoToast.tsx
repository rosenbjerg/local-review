import { UNDO_MS } from "../useUndoableDelete";

export function UndoToast({ message, onUndo }: { message: string; onUndo: () => void }) {
  return (
    <div
      className="toast"
      role="status"
      style={{ "--toast-ms": `${UNDO_MS}ms` } as React.CSSProperties}
    >
      <span>{message}</span>
      <button className="toast-action" onClick={onUndo}>
        Undo
      </button>
      <div className="toast-timer" aria-hidden="true" />
    </div>
  );
}
