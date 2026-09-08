import type { ThemeRegistrationRaw } from "shiki/core";

// The platform's New UI schemes "Dark"/"Light" (expUI_darkScheme.xml / expUI_lightScheme.xml in intellij-community),
// which WebStorm ships unchanged — there is no WebStorm-specific source to match. One scope map, two color records.
interface Scheme {
  text: string;
  bg: string;
  comment: string;
  // Only the Light scheme sets FONT_TYPE 2 on its comments.
  commentStyle: "" | "italic";
  docComment: string;
  docTag: string;
  keyword: string;
  string: string;
  // JS.REGEXP — the one JS.* attribute that lands on a scope the grammars reliably emit; the rest stay unmapped.
  regexp: string;
  escape: string;
  number: string;
  func: string;
  field: string;
  annotation: string;
  tag: string;
  attr: string;
  attrValue: string;
  entity: string;
  link: string;
  error: string;
}

const dark: Scheme = {
  text: "#bcbec4",
  bg: "#1e1f22",
  comment: "#7a7e85",
  commentStyle: "",
  docComment: "#5f826b",
  docTag: "#67a37c",
  keyword: "#cf8e6d",
  string: "#6aab73",
  regexp: "#42c3d4",
  escape: "#cf8e6d",
  number: "#2aacb8",
  func: "#56a8f5",
  field: "#c77dbb",
  annotation: "#b3ae60",
  tag: "#d5b778",
  attr: "#bcbec4",
  attrValue: "#6aab73",
  entity: "#56a8f5",
  link: "#548af7",
  error: "#f75464",
};

const light: Scheme = {
  text: "#080808",
  bg: "#ffffff",
  comment: "#8c8c8c",
  commentStyle: "italic",
  docComment: "#8c8c8c",
  docTag: "#3d3d3d",
  keyword: "#0033b3",
  string: "#067d17",
  regexp: "#264eff",
  escape: "#0037a6",
  number: "#1750eb",
  func: "#00627a",
  field: "#871094",
  annotation: "#9e880d",
  tag: "#0033b3",
  attr: "#174ad4",
  attrValue: "#067d17",
  entity: "#174be6",
  link: "#006dcc",
  error: "#f50000",
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
      {
        scope: ["comment", "punctuation.definition.comment"],
        settings: { foreground: c.comment, fontStyle: c.commentStyle },
      },
      {
        scope: ["comment.block.documentation", "comment.block.javadoc"],
        settings: { foreground: c.docComment, fontStyle: "italic" },
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
      // DEFAULT_OPERATION_SIGN, DEFAULT_BRACES and their neighbours are plain text in both schemes.
      {
        scope: ["keyword.operator", "storage.type.function.arrow"],
        settings: { foreground: c.text },
      },
      { scope: ["string", "constant.character"], settings: { foreground: c.string } },
      { scope: ["string.regexp"], settings: { foreground: c.regexp } },
      { scope: ["constant.character.escape"], settings: { foreground: c.escape } },
      { scope: ["constant.numeric", "keyword.other.unit"], settings: { foreground: c.number } },
      // fontStyle "" is an explicit reset: `const f = () =>` is also variable.other.constant, which would lend it italic.
      {
        scope: ["entity.name.function", "entity.name.function.member"],
        settings: { foreground: c.func, fontStyle: "" },
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
      {
        scope: ["variable.other.constant", "constant.other.caps"],
        settings: { foreground: c.field, fontStyle: "italic" },
      },
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
        settings: { foreground: c.annotation },
      },
      { scope: ["entity.name.tag", "punctuation.definition.tag"], settings: { foreground: c.tag } },
      { scope: ["entity.other.attribute-name"], settings: { foreground: c.attr } },
      {
        scope: ["meta.tag string", "string.quoted.double.html", "string.quoted.single.html"],
        settings: { foreground: c.attrValue },
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
        settings: { foreground: c.attrValue },
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

export const webstormDark = scheme("webstorm-dark", "JetBrains WebStorm Dark", "dark", dark);
export const webstormLight = scheme(
  "webstorm-light",
  "JetBrains WebStorm Light",
  "light",
  light
);
