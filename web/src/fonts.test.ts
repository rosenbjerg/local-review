import { expect, test, vi } from "vitest";

import {
  codeLigaturesOn,
  firstFamilyOf,
  isFamilyAvailable,
  ligatureSetsFor,
  nearestFamily,
  normalizeFamily,
  normalizeName,
  quoteFamily,
  resetFonts,
  saveFontsAsDefault,
  setFontFamily,
  setCodeLigatures,
  setLigatureSet,
  setFontOffset,
  setFontsRepo,
} from "./fonts";
import { FACE_FEATURES } from "./fontFeatures";
import { DEFAULT_PREF, setThemePref } from "./theme";
import { LS, MAX_FONT_OFFSET, MIN_FONT_OFFSET } from "./storage";

const token = (name: string) => document.documentElement.style.getPropertyValue(name);
const mono = () => token("--font-mono");
const sans = () => token("--font-sans");

// A custom property would happily hold a broken family and only fail where it's used, taking every
// font in the app down to the browser's default with it.
test("a family is taken only when CSS would accept it", () => {
  expect(normalizeFamily("  Berkeley Mono  ")).toBe("Berkeley Mono");
  expect(normalizeFamily('"Fira Code", monospace')).toBe('"Fira Code", monospace');
  expect(normalizeFamily('Bad"')).toBe("");
  expect(normalizeFamily("Inter; color: red")).toBe("");
  expect(normalizeFamily("")).toBe("");
});

// With no family override the code face is the theme's, so the features have to follow a theme
// switch — the one edge between the two stores. Runs before anything promotes a face to the default
// across repos, which is what "nothing overrides it" needs.
test("the code face follows the theme when nothing overrides it", () => {
  setFontsRepo("/repo-theme");
  setCodeLigatures(true);
  setThemePref("github-dark");
  expect(token("--code-features")).toContain('"ss03" 1');

  setThemePref("darcula");
  expect(token("--code-features")).toBe("");
  setThemePref(DEFAULT_PREF);
});

test("an override paints the token over the theme's, and clearing removes it again", () => {
  setFontsRepo("/repo-a");
  setFontFamily("monoFamily", "Berkeley Mono");
  expect(mono()).toBe("Berkeley Mono, var(--mono-fallback)");

  // Typed but not yet valid: the field keeps it, the token doesn't take it.
  setFontFamily("monoFamily", 'Berkeley Mono"');
  expect(mono()).toBe("");

  setFontFamily("monoFamily", "");
  expect(mono()).toBe("");
});

// Clearing has to remove the property rather than write the theme's face back inline, or the next
// theme switch would leave the old face pinned.
test("a pick belongs to its repo until it is made the default, which clears the others", () => {
  setFontsRepo("/repo-b");
  setFontFamily("monoFamily", "Fira Code");
  setFontsRepo("/repo-c");
  expect(mono()).toBe("");

  setFontsRepo("/repo-b");
  saveFontsAsDefault();
  expect(JSON.parse(localStorage.getItem(LS.fonts)!)).toEqual({ monoFamily: "Fira Code" });
  expect(JSON.parse(localStorage.getItem(LS.fontsByRepo)!)).toEqual({});

  setFontsRepo("/repo-c");
  expect(mono()).toBe("Fira Code, var(--mono-fallback)");
});

test("reset drops this repo's picks field by field, leaving the default standing", () => {
  setFontsRepo("/repo-d");
  setFontFamily("sansFamily", "IBM Plex Sans");
  expect(sans()).toBe("IBM Plex Sans, var(--sans-fallback)");

  resetFonts();
  expect(sans()).toBe("");
  expect(mono()).toBe("Fira Code, var(--mono-fallback)");
});

// A size pick is an offset, so 0 has to be storable: "this repo stays put though the default moved"
// is a real choice, and Reset is the way back to inheriting.
test("a size offset paints in px, and a zero is a pick rather than an absence", () => {
  setFontsRepo("/repo-e");
  setFontOffset("monoOffset", 2);
  expect(token("--mono-offset")).toBe("2px");

  saveFontsAsDefault();
  setFontsRepo("/repo-f");
  expect(token("--mono-offset")).toBe("2px");

  setFontOffset("monoOffset", 0);
  expect(token("--mono-offset")).toBe("");
  expect(JSON.parse(localStorage.getItem(LS.fontsByRepo)!)["/repo-f"]).toEqual({ monoOffset: 0 });

  resetFonts();
  expect(token("--mono-offset")).toBe("2px");
});

