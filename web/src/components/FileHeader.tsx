import type { FileStatus } from "../types";
import { Chevron } from "./Chevron";
import { CommentCount } from "./CommentCount";
import { ViewToggle } from "./ViewToggle";

interface Props {
  status: FileStatus;
  path: string;
  collapsed: boolean;
  onToggleCollapsed: () => void;
  openCount: number;
  reviewed: boolean;
  onToggleReviewed: (reviewed: boolean) => void;
  svg: boolean;
  svgAsImage: boolean;
  onSvgAsImage: (asImage: boolean) => void;
  showModeToggle: boolean;
  mode: "changed" | "full";
  onSwitchMode: (mode: "changed" | "full") => void;
}

// The file card's header row: collapse toggle, status + path, comment count,
// reviewed checkbox, and the SVG (Text/Image) and diff (Changed/Full) toggles.
export function FileHeader({
  status,
  path,
  collapsed,
  onToggleCollapsed,
  openCount,
  reviewed,
  onToggleReviewed,
  svg,
  svgAsImage,
  onSvgAsImage,
  showModeToggle,
  mode,
  onSwitchMode,
}: Props) {
  return (
    <div className="file-header">
      <button
        className="file-toggle"
        onClick={onToggleCollapsed}
        aria-expanded={!collapsed}
        aria-label={collapsed ? "Expand file" : "Collapse file"}
        title={collapsed ? "Expand file" : "Collapse file"}
      >
        <Chevron open={!collapsed} />
      </button>
      <span className={`status status-${status}`}>{status}</span>
      <span className="file-path" title={path}>
        {path}
      </span>
      {openCount > 0 && <CommentCount n={openCount} />}
      <label className="viewed-check" title="Mark file as reviewed">
        <input type="checkbox" checked={reviewed} onChange={(e) => onToggleReviewed(e.target.checked)} />
        Reviewed
      </label>
      {svg && (
        <ViewToggle
          ariaLabel="SVG view"
          value={svgAsImage ? "image" : "text"}
          onChange={(v) => onSvgAsImage(v === "image")}
          options={[
            { value: "text", label: "Text" },
            { value: "image", label: "Image" },
          ]}
        />
      )}
      {showModeToggle && (
        <ViewToggle
          ariaLabel="Diff view"
          value={mode}
          onChange={onSwitchMode}
          options={[
            { value: "changed", label: "Changed" },
            { value: "full", label: "Full" },
          ]}
        />
      )}
    </div>
  );
}
