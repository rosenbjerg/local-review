import type { FontOffsetKey, FontState, FontFamilyKey } from "../fonts";
import {
  SANS_FACE,
  codeLigaturesOn,
  firstFamilyOf,
  isFamilyAvailable,
  nearestFamily,
  normalizeFamily,
  offsetOf,
  resetFonts,
  saveFontsAsDefault,
  setCodeLigatures,
  setFontFamily,
  setFontOffset,
  useFonts,
} from "../fonts";
import { MAX_FONT_OFFSET, MIN_FONT_OFFSET } from "../storage";
import { FontCombobox } from "./FontCombobox";
import { themeOf, useTheme } from "../theme";

// Shipped with the app, so they're offered whatever the machine has — and a face the current theme
// isn't using may not be loaded yet, which would make the probe below call it missing.
const BUNDLED: Record<FontFamilyKey, readonly string[]> = {
  monoFamily: ["Monaspace Neon", "JetBrains Mono", "ui-monospace"],
  sansFamily: ["Inter", "system-ui"],
};

// Probed against this machine before being offered: half of these are platform-specific, and a list
// that offers a Mac Consolas or a Windows SF Mono is worse than a shorter one.
const CANDIDATES: Record<FontFamilyKey, readonly string[]> = {
  monoFamily: [
    // Platform faces first: on any given machine most of the rest of this list probes away.
    "SF Mono",
    "Menlo",
    "Monaco",
    "Andale Mono",
    "Courier New",
    "Consolas",
    "Lucida Console",
    "Cascadia Code",
    "Cascadia Mono",
    "DejaVu Sans Mono",
    "Liberation Mono",
    "Bitstream Vera Sans Mono",
    "Ubuntu Mono",
    // Patched builds register under their own family names, so a base name never finds them.
    "MesloLGS NF",
    "Meslo LG S",
    "JetBrainsMono Nerd Font",
    "FiraCode Nerd Font",
    "Hack Nerd Font",
    "CaskaydiaCove Nerd Font",
    "SauceCodePro Nerd Font",
    "Fira Code",
    "Fira Mono",
    "Source Code Pro",
    "IBM Plex Mono",
    "Roboto Mono",
    "Noto Sans Mono",
    "Red Hat Mono",
    "Inconsolata",
    "Hack",
    // Iosevka usually installs per variant rather than under the bare family name.
    "Iosevka",
    "Iosevka Term",
    "Iosevka Fixed",
    "Victor Mono",
    "Geist Mono",
    "Commit Mono",
    "Maple Mono",
    "Intel One Mono",
    "0xProto",
    "Martian Mono",
    "JuliaMono",
    "Lilex",
    "Fantasque Sans Mono",
    "Recursive Mono",
    "Anonymous Pro",
    "PT Mono",
    "Space Mono",
    "Go Mono",
    "Overpass Mono",
    "Monaspace Argon",
    "Monaspace Xenon",
    "Monaspace Radon",
    "Monaspace Krypton",
    // Paid, but bought often enough to be worth a probe.
    "MonoLisa",
    "Berkeley Mono",
    "TX-02",
    "Dank Mono",
    "Operator Mono",
    "PragmataPro",
    "Input Mono",
    "Comic Code",
    "Cartograph CF",
  ],
  sansFamily: [
    "SF Pro",
    "SF Pro Text",
    "SF Pro Display",
    "Helvetica Neue",
    "Helvetica",
    "Avenir Next",
    "Segoe UI Variable",
    "Segoe UI",
    "Calibri",
    "Verdana",
    "Tahoma",
    "Trebuchet MS",
    "Arial",
    "Liberation Sans",
    "DejaVu Sans",
    "Cantarell",
    "Ubuntu",
    "Roboto",
    "Noto Sans",
    // Tuned for reading rather than for looks, which is what this chrome is for.
    "Atkinson Hyperlegible",
    "Lexend",
    "Inter Tight",
    "Inter Display",
    "Source Sans 3",
    "Source Sans Pro",
    "IBM Plex Sans",
    "Fira Sans",
    "PT Sans",
    "Public Sans",
    "Open Sans",
    "Lato",
    "Work Sans",
    "Manrope",
    "Plus Jakarta Sans",
    "Figtree",
    "Nunito Sans",
    "Rubik",
    "Karla",
    "Barlow",
    "Montserrat",
    "Poppins",
    "Geist",
  ],
};

function installedFor(fontKey: FontFamilyKey): string[] {
  return CANDIDATES[fontKey].filter(isFamilyAvailable);
}

function FontField({
  fontKey,
  label,
  value,
  fallback,
  inherited,
  sample,
}: {
  fontKey: FontFamilyKey;
  label: string;
  value: string;
  fallback: string;
  inherited: boolean;
  sample?: string;
}) {
  const invalid = value.trim() !== "" && normalizeFamily(value) === "";
  const head = invalid ? "" : firstFamilyOf(value);
  const missing = head !== "" && !isFamilyAvailable(head);
  const installed = installedFor(fontKey);
  // A face CSS can't resolve is nearly always the right one under a name it isn't registered by.
  const nearest = missing ? nearestFamily(head, [...BUNDLED[fontKey], ...installed]) : "";
  return (
    <div className="settings-row font-row">
      <span className="settings-label">{label}</span>
      <div className="font-field">
        <FontCombobox
          label={label}
          value={value}
          fallback={fallback}
          fallbackLabel={
            inherited ? "Default for all repos" : fontKey === "monoFamily" ? "Theme default" : "Default"
          }
          bundled={BUNDLED[fontKey]}
          installed={installed}
          fallbackVar={fontKey === "monoFamily" ? "--mono-fallback" : "--sans-fallback"}
          sample={sample}
          onChange={(v) => setFontFamily(fontKey, v)}
        />
        {invalid && <span className="font-invalid">Not a font family CSS understands</span>}
        {missing && (
          <span className="font-missing">
            {head} isn&apos;t installed on this machine
            {nearest && (
              <>
                {" \u2014 "}
                <button
                  type="button"
                  className="font-suggest"
                  // Keeps focus off this button, so the field it is about doesn't blur under the click.
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => setFontFamily(fontKey, nearest)}
                >
                  use {nearest}?
                </button>
              </>
            )}
          </span>
        )}
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
        inherited={inherited.monoFamily !== undefined}
        sample="0O1lI"
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
        inherited={inherited.sansFamily !== undefined}
      />
      <OffsetField
        offsetKey="sansOffset"
        label="Interface font size"
        value={offsetOf(state, "sansOffset")}
      />
      <div className="settings-row font-row">
        <span className="settings-label">Code ligatures</span>
        <input
          type="checkbox"
          aria-label="Code ligatures"
          title="Arrows and comparisons drawn as one glyph. Off shows the literal characters."
          checked={codeLigaturesOn(state)}
          onChange={(e) => setCodeLigatures(e.target.checked)}
        />
      </div>
      <p className="settings-note">
        Inter, Monaspace Neon and JetBrains Mono ship with local-review; the rest of each list is what
        this machine turned out to have. Any other installed face can be typed in.
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