test("an offset is clamped to a range the layout survives", () => {
  setFontsRepo("/repo-g");
  setFontOffset("monoOffset", 99);
  expect(token("--mono-offset")).toBe(`${MAX_FONT_OFFSET}px`);
  setFontOffset("monoOffset", -99);
  expect(token("--mono-offset")).toBe(`${MIN_FONT_OFFSET}px`);
});

// The interface scale is one offset over seven steps, so the whole UI moves together rather than the
// body text drifting away from the labels beside it.
test("the interface offset is a separate axis from the code one", () => {
  setFontsRepo("/repo-h");
  const code = token("--mono-offset");
  setFontOffset("sansOffset", 1);
  expect(token("--sans-offset")).toBe("1px");
  expect(token("--mono-offset")).toBe(code);

  setFontOffset("monoOffset", 3);
  expect(token("--sans-offset")).toBe("1px");
  expect(token("--mono-offset")).toBe("3px");
});

test("a family list is split into head and quoted for the probe", () => {
  expect(firstFamilyOf('"Fira Code", monospace')).toBe("Fira Code");
  expect(firstFamilyOf("Menlo")).toBe("Menlo");
  expect(quoteFamily("SF Mono")).toBe('"SF Mono"');
  expect(quoteFamily("ui-monospace")).toBe("ui-monospace");
});

// CSS.supports only parses, so it says yes to Consolas on a Mac. Availability is whether the metrics
// move off the generic behind the face — which is why the probe asks the canvas, not the parser.
test("a face counts as available only when it changes the measured text", () => {
  const ctx = {
    font: "",
    measureText: () => ({ width: ctx.font.includes('"Fira Code"') ? 200 : 100 }),
  };
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(
    ctx as unknown as CanvasRenderingContext2D
  );

  expect(isFamilyAvailable("Fira Code")).toBe(true);
  expect(isFamilyAvailable("Consolas")).toBe(false);
  expect(isFamilyAvailable("ui-monospace")).toBe(true);
  expect(isFamilyAvailable("")).toBe(false);
});

// `calt` carries the ligatures in JetBrains Mono and Fira Code, but texture healing in Monaspace, so
// one switch can only mean the same thing for both if it knows which face it is turning off.
test("turning ligatures off spares Monaspace's texture healing", () => {
  setFontsRepo("/repo-i");
  setFontFamily("monoFamily", "JetBrains Mono");
  setCodeLigatures(false);
  expect(token("--code-features")).toContain('"calt" 0');
  expect(token("--code-features")).toContain('"liga" 0');

  setFontFamily("monoFamily", "Monaspace Neon");
  expect(token("--code-features")).toContain('"liga" 0');
  expect(token("--code-features")).not.toContain("calt");
});

// Monaspace keeps its ligatures in opt-in stylistic sets, so left alone it shows eight where
// JetBrains Mono shows its whole set — the same code rendering differently per theme.
test("turning them on levels Monaspace up and leaves other faces to their defaults", () => {
  setFontsRepo("/repo-j");
  setFontFamily("monoFamily", "Monaspace Neon");
  setCodeLigatures(true);
  expect(token("--code-features")).toContain('"ss09" 1');

  setFontFamily("monoFamily", "JetBrains Mono");
  expect(token("--code-features")).toBe("");
});

