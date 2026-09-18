const TTC = 0x74746366;

// usWidthClass 1–9 as the percentages CSS font-stretch names them.
const WIDTH_CLASS = ["50%", "62.5%", "75%", "87.5%", "100%", "112.5%", "125%", "150%", "200%"];

function tag(dv: DataView, at: number): string {
  return String.fromCharCode(
    dv.getUint8(at),
    dv.getUint8(at + 1),
    dv.getUint8(at + 2),
    dv.getUint8(at + 3)
  );
}

function fixed(dv: DataView, at: number): number {
  return dv.getInt32(at) / 65536;
}

function tableDirectory(dv: DataView): Map<string, number> {
  // A collection is read as its first font; FontFace takes no index.
  const base = dv.getUint32(0) === TTC ? dv.getUint32(12) : 0;
  const count = dv.getUint16(base + 4);
  const tables = new Map<string, number>();
  for (let i = 0; i < count; i++) {
    const rec = base + 12 + i * 16;
    tables.set(tag(dv, rec), dv.getUint32(rec + 8));
  }
  return tables;
}

export function faceDescriptors(bytes: ArrayBuffer): FontFaceDescriptors {
  const desc: FontFaceDescriptors = {};
  try {
    const dv = new DataView(bytes);
    const tables = tableDirectory(dv);
    const os2 = tables.get("OS/2");
    if (os2 !== undefined) {
      const weight = dv.getUint16(os2 + 4);
      if (weight >= 1 && weight <= 1000) desc.weight = String(weight);
      const width = dv.getUint16(os2 + 6);
      if (width >= 1 && width <= 9) desc.stretch = WIDTH_CLASS[width - 1];
      // fsSelection: bit 0 is italic, bit 9 oblique.
      if (dv.getUint16(os2 + 62) & 0x0201) desc.style = "italic";
    }
    const fvar = tables.get("fvar");
    if (fvar !== undefined) {
      const axes = fvar + dv.getUint16(fvar + 4);
      const axisCount = dv.getUint16(fvar + 8);
      const axisSize = dv.getUint16(fvar + 10);
      for (let i = 0; i < axisCount; i++) {
        const axis = axes + i * axisSize;
        const min = fixed(dv, axis + 4);
        const max = fixed(dv, axis + 12);
        switch (tag(dv, axis)) {
          case "wght":
            desc.weight = `${min} ${max}`;
            break;
          case "wdth":
            desc.stretch = `${min}% ${max}%`;
            break;
          case "slnt":
            // slnt counts counter-clockwise, CSS oblique clockwise, so the range flips sign and ends.
            if (min < 0 || max > 0) desc.style = `oblique ${-max}deg ${-min}deg`;
            break;
        }
      }
    }
  } catch {
    // A truncated or foreign file gets the defaults; the browser will refuse the bytes itself.
  }
  return desc;
}
