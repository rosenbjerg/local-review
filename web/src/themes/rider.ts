import type { ThemeRegistrationRaw } from "shiki/core";

// JetBrains Rider's editor schemes — "Rider Dark" and "Rider Light", the pair its New
// UI themes (Rider Night / Rider Day) name — as TextMate themes. Taken from
// JetBrains/rider-theme-pack, the plugin bundled with Rider, so these are the colors
// the IDE actually paints.
//
// Rider is *not* IntelliJ's scheme with different greys: it is Visual Studio's palette
// wearing JetBrains' chrome. Keywords are blue rather than orange, comments green
// rather than grey, numbers pink, strings tan. Two consequences for the scope map
// below, both of which the IntelliJ schemes don't have. Rider colors **types**
// (DEFAULT_CLASS_NAME / _REFERENCE / _INTERFACE_NAME, all #C191FF) where IntelliJ leaves
// them at the default text color — so a `type` role exists here and is what makes C#
// and TypeScript read as Rider rather than as a generic dark theme. And it colors a
// function **call** exactly as it colors a declaration (DEFAULT_FUNCTION_CALL ==
// DEFAULT_FUNCTION_DECLARATION), so the call scopes join that rule rather than falling
// through to plain text.
//
// One scope map, two color records: the two schemes assign identical roles and differ
// only in the values, so a shared builder is what stops the pair drifting apart.
interface Scheme {
  text: string;
  bg: string;
  comment: string;
  docTag: string;
  keyword: string;
  string: string;
  escape: string;
  number: string;
  func: string;
  field: string;
  type: string;
  entity: string;
  attr: string;
  link: string;
  error: string;
}

const dark: Scheme = {
  text: "#bdbdbd",
  bg: "#262626",
  comment: "#85c46c",
  docTag: "#487d34",
  keyword: "#6c95eb",
  string: "#c9a26d",
  escape: "#d688d4",
  number: "#ed94c0",
  func: "#39cc9b",
  field: "#66c3cc",
  type: "#c191ff",
  entity: "#ffd49e",
  attr: "#85c46c",
  link: "#6c95eb",
  error: "#ff5647",
};

const light: Scheme = {
  text: "#383838",
  bg: "#ffffff",
  comment: "#248700",
  docTag: "#8bc775",
  keyword: "#0f54d6",
  string: "#8c6c41",
  escape: "#941290",
  number: "#ab2f6b",
  func: "#00855f",
  field: "#0093a1",
  type: "#6b2fba",
  entity: "#635237",
  attr: "#248700",
  link: "#0f54d6",
  error: "#d91400",
};