// The names come out of the font's own FeatureParams (fontFeatures.ts, regenerated by
// `bun scripts/fontfeatures.ts`), so a label can say Arrows without anyone having written it down.
// A Monaspace upgrade that renumbers a set fails here rather than mislabelling a checkbox.
test("a ligature set is named by the face it belongs to", () => {
  const sets = ligatureSetsFor("Monaspace Neon");
  expect(sets).toContainEqual({ tag: "ss03", name: "Arrows" });
  expect(sets).toContainEqual({ tag: "ss01", name: "Equal Symbols" });
  // ss06 is Markdown Strings, which is not what ligatures-on means.
  expect(sets.map((s) => s.tag)).not.toContain("ss06");
  // Argon and the rest aren't bundled, but the family shares Neon's layout.
  expect(ligatureSetsFor("Monaspace Argon")).toEqual(sets);
  // Every other face keeps its ligatures in one calt, addressable only as a whole.
  expect(ligatureSetsFor("JetBrains Mono")).toEqual([]);
  expect(ligatureSetsFor("Fira Code")).toEqual([]);
});

// Unchecking one group has to remove those ligatures, and `liga` is a source in its own right — its
// lookups are disjoint from every stylistic set's, so left on it would go on drawing the arrow that
// was just switched off. It stays untouched while every group is on, so the default is unchanged.
test("switching one group off silences the face's own default ligatures too", () => {
  setFontsRepo("/repo-groups");
  setFontFamily("monoFamily", "Monaspace Neon");
  setCodeLigatures(true);
  const all = token("--code-features");
  expect(all).toContain('"ss03" 1');
  expect(all).not.toContain("liga");

  setLigatureSet("ss03", false);
  const some = token("--code-features");
  expect(some).not.toContain('"ss03" 1');
  expect(some).toContain('"ss09" 1');
  expect(some).toContain('"liga" 0');

  // Back on, and the value returns to the one a switch nobody touched produces.
  setLigatureSet("ss03", true);
  expect(token("--code-features")).toBe(all);
});

// Every group off is the same rendering as the switch being off, not the bare face with its own
// defaults showing through — which is what an empty feature list would have meant.
test("turning every group off reads as ligatures off", () => {
  setFontsRepo("/repo-groups-none");
  setFontFamily("monoFamily", "Monaspace Neon");
  setCodeLigatures(true);
  for (const { tag } of ligatureSetsFor("Monaspace Neon")) setLigatureSet(tag, false);
  const none = token("--code-features");
  expect(none).toContain('"liga" 0');
  expect(none).not.toContain('" 1');
  // Monaspace's calt is texture healing, so it survives however the groups are set.
  expect(none).not.toContain("calt");
});

// The tags are Monaspace's, so they must not follow the reader onto a face that numbers its sets
// differently — but they have to still be there when the theme brings Monaspace back.
test("a group picked under one face is dormant, not lost, under another", () => {
  setFontsRepo("/repo-groups-face");
  setFontFamily("monoFamily", "Monaspace Neon");
  setCodeLigatures(true);
  setLigatureSet("ss03", false);

  setFontFamily("monoFamily", "JetBrains Mono");
  expect(token("--code-features")).toBe("");

  setFontFamily("monoFamily", "Monaspace Neon");
  expect(token("--code-features")).not.toContain('"ss03" 1');
  expect(token("--code-features")).toContain('"ss01" 1');
});

// Why the token may never reach a sans surface: the same tags Monaspace uses for ligatures are, in
// the face the interface is drawn in, a ring and a box around every capital and digit.
test("a stylistic set tag means something else in Inter", () => {
  const inter = new Map(FACE_FEATURES["Inter"].named.map((f) => [f.tag, f.name]));
  expect(inter.get("ss05")).toBe("Circled characters");
  expect(inter.get("ss06")).toBe("Squared characters");
});

// The family really is "JetBrainsMono Nerd Font" — the spacing anyone would type doesn't resolve,
// and CSS gives no hint about it, so the picker has to.
test("a name that is only mis-spaced still finds the face it meant", () => {
  const choices = ["JetBrainsMono Nerd Font", "Monaspace Neon", "Menlo"];
  expect(normalizeName("JetBrains Mono Nerd Font")).toBe(normalizeName("JetBrainsMono Nerd Font"));
  expect(nearestFamily("JetBrains Mono Nerd Font", choices)).toBe("JetBrainsMono Nerd Font");
  expect(nearestFamily("Menlp", choices)).toBe("Menlo");
  expect(nearestFamily("Comic Sans", choices)).toBe("");
  expect(nearestFamily("SF", choices)).toBe("");
});
