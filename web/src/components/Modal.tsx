import { useEffect, useRef, type ReactNode } from "react";
import { useFocusTrap } from "../useFocusTrap";

interface Props {
  onClose: () => void;
  labelledBy: string;
  className?: string;
  children: ReactNode;
}

// Render conditionally (mounted only while open) so the focus trap restores focus
// to the trigger on unmount.
export function Modal({ onClose, labelledBy, className, children }: Props) {
  const trapRef = useFocusTrap<HTMLDivElement>(true);
  const pressedBackdrop = useRef(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // A click event fires on the common ancestor of press and release, so a text
  // selection dragged out of the dialog reports the backdrop as its target:
  // closing on the click alone loses the reviewer's edits mid-drag.
  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => {
        pressedBackdrop.current = e.target === e.currentTarget;
      }}
      onMouseUp={(e) => {
        if (e.target !== e.currentTarget) pressedBackdrop.current = false;
      }}
      onClick={() => {
        if (pressedBackdrop.current) onClose();
      }}
    >
      <div
        className={`modal${className ? ` ${className}` : ""}`}
        ref={trapRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
      >
        {children}
      </div>
    </div>
  );
}
