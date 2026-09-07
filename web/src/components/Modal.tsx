import { useEffect, useId, useRef, type ReactNode } from "react";
import { useFocusTrap } from "../useFocusTrap";

interface Props {
  onClose: () => void;
  // Names the dialog: the head's heading, and what aria-labelledby points at.
  title: string;
  className?: string;
  // The head's two slots. `controls` sit beside the title (a ViewToggle picking
  // what the body shows); `actions` sit at the right, before Close.
  controls?: ReactNode;
  actions?: ReactNode;
  // The head's Close button. Shown by default; `autofocus` makes it the focus
  // trap's initial target, for a dialog with nothing safer to land on (settings);
  // `none` for a dialog whose body carries its own way out (the confirm's
  // Cancel / Delete).
  close?: "button" | "autofocus" | "none";
  children: ReactNode;
}

// Render conditionally (mounted only while open) so the focus trap restores focus
// to the trigger on unmount.
export function Modal({
  onClose,
  title,
  className,
  controls,
  actions,
  close = "button",
  children,
}: Props) {
  const trapRef = useFocusTrap<HTMLDivElement>(true);
  const pressedBackdrop = useRef(false);
  const titleId = useId();

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
        aria-labelledby={titleId}
      >
        <div className="modal-head">
          <h2 id={titleId}>{title}</h2>
          {controls}
          <span className="spacer" />
          {actions}
          {close !== "none" && (
            <button
              className="btn"
              data-autofocus={close === "autofocus" ? "" : undefined}
              onClick={onClose}
            >
              Close
            </button>
          )}
        </div>
        {children}
      </div>
    </div>
  );
}
