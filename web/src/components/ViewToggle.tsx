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
  options: { value: T; label: string; title?: string }[];
  onChange: (value: T) => void;
  ariaLabel: string;
  // Disables the whole group, for a control that has only one valid value left
  // (the side toggle when head isn't the checked-out branch) — never per option,
  // so the group can't present a choice that does nothing.
  disabled?: boolean;
}) {
  return (
    <div className="view-toggle" role="group" aria-label={ariaLabel}>
      {options.map((o) => (
        <button
          key={o.value}
          className={value === o.value ? "active" : ""}
          aria-pressed={value === o.value}
          disabled={disabled}
          title={o.title}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
