import { THEMES, isThemeId, setTheme, useTheme } from "../theme";

// The color-theme select in the toolbar. Reads and writes the theme store directly:
// the theme is a whole-app preference, not review state, so it doesn't pass through
// App like the pickers around it do.
export function ThemePicker() {
  const theme = useTheme();
  return (
    <select
      aria-label="Theme"
      title="Color theme"
      value={theme}
      onChange={(e) => {
        const v = e.target.value;
        if (isThemeId(v)) setTheme(v);
      }}
    >
      {THEMES.map((t) => (
        <option key={t.id} value={t.id}>
          {t.label}
        </option>
      ))}
    </select>
  );
}
