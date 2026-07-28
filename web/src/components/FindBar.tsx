import type { MouseEvent as ReactMouseEvent } from "react";

interface Props {
  term: string;
  count: number;
  index: number;
  // The origin file is showing changed lines only, so matches elsewhere in it
  // aren't rendered and can't be found.
  changedOnly: boolean;
  onNext: () => void;
  onPrev: () => void;
  onShowFullFile: () => void;
  onClear: () => void;
}

// Pressing a control would otherwise collapse the text selection, and an empty
// selection dismisses the very highlight these buttons operate on.
const keepSelection = (e: ReactMouseEvent) => e.preventDefault();

export function FindBar({
  term,
  count,
  index,
  changedOnly,
  onNext,
  onPrev,
  onShowFullFile,
  onClear,
}: Props) {
  return (
    <div className="find-bar">
      <span className="find-term" title={term}>
        {term}
      </span>
      <span className="find-count" role="status">
        {count === 0 ? "No matches" : `${index + 1} of ${count}`}
      </span>
      <button
        className="btn btn-icon"
        onMouseDown={keepSelection}
        onClick={onPrev}
        disabled={count === 0}
        title="Previous match (Shift+Enter)"
        aria-label="Previous match"
      >
        ‹
      </button>
      <button
        className="btn btn-icon"
        onMouseDown={keepSelection}
        onClick={onNext}
        disabled={count === 0}
        title="Next match (Enter)"
        aria-label="Next match"
      >
        ›
      </button>
      {changedOnly && (
        <button
          className="btn"
          onMouseDown={keepSelection}
          onClick={onShowFullFile}
          title="Only the changed lines are searched in this view"
        >
          Search full file
        </button>
      )}
      <span className="spacer" />
      <button
        className="btn btn-icon"
        onMouseDown={keepSelection}
        onClick={onClear}
        title="Clear (Esc)"
        aria-label="Clear highlight"
      >
        ×
      </button>
    </div>
  );
}
