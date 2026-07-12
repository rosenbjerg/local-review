// SVG, not a ▸ glyph whose off-centre ink wobbles when rotated: this path's
// centroid sits at the viewBox centre (8,8) so `.chevron.open`'s 90° spin is clean.
export function Chevron({
  open,
  size = 12,
  className,
}: {
  open: boolean;
  size?: number;
  className?: string;
}) {
  return (
    <svg
      className={`chevron${open ? " open" : ""}${className ? ` ${className}` : ""}`}
      width={size}
      height={size}
      viewBox="0 0 16 16"
      aria-hidden="true"
    >
      <path d="M5 3L5 13L14 8Z" fill="currentColor" />
    </svg>
  );
}
