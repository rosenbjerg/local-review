import { useEffect, useId, useRef, type ReactNode } from "react";
import { useFocusTrap } from "../useFocusTrap";

interface Props {
  onClose: () => void;
  // Names the dialog: the head's heading, and what aria-labelledby points at.
  title: string;
  className?: string;
  // `controls` sit beside the title; `actions` at the right, before Close.
  controls?: ReactNode;
  actions?: ReactNode;
  // `autofocus` makes Close the focus trap's initial target; `none` is for a body with its own way out.
  close?: "button" | "autofocus" | "none";
  children: ReactNode;
}

// Mount only while open, so the focus trap restores focus to the trigger on unmount.
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

  // A click fires on the common ancestor of press and release, so a drag out of the dialog would
  // read as a backdrop click and discard the edit.
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
