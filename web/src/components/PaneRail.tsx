import { IconChevronLeft, IconChevronRight } from "./icons";

// The stub a collapsed pane leaves behind: one full-height button carrying the
// pane's name set vertically, and the count it was showing. It exists so that
// collapsing doesn't hide the pane — the 6px resizer beside it is a hairline
// with nothing to say a panel is behind it — and so reopening is a click where
// the pane was rather than a trip to the toolbar. The chevron points the way the
// pane will grow.
export function PaneRail({
  label,
  count,
  side,
  onExpand,
}: {
  label: string;
  count?: number;
  side: "left" | "right";
  onExpand: () => void;
}) {
  return (
    <button
      className="pane-rail"
      aria-label={`Show ${label.toLowerCase()} panel`}
      aria-expanded={false}
      title={`Show ${label.toLowerCase()} (${side === "left" ? "[" : "]"})`}
      onClick={onExpand}
    >
      {side === "left" ? <IconChevronRight /> : <IconChevronLeft />}
      {/* Count above the name, not below it: the name is the part that gets
          clipped on a short window, and the number is the part worth keeping. */}
      {count != null && <span className="pane-rail-count">{count}</span>}
      <span className="pane-rail-label">{label}</span>
    </button>
  );
}
