// Disclosure triangle for the file tree and diff toggle. Drawn as SVG, not a ▸
// glyph, whose ink sits off-centre and wobbles when rotated; here the centroid
// is at the viewBox centre (8,8) so it spins cleanly. Points right when closed;
// `.chevron.open` rotates it 90° down.
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
