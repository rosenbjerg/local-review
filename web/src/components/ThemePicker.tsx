import type { ComboOption } from "./Combobox";
import { Combobox } from "./Combobox";
import { THEMES, isThemePref, resolveTheme, setThemePref, useThemePref } from "../theme";

// Reads and writes the theme store directly, since the theme isn't review state; shows the stored
// *preference*, not the resolved theme, so "System" stays visibly selected. Every row carries its own
// theme id, which is what paints it in that theme's colours.
export function ThemePicker() {
  const pref = useThemePref();
  const options: ComboOption[] = [
    { value: "system", label: "System", hint: "follows your OS", swatch: resolveTheme("system") },
    ...THEMES.map((t) => ({ value: t.id, label: t.label, swatch: t.id })),
  ];
  return (
    <Combobox
      ariaLabel="Theme"
      value={pref}
      options={options}
      floating
      onChange={(v) => {
        if (isThemePref(v)) setThemePref(v);
      }}
    />
  );
}
