// A segmented control: one button per value, the current one filled. Data-driven so
// the several places that need one (Changed/Full, Text/Image, Code/Rendered,
// Preview/Raw, the diff's committed/staged/working-tree side) share the chrome.
export function ViewToggle<T extends string>({
  value,
  options,
  onChange,
  ariaLabel,
  disabled,
}: {
  value: T;
  // A per-option `disabled` is for a value that would do nothing in the current
  // selection (Committed, when the base resolves to head — an empty range by
  // construction); give it a `title` saying why, since a dimmed option with no
  // explanation reads as a bug.
  options: { value: T; label: string; title?: string; disabled?: boolean }[];
  onChange: (value: T) => void;
  ariaLabel: string;
  // Disables the whole group, for a control with only one valid value left — the
  // side toggle when head isn't the checked-out branch.
  disabled?: boolean;
}) {
  return (
    <div className="view-toggle" role="group" aria-label={ariaLabel}>
      {options.map((o) => (
        <button
          key={o.value}
          className={value === o.value ? "active" : ""}
          aria-pressed={value === o.value}
          disabled={disabled || o.disabled}
          title={o.title}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
