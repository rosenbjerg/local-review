import type { ReactNode } from "react";

// The shape every empty state takes: a large faint icon, a one-line statement, a hint.
// No action button, deliberately: every control these point at already lives in the toolbar.
export function EmptyState({
  icon,
  title,
  hint,
}: {
  icon: ReactNode;
  title: string;
  hint: string;
}) {
  return (
    <div className="empty">
      <div className="empty-icon" aria-hidden="true">
        {icon}
      </div>
      <p className="empty-title">{title}</p>
      <p className="empty-hint">{hint}</p>
    </div>
  );
}
