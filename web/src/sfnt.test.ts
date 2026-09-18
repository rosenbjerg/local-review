import { expect, test } from "vitest";

import { faceDescriptors } from "./sfnt";

interface Axis {
  tag: string;
  min: number;
  max: number;
}

// The smallest file the parser has an opinion about: an offset table, a directory, and the two
// tables it reads. Everything else a real font carries is irrelevant to the descriptors.
function sfnt(opts: { weight?: number; width?: number; italic?: boolean; axes?: Axis[]; ttc?: boolean }) {
  const tables: { tag: string; data: Uint8Array }[] = [];
  const os2 = new Uint8Array(96);
  const os2v = new DataView(os2.buffer);
  os2v.setUint16(4, opts.weight ?? 400);
  os2v.setUint16(6, opts.width ?? 5);
  if (opts.italic) os2v.setUint16(62, 1);
  tables.push({ tag: "OS/2", data: os2 });
  if (opts.axes) {
    const fvar = new Uint8Array(16 + opts.axes.length * 20);
    const v = new DataView(fvar.buffer);
    v.setUint16(4, 16);
    v.setUint16(8, opts.axes.length);
    v.setUint16(10, 20);
    opts.axes.forEach((a, i) => {
      const at = 16 + i * 20;
      for (let c = 0; c < 4; c++) fvar[at + c] = a.tag.charCodeAt(c);
      v.setInt32(at + 4, a.min * 65536);
      v.setInt32(at + 12, a.max * 65536);
    });
    tables.push({ tag: "fvar", data: fvar });
  }

  const ttcHeader = opts.ttc ? 16 : 0;
  const dirStart = ttcHeader;
  const dataStart = dirStart + 12 + tables.length * 16;
  const total = dataStart + tables.reduce((n, t) => n + t.data.length, 0);
  const out = new Uint8Array(total);
  const dv = new DataView(out.buffer);
  if (opts.ttc) {
    out.set([0x74, 0x74, 0x63, 0x66]);
    dv.setUint32(8, 1);
    dv.setUint32(12, dirStart);
  }
  dv.setUint32(dirStart, 0x00010000);
  dv.setUint16(dirStart + 4, tables.length);
  let offset = dataStart;
  tables.forEach((t, i) => {
    const rec = dirStart + 12 + i * 16;
    for (let c = 0; c < 4; c++) out[rec + c] = t.tag.charCodeAt(c);
    dv.setUint32(rec + 8, offset);
    dv.setUint32(rec + 12, t.data.length);
    out.set(t.data, offset);
    offset += t.data.length;
  });
  return out.buffer;
}

// A family's files all register under one name, so the descriptors are what keeps a bold request
// from landing on the regular face — or on whichever file happened to be registered last.
test("a static face reports the weight, width and slant its OS/2 table carries", () => {
  expect(faceDescriptors(sfnt({ weight: 700, italic: true }))).toEqual({
    weight: "700",
    stretch: "100%",
    style: "italic",
  });
  expect(faceDescriptors(sfnt({ weight: 300, width: 3 }))).toEqual({ weight: "300", stretch: "75%" });
});

test("a variable face reports the range of each axis, with slant flipped into CSS's direction", () => {
  const axes = [
    { tag: "wght", min: 200, max: 800 },
    { tag: "wdth", min: 100, max: 125 },
    { tag: "slnt", min: -11, max: 0 },
  ];
  expect(faceDescriptors(sfnt({ weight: 400, axes }))).toEqual({
    weight: "200 800",
    stretch: "100% 125%",
    style: "oblique 0deg 11deg",
  });
});

test("a collection is read as its first font, and anything else gets the defaults", () => {
  expect(faceDescriptors(sfnt({ weight: 500, ttc: true })).weight).toBe("500");
  expect(faceDescriptors(new ArrayBuffer(4))).toEqual({});
  expect(faceDescriptors(new TextEncoder().encode("wOF2 not sfnt").buffer as ArrayBuffer)).toEqual({});
});
