import type { ThemeRegistrationRaw } from "shiki/core";

// JetBrains Darcula's editor scheme (Darcula.icls) as a TextMate theme. Hand-written
// rather than vendored: Shiki ships no JetBrains theme, and the scheme is about twenty
// colors — most identifiers (classes, parameters, locals, calls) stay the default text
// color, which is what makes it read as Darcula. Each rule maps an .icls attribute
// (KEYWORD, STRING, NUMBER, FUNCTION_DECLARATION, INSTANCE_FIELD, ANNOTATION_NAME,
// HTML_TAG_NAME, …) onto the TextMate scopes the bundled grammars emit for it. Where a
// grammar can't tell a declaration from a call (C#, TS method names) both take the
// declaration color, as every VS Code port of the scheme does.
const c = {
  text: "#a9b7c6",
  bg: "#2b2b2b",
  comment: "#808080",
  docComment: "#629755",
  keyword: "#cc7832",
  string: "#6a8759",
  number: "#6897bb",
  func: "#ffc66d",
  field: "#9876aa",
  annotation: "#bbb529",
  tag: "#e8bf6a",
  attr: "#bababa",
  attrValue: "#a5c261",
  macro: "#908b25",
  builtin: "#8888c6",
  self: "#94558d",
  entity: "#6d9cbe",
  link: "#589df6",
  error: "#ff6b68",
};

export const darcula: ThemeRegistrationRaw = {
  name: "darcula",
  displayName: "JetBrains Darcula",
  type: "dark",
  colors: { "editor.background": c.bg, "editor.foreground": c.text },
  settings: [
    { settings: { foreground: c.text, background: c.bg } },
    { scope: ["comment", "punctuation.definition.comment"], settings: { foreground: c.comment } },
    {
      scope: ["comment.block.documentation", "comment.block.javadoc"],
      settings: { foreground: c.docComment },
    },
    // Doc tags (@param, {@link}) — the keyword rules below must not turn them orange.
    {
      scope: ["comment keyword", "comment storage.type", "comment entity.name.type", "comment variable"],
      settings: { foreground: c.docComment, fontStyle: "bold" },
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
      ],
      settings: { foreground: c.keyword },
    },
    // Operators and the arrow are plain text in Darcula.
    {
      scope: ["keyword.operator", "storage.type.function.arrow"],
      settings: { foreground: c.text },
    },
    { scope: ["string", "constant.character", "string.regexp"], settings: { foreground: c.string } },
    { scope: ["constant.character.escape"], settings: { foreground: c.keyword } },
    { scope: ["constant.numeric", "keyword.other.unit"], settings: { foreground: c.number } },
    // fontStyle "" is an explicit reset: a `const f = () =>` is also variable.other.constant,
    // which would otherwise lend the function name its italic.
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
    { scope: ["entity.name.tag.yaml"], settings: { foreground: c.keyword } },
    {
      scope: ["keyword.control.directive", "meta.preprocessor", "entity.name.function.preprocessor"],
      settings: { foreground: c.macro },
    },
    {
      scope: ["support.function.builtin.python", "support.function.magic.python"],
      settings: { foreground: c.builtin },
    },
    {
      scope: [
        "variable.language.special.self.python",
        "variable.parameter.function.language.special.self.python",
      ],
      settings: { foreground: c.self },
    },
    { scope: ["constant.character.entity"], settings: { foreground: c.entity } },
    { scope: ["markup.underline.link", "string.other.link"], settings: { foreground: c.link } },
    { scope: ["markup.heading", "entity.name.section.markdown", "markup.bold"], settings: { fontStyle: "bold" } },
    { scope: ["markup.italic"], settings: { fontStyle: "italic" } },
    { scope: ["markup.inline.raw", "markup.raw"], settings: { foreground: c.string } },
    { scope: ["invalid", "invalid.illegal"], settings: { foreground: c.error } },
  ],
};
