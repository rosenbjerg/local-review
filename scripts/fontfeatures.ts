#!/usr/bin/env bun
// Regenerates web/src/fontFeatures.ts: the OpenType feature tables of the faces styles.css bundles.
//   bun scripts/fontfeatures.ts [--check]
// --check fails instead of writing, for CI and for noticing a font upgrade that moved a set.
//
// A stylistic set's meaning is private to its face — "ss03" is Arrows in Monaspace and nothing at
// all in JetBrains Mono, while in Inter "ss05" is circled characters — so the names are read out of
// the fonts rather than written down here, and re-read whenever a font is replaced.

import { readFileSync, writeFileSync } from "node:fs";
import { brotliDecompressSync } from "node:zlib";
import { join } from "node:path";

const REPO_ROOT = join(import.meta.dir, "..");
const CSS = join(REPO_ROOT, "web/src/styles.css");
const OUT = join(REPO_ROOT, "web/src/fontFeatures.ts");

// WOFF2 spells the common tags as an index into this table rather than four bytes. Order is the
// spec's, and the one entry that is not four characters ("cvt ") really does carry its space.
const KNOWN_TAGS = [
  "cmap", "head", "hhea", "hmtx", "maxp", "name", "OS/2", "post", "cvt ", "fpgm",
  "glyf", "loca", "prep", "CFF ", "VORG", "EBDT", "EBLC", "gasp", "hdmx", "kern",
  "LTSH", "PCLT", "VDMX", "vhea", "vmtx", "BASE", "GDEF", "GPOS", "GSUB", "EBSC",
  "JSTF", "MATH", "CBDT", "CBLC", "COLR", "CPAL", "SVG ", "sbix", "acnt", "avar",
  "bdat", "bloc", "bsln", "cvar", "fdsc", "feat", "fmtx", "fvar", "gvar", "hsty",
  "just", "lcar", "mort", "morx", "opbd", "prop", "trak", "Zapf", "Silf", "Glat",
  "Gloc", "Feat", "Sill",
];

// UIntBase128: seven bits a byte, high bit continues. Five bytes is the spec's ceiling.
function uintBase128(buf: Buffer, pos: number): [number, number] {
  let value = 0;
  for (let i = 0; i < 5; i++) {
    const byte = buf[pos++];
    value = value * 128 + (byte & 0x7f);
    if ((byte & 0x80) === 0) return [value, pos];
  }
  throw new Error("malformed UIntBase128");
}

// The tables come out of one brotli stream laid end to end in directory order, so a table is found
// by summing the lengths before it. glyf and loca arrive transformed and are skipped; GSUB and name,
// the two this needs, are never transformed.
function sfntTables(file: string): Map<string, Buffer> {
  const buf = readFileSync(file);
  if (buf.toString("ascii", 0, 4) !== "wOF2") throw new Error(`${file} is not WOFF2`);
  const numTables = buf.readUInt16BE(12);
  let pos = 48;
  const dir: { tag: string; length: number }[] = [];
  for (let i = 0; i < numTables; i++) {
    const flags = buf[pos++];
    let tag: string;
    if ((flags & 0x3f) === 0x3f) {
      tag = buf.toString("ascii", pos, pos + 4);
      pos += 4;
    } else {
      tag = KNOWN_TAGS[flags & 0x3f];
    }
    let origLength: number;
    [origLength, pos] = uintBase128(buf, pos);
    // Transform 0 is the transformed form for glyf/loca and the null transform for everything else.
    const version = (flags >> 6) & 3;
    const transformed = tag === "glyf" || tag === "loca" ? version === 0 : version !== 0;
    let length = origLength;
    if (transformed) [length, pos] = uintBase128(buf, pos);
    dir.push({ tag, length });
  }
  const stream = brotliDecompressSync(buf.subarray(pos));
  const tables = new Map<string, Buffer>();
  let offset = 0;
  for (const { tag, length } of dir) {
    tables.set(tag, stream.subarray(offset, offset + length));
    offset += length;
  }
  return tables;
}

// Windows UTF-16BE where it exists, Mac Roman otherwise; the first record for an id wins, which is
// the order the table is already sorted in.
function nameStrings(name: Buffer): Map<number, string> {
  const count = name.readUInt16BE(2);
  const storage = name.readUInt16BE(4);
  const byId = new Map<number, string>();
  for (let i = 0; i < count; i++) {
    const rec = 6 + i * 12;
    const platform = name.readUInt16BE(rec);
    const encoding = name.readUInt16BE(rec + 2);
    const nameId = name.readUInt16BE(rec + 6);
    const length = name.readUInt16BE(rec + 8);
    const offset = name.readUInt16BE(rec + 10);
    const raw = Buffer.from(name.subarray(storage + offset, storage + offset + length));
    const text = platform === 3 && encoding === 1 ? raw.swap16().toString("utf16le") : raw.toString("latin1");
    if (!byId.has(nameId)) byId.set(nameId, text);
  }
  return byId;
}

