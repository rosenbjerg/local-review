import { THEMES, isThemePref, setThemePref, useThemePref } from "../theme";

// The color-theme select in the settings modal. Reads and writes the theme store
// directly: the theme is a whole-app preference, not review state, so it doesn't
// pass through App the way the review's own controls do. It shows the stored *preference*, not the
// resolved theme — "System" has to stay visibly selected while it follows the OS.
export function ThemePicker() {
  const pref = useThemePref();
  return (
    <select
      aria-label="Theme"
      title="Color theme. System follows your OS between GitHub Dark and GitHub Light."
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
