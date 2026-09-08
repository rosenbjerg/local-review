import { IconChevronLeft, IconChevronRight } from "./icons";

// The stub a collapsed pane leaves behind, so collapsing never hides the way back; the chevron
// points the way the pane will grow.
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
      {/* Count above the name: the name is the part that gets clipped on a short window. */}
      {count != null && <span className="pane-rail-count">{count}</span>}
      <span className="pane-rail-label">{label}</span>
    </button>
  );
}
