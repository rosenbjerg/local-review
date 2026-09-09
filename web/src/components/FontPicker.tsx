import { useId } from "react";

import type { FontOffsetKey, FontState, FontFamilyKey } from "../fonts";
import {
  SANS_FACE,
  normalizeFamily,
  offsetOf,
  resetFonts,
  saveFontsAsDefault,
  setFontFamily,
  setFontOffset,
  useFonts,
} from "../fonts";
import { MAX_FONT_OFFSET, MIN_FONT_OFFSET } from "../storage";
import { themeOf, useTheme } from "../theme";

// Only Inter, Monaspace Neon and JetBrains Mono ship with the app; the rest are offered because
// they're common, and fall through to the theme's face when the machine hasn't got them.
const SUGGESTIONS: Record<FontFamilyKey, readonly string[]> = {
  monoFamily: [
    "Monaspace Neon",
    "JetBrains Mono",
    "ui-monospace",
    "SF Mono",
    "Menlo",
    "Consolas",
    "Fira Code",
    "IBM Plex Mono",
    "Cascadia Code",
    "Berkeley Mono",
  ],
  sansFamily: [
    "Inter",
    "system-ui",
    "Segoe UI",
    "Helvetica Neue",
    "IBM Plex Sans",
    "Source Sans 3",
    "Roboto",
  ],
};

function FontField({
  fontKey,
  label,
  value,
  fallback,
}: {
  fontKey: FontFamilyKey;
  label: string;
  value: string;
  fallback: string;
}) {
  const listId = useId();
  const invalid = value.trim() !== "" && normalizeFamily(value) === "";
  return (
    <div className="settings-row font-row">
      <span className="settings-label">{label}</span>
      <div className="font-field">
        <input
          className="font-input"
          list={listId}
          value={value}
          placeholder={fallback}
          aria-label={label}
          aria-invalid={invalid || undefined}
          spellCheck={false}
          onChange={(e) => setFontFamily(fontKey, e.target.value)}
        />
        <datalist id={listId}>
          {SUGGESTIONS[fontKey].map((f) => (
            <option key={f} value={f} />
          ))}
        </datalist>
        {invalid && <span className="font-invalid">Not a font family CSS understands</span>}
      </div>
    </div>
  );
}

// An offset, not a size, so the readout has to say which: a bare "0" would read as a font size.
function formatOffset(px: number): string {
  if (px === 0) return "Default";
  return px > 0 ? `+${px}px` : `\u2212${-px}px`;
}

function OffsetField({
  offsetKey,
  label,
  value,
}: {
  offsetKey: FontOffsetKey;
  label: string;
  value: number;
}) {
  return (
    <div className="settings-row font-row">
      <span className="settings-label">{label}</span>
      <div className="font-stepper">
        <button
          className="btn"
          aria-label={`Decrease ${label.toLowerCase()}`}
          disabled={value <= MIN_FONT_OFFSET}
          onClick={() => setFontOffset(offsetKey, value - 1)}
        >
          {"\u2212"}
        </button>
        <span className="font-offset">{formatOffset(value)}</span>
        <button
          className="btn"
          aria-label={`Increase ${label.toLowerCase()}`}
          disabled={value >= MAX_FONT_OFFSET}
          onClick={() => setFontOffset(offsetKey, value + 1)}
        >
          +
        </button>
      </div>
    </div>
  );
}

// Reads and writes the font store directly, like ThemePicker: the fields hold this repo's own picks,
// and the placeholder names what an empty one falls back to — the default across repos, or the face
// the current theme brings.
export function FontPicker() {
  const state: FontState = useFonts();
  const { own, inherited } = state;
  const theme = useTheme();
  const customised = Object.keys(own).length > 0;
  return (
    <>
      <FontField
        fontKey="monoFamily"
        label="Code font"
        value={own.monoFamily ?? ""}
        fallback={inherited.monoFamily ?? themeOf(theme).mono}
      />
      <OffsetField
        offsetKey="monoOffset"
        label="Code font size"
        value={offsetOf(state, "monoOffset")}
      />
      <FontField
        fontKey="sansFamily"
        label="Interface font"
        value={own.sansFamily ?? ""}
        fallback={inherited.sansFamily ?? SANS_FACE}
      />
      <OffsetField
        offsetKey="sansOffset"
        label="Interface font size"
        value={offsetOf(state, "sansOffset")}
      />
      <p className="settings-note">
        Inter, Monaspace Neon and JetBrains Mono ship with local-review. Anything else has to be
        installed on this machine, and falls back to the theme's face when it isn't.
      </p>
      <div className="settings-actions">
        <button className="btn" onClick={resetFonts} disabled={!customised}>
          Reset
        </button>
        <button
          className="btn"
          onClick={saveFontsAsDefault}
          disabled={!customised}
          title="Use these fonts in every repo, replacing any fonts other repos have been given"
        >
          Set as default for all repos
        </button>
      </div>
    </>
  );
}