export interface Face {
  features: string[];
  named: { tag: string; name: string }[];
}

// Every feature the face declares, and the UI name a stylistic set or character variant carries in
// its FeatureParams. A tag repeats once per script and language, so tags are deduped and a name is
// taken from the first record that has one.
function readFeatures(tables: Map<string, Buffer>): Face {
  const gsub = tables.get("GSUB");
  if (!gsub) return { features: [], named: [] };
  const names = nameStrings(tables.get("name")!);
  const listOffset = gsub.readUInt16BE(6);
  const count = gsub.readUInt16BE(listOffset);
  const features = new Set<string>();
  const named = new Map<string, string>();
  for (let i = 0; i < count; i++) {
    const rec = listOffset + 2 + i * 6;
    const tag = gsub.toString("ascii", rec, rec + 4);
    features.add(tag);
    if (named.has(tag) || !/^(ss|cv)\d\d$/.test(tag)) continue;
    const table = listOffset + gsub.readUInt16BE(rec + 4);
    const params = gsub.readUInt16BE(table);
    if (params === 0) continue;
    // Both FeatureParams layouts put the UI name id in the second uint16: version then nameId for a
    // stylistic set, format then featUiLabelNameId for a character variant.
    const label = names.get(gsub.readUInt16BE(table + params + 2));
    if (label) named.set(tag, label);
  }
  return {
    features: [...features].sort(),
    named: [...named.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([tag, name]) => ({ tag, name })),
  };
}

// The families as CSS registers them, which is what a family override is compared against — reading
// them from the @font-face blocks rather than from the fonts means a newly bundled face is picked up
// without touching this script. One family, several files: the faces agree on their feature tables.
function bundled(): Map<string, string> {
  const css = readFileSync(CSS, "utf8");
  const faces = new Map<string, string>();
  for (const block of css.matchAll(/@font-face\s*\{([^}]*)\}/g)) {
    const family = block[1].match(/font-family:\s*"([^"]+)"/)?.[1];
    const url = block[1].match(/src:\s*url\("\.\/([^"]+\.woff2)"\)/)?.[1];
    if (family && url && !faces.has(family)) faces.set(family, join(REPO_ROOT, "web/src", url));
  }
  if (faces.size === 0) throw new Error(`no @font-face blocks with a woff2 src in ${CSS}`);
  return faces;
}

function render(): string {
  const lines: string[] = [
    "// Generated by `bun scripts/fontfeatures.ts` — do not edit.",
    "//",
    "// The OpenType features of the faces styles.css bundles, read out of the font files. A stylistic",
    "// set means whatever its own face says it means: ss03 is Arrows in Monaspace Neon, an unrelated",
    "// glyph shape in JetBrains Mono, and in Inter ss05 draws a ring around every capital — so the tag",
    "// alone is never enough to apply, and a face that is not in here has no table we can read.",
    "",
    "export interface FaceFeatures {",
    "  /** Every GSUB feature tag the face declares. */",
    "  readonly features: readonly string[];",
    "  /** Stylistic sets and character variants, with the UI name the font gives them. */",
    "  readonly named: readonly { readonly tag: string; readonly name: string }[];",
    "}",
    "",
    "export const FACE_FEATURES: Readonly<Record<string, FaceFeatures>> = {",
  ];
  for (const [family, file] of [...bundled()].sort(([a], [b]) => a.localeCompare(b))) {
    const face = readFeatures(sfntTables(file));
    lines.push(`  ${JSON.stringify(family)}: {`);
    lines.push(`    features: [${face.features.map((f) => JSON.stringify(f)).join(", ")}],`);
    lines.push("    named: [");
    for (const { tag, name } of face.named) {
      lines.push(`      { tag: ${JSON.stringify(tag)}, name: ${JSON.stringify(name)} },`);
    }
    lines.push("    ],");
    lines.push("  },");
  }
  lines.push("};", "");
  return lines.join("\n");
}

const next = render();
if (process.argv.includes("--check")) {
  const current = readFileSync(OUT, "utf8");
  if (current === next) {
    console.log("fontFeatures.ts is up to date");
  } else {
    console.error("fontFeatures.ts is stale — run `bun scripts/fontfeatures.ts`");
    process.exit(1);
  }
} else {
  writeFileSync(OUT, next);
  console.log(`wrote ${OUT}`);
}
