// A segmented control: one button per value, the current one filled.
export function ViewToggle<T extends string>({
  value,
  options,
  onChange,
  ariaLabel,
  disabled,
}: {
  value: T;
  // Per-option `disabled` is for a value that would do nothing now; give it a `title` saying why.
  options: { value: T; label: string; title?: string; disabled?: boolean }[];
  onChange: (value: T) => void;
  ariaLabel: string;
  // Disables the whole group, for a control with only one valid value left.
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
