import type { ReactNode } from "react";

// The shape every empty state takes: a large, faint icon over a one-line statement
// of what isn't there, then a hint saying what to do about it — so a pane with
// nothing in it reads as a state the app is in rather than as a failure to render.
//
// No action button in any of them, deliberately: every control these states point at
// (the branch pickers, the diff side, Reload) already lives in the toolbar, and a
// second copy down here would be a second way to do the same thing.
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
