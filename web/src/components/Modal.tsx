import { useEffect, type ReactNode } from "react";
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
