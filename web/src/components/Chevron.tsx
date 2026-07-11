// The single disclosure triangle used by both the file tree and the diff file
// toggle. Drawn as SVG rather than a text ▸ glyph: a glyph's ink sits
// off-centre in its box, so it wobbles when rotated. Here the triangle's
// centroid is at the viewBox centre (8,8), so rotating the whole svg about its
// centre spins it cleanly in place. Points right when closed; the .chevron
// class rotates it 90° down when `open`.
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
