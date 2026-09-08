import { THEMES, isThemePref, setThemePref, useThemePref } from "../theme";

// Reads and writes the theme store directly, since the theme isn't review state; shows the stored
// *preference*, not the resolved theme, so "System" stays visibly selected.
export function ThemePicker() {
  const pref = useThemePref();
  return (
    <select
      aria-label="Theme"
      title="Color theme for this repository. System follows your OS between GitHub Dark and GitHub Light."
      value={pref}
      onChange={(e) => {
        const v = e.target.value;
        if (isThemePref(v)) setThemePref(v);
      }}
    >
      <option value="system">System</option>
      {THEMES.map((t) => (
        <option key={t.id} value={t.id}>
          {t.label}
        </option>
      ))}
    </select>
  );
}
