// The segmented control used for the diff Changed/Full switch, the SVG
// Text/Image switch, and the export Preview/Raw switch. Each option is a button
// that reflects `active`/`aria-pressed`; the group carries an aria-label. Kept
// generic over the value type so callers pass their own string unions.
export function ViewToggle<T extends string>({
  value,
  options,
  onChange,
  ariaLabel,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
  ariaLabel: string;
}) {
  return (
    <div className="view-toggle" role="group" aria-label={ariaLabel}>
      {options.map((o) => (
        <button
          key={o.value}
          className={value === o.value ? "active" : ""}
          aria-pressed={value === o.value}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