function scheme(
  name: string,
  displayName: string,
  type: "dark" | "light",
  c: Scheme
): ThemeRegistrationRaw {
  return {
    name,
    displayName,
    type,
    colors: { "editor.background": c.bg, "editor.foreground": c.text },
    settings: [
      { settings: { foreground: c.text, background: c.bg } },
      // Both schemes set FONT_TYPE 2 on every comment attribute.
      {
        scope: ["comment", "punctuation.definition.comment"],
        settings: { foreground: c.comment, fontStyle: "italic" },
      },
      // Doc tags (@param, {@link}) — the keyword rules below must not reach them.
      {
        scope: [
          "comment keyword",
          "comment storage.type",
          "comment entity.name.type",
          "comment variable",
        ],
        settings: { foreground: c.docTag, fontStyle: "" },
      },
      {
        scope: [
          "keyword",
          "storage",
          "storage.type",
          "storage.modifier",
          "variable.language",
          "constant.language",
          "support.type.primitive",
          "support.type.builtin",
          "keyword.operator.new",
          "keyword.operator.expression",
          "keyword.operator.word",
          "keyword.operator.logical.python",
          "keyword.control.directive",
          "meta.preprocessor",
          "entity.name.function.preprocessor",
          "entity.name.tag.yaml",
        ],
        settings: { foreground: c.keyword },
      },
      // DEFAULT_OPERATION_SIGN, _BRACES, _PARENTHS, _COMMA, _DOT, _SEMICOLON and
      // _PARAMETER / _LOCAL_VARIABLE all take DEFAULT_IDENTIFIER's grey in both schemes.
      {
        scope: ["keyword.operator", "storage.type.function.arrow"],
        settings: { foreground: c.text },
      },
      {
        scope: ["string", "constant.character", "string.regexp"],
        settings: { foreground: c.string },
      },
      { scope: ["constant.character.escape"], settings: { foreground: c.escape } },
      { scope: ["constant.numeric", "keyword.other.unit"], settings: { foreground: c.number } },
      // A call and a declaration share one color here, unlike the IntelliJ schemes.
      // fontStyle "" is an explicit reset: a `const f = () =>` is also
      // variable.other.constant, which would otherwise lend the name its bold.
      {
        scope: [
          "entity.name.function",
          "entity.name.function.member",
          "meta.function-call entity.name.function",
          "variable.function",
          "support.function",
        ],
        settings: { foreground: c.func, fontStyle: "" },
      },
      // Types are colored, which is the loudest single difference from Darcula and the
      // New UI schemes. support.type.primitive stays a keyword: it is a longer selector
      // than support.type, so it wins on specificity rather than on rule order.
      {
        scope: [
          "entity.name.type",
          "entity.name.class",
          "entity.other.inherited-class",
          "support.class",
          "support.type",
        ],
        settings: { foreground: c.type },
      },
      {
        scope: [
          "variable.other.property",
          "variable.object.property",
          "variable.other.member",
          "variable.other.object.property",
          "support.variable.property",
          "meta.object-literal.key",
          "entity.name.variable.field",
          "support.type.property-name.json",
        ],
        settings: { foreground: c.field },
      },
      // DEFAULT_CONSTANT is FONT_TYPE 1 — bold, where the IntelliJ schemes italicize it.
      {
        scope: ["variable.other.constant", "constant.other.caps"],
        settings: { foreground: c.field, fontStyle: "bold" },
      },
      // DEFAULT_METADATA shares DEFAULT_CLASS_NAME's color in both schemes.
      {
        scope: [
          "meta.annotation",
          "storage.type.annotation",
          "punctuation.definition.annotation",
          "entity.name.function.decorator",
          "meta.decorator",
          "punctuation.decorator",
          "meta.attribute.rust",
          "meta.attribute.cs",
        ],
        settings: { foreground: c.type },
      },
      { scope: ["entity.name.tag", "punctuation.definition.tag"], settings: { foreground: c.type } },
      { scope: ["entity.other.attribute-name"], settings: { foreground: c.attr } },
      {
        scope: ["meta.tag string", "string.quoted.double.html", "string.quoted.single.html"],
        settings: { foreground: c.string },
      },
      {
        scope: [
          "entity.other.attribute-name.class.css",
          "entity.other.attribute-name.id.css",
          "entity.other.attribute-name.pseudo-class.css",
        ],
        settings: { foreground: c.func },
      },
      {
        scope: ["support.constant.property-value.css", "meta.property-value.css"],
        settings: { foreground: c.string },
      },
      { scope: ["constant.character.entity"], settings: { foreground: c.entity } },
      { scope: ["markup.underline.link", "string.other.link"], settings: { foreground: c.link } },
      {
        scope: ["markup.heading", "entity.name.section.markdown", "markup.bold"],
        settings: { fontStyle: "bold" },
      },
      { scope: ["markup.italic"], settings: { fontStyle: "italic" } },
      { scope: ["markup.inline.raw", "markup.raw"], settings: { foreground: c.string } },
      { scope: ["invalid", "invalid.illegal"], settings: { foreground: c.error } },
    ],
  };
}

export const riderNight = scheme("rider-night", "JetBrains Rider Night", "dark", dark);
export const riderDay = scheme("rider-day", "JetBrains Rider Day", "light", light);
