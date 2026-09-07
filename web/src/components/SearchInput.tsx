import { useRef, type KeyboardEvent, type RefObject } from "react";
import { IconX } from "./icons";

interface Props {
  value: string;
  onChange: (value: string) => void;
  ariaLabel: string;
  placeholder?: string;
  // The caller's own keys (the add-file picker's arrows and Enter). Escape is
  // handled here and never reaches it.
  onKeyDown?: (e: KeyboardEvent<HTMLInputElement>) => void;
  // For a caller that focuses the field from outside (the `/` shortcut).
  inputRef?: RefObject<HTMLInputElement>;
  // Marks the field as the focus trap's initial target inside a modal.
  autoFocus?: boolean;
  // What Escape does on an already-empty field. The panes blur it, handing the
  // keyboard back to the global shortcuts; inside a modal it bubbles, so the
  // dialog's own Escape closes it. A non-empty field always clears first.
  emptyEscape?: "blur" | "bubble";
}

// The "narrow this list" field: a text input with a clear button, and Escape as
// the dismiss gesture. Shared by the file explorer, the comments pane and the
// add-file picker, which each had their own copy of the Escape rule.
export function SearchInput({
  value,
  onChange,
  ariaLabel,
  placeholder,
  onKeyDown,
  inputRef,
  autoFocus,
  emptyEscape = "blur",
}: Props) {
  const ownRef = useRef<HTMLInputElement>(null);
  const ref = inputRef ?? ownRef;

  function handleKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key !== "Escape") {
      onKeyDown?.(e);
      return;
    }
    if (value) {
      // Don't let it bubble to the global shortcuts, which read Escape as "clear
      // the occurrence highlight", or to a modal, which reads it as close.
      e.stopPropagation();
      onChange("");
    } else if (emptyEscape === "blur") {
      e.stopPropagation();
      e.currentTarget.blur();
    }
  }

  return (
    <div className="search-wrap">
      <input
        ref={ref}
        type="text"
        className="search-input"
        placeholder={placeholder}
        value={value}
        aria-label={ariaLabel}
        data-autofocus={autoFocus ? "" : undefined}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={handleKeyDown}
      />
      {value && (
        <button
          type="button"
          className="search-clear"
          aria-label="Clear search"
          title="Clear search"
          onClick={() => {
            onChange("");
            ref.current?.focus();
          }}
        >
          <IconX size={13} />
        </button>
      )}
    </div>
  );
}
