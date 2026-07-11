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

// The shared modal shell: a scrim that closes on click, a focus-trapped dialog
// panel that swallows its own clicks, Escape-to-close, and the dialog aria. Only
// mounted while open (render it conditionally), so the trap is active for the
// component's whole lifetime and restores focus to the trigger on unmount.
// Callers supply the head + body as children (a `.modal-head` with the heading
// carrying `labelledBy`, then the body).
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
