import { useRef, type KeyboardEvent, type RefObject } from "react";
import { IconX } from "./icons";

interface Props {
  value: string;
  onChange: (value: string) => void;
  ariaLabel: string;
  placeholder?: string;
  // The caller's own keys; Escape is handled here and never reaches it.
  onKeyDown?: (e: KeyboardEvent<HTMLInputElement>) => void;
  inputRef?: RefObject<HTMLInputElement>;
  autoFocus?: boolean;
  // Escape on an already-empty field: blur (the panes), or bubble so a modal's own Escape closes it.
  emptyEscape?: "blur" | "bubble";
}

// The "narrow this list" field: a text input, a clear button, and Escape as the dismiss gesture.
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
      // Else the global shortcuts read it as "clear the highlight", or a modal as close.
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
