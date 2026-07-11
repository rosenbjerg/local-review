import { useEffect, type ReactNode } from "react";
import { useFocusTrap } from "../useFocusTrap";

interface Props {
  onClose: () => void;
  // id of the heading element inside, wired to aria-labelledby.
  labelledBy: string;
  // Extra class on the panel, e.g. "modal-sm" for the compact content-sized size.
  className?: string;
  children: ReactNode;
}

// Shared modal shell: click-scrim, focus trap, Escape-to-close, dialog aria.
// Render it conditionally (mounted only while open) so the trap restores focus
// to the trigger on unmount. Callers supply the head + body as children.
export function Modal({ onClose, labelledBy, className, children }: Props) {
  const trapRef = useFocusTrap<HTMLDivElement>(true);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className={`modal${className ? ` ${className}` : ""}`}
        ref={trapRef}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
      >
        {children}
      </div>
    </div>
  );
}
