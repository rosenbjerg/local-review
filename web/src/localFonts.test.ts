import { afterEach, beforeEach, expect, test, vi } from "vitest";

// jsdom has none of the three APIs, and the store looks for them on first use, so each scenario
// arranges the browser it wants and then imports a fresh copy of the module.
class FakeFontFace {
  family: string;
  descriptors: FontFaceDescriptors;
  bytes: ArrayBuffer;
  constructor(family: string, bytes: ArrayBuffer, descriptors: FontFaceDescriptors) {
    this.family = family;
    this.bytes = bytes;
    this.descriptors = descriptors;
  }
  load() {
    return this.bytes.byteLength === 0 ? Promise.reject(new Error("refused")) : Promise.resolve(this);
  }
}

const added: FakeFontFace[] = [];
const file = (family: string, size = 4) => ({
  family,
  blob: () => Promise.resolve(new Blob([new Uint8Array(size)])),
});
const browser = (opts: { fonts?: ReturnType<typeof file>[]; permission?: PermissionState }) => {
  const w = window as Window & { queryLocalFonts?: unknown };
  if (opts.fonts) w.queryLocalFonts = vi.fn(() => Promise.resolve(opts.fonts));
  else delete w.queryLocalFonts;
  const status = { state: opts.permission ?? "prompt", onchange: null as (() => void) | null };
  Object.defineProperty(navigator, "permissions", {
    configurable: true,
    value: opts.permission ? { query: () => Promise.resolve(status) } : undefined,
  });
  return status;
};
const load = () => import("./localFonts");
const settle = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  vi.resetModules();
  added.length = 0;
  vi.stubGlobal("FontFace", FakeFontFace);
  Object.defineProperty(document, "fonts", {
    configurable: true,
    value: { add: (f: FakeFontFace) => added.push(f) },
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete (window as Window & { queryLocalFonts?: unknown }).queryLocalFonts;
});

// Firefox and Safari have no way to ask, so nothing here may so much as hint at one.
test("a browser without the API is unsupported, and every want answers no", async () => {
  browser({});
  const lf = await load();
  expect(lf.useLocalFonts).toBeTypeOf("function");
  expect(await lf.ensureFace("SF Pro")).toBe(false);
  await lf.requestLocalFonts();
  expect(added).toEqual([]);
});

// The prompt needs a click, so a want raised before it — a stored pick at first paint — has to wait
// for the button rather than fail, and then finish on its own once access is granted.
test("a want parks on the prompt and completes when the button grants access", async () => {
  browser({ fonts: [file("SF Pro"), file("SF Pro"), file("Menlo")] });
  const lf = await load();
  let resolved: boolean | null = null;
  void lf.ensureFace("sf pro").then((ok) => (resolved = ok));
  await settle();
  expect(resolved).toBeNull();

  await lf.requestLocalFonts();
  await settle();
  expect(resolved).toBe(true);
  expect(added.map((f) => f.family)).toEqual(["SF Pro", "SF Pro"]);
  expect(added[0].descriptors).toEqual({});
});

// The list comes back as families, deduped and sorted, so the picker can offer names rather than
// files; a second want for the same family reuses the first registration.
test("granted access enumerates once and registers a family once", async () => {
  browser({ fonts: [file("Zed Mono"), file("Andale Mono"), file("Zed Mono")], permission: "granted" });
  const lf = await load();
  const first = lf.ensureFace("Zed Mono");
  await settle();
  expect(await first).toBe(true);
  expect(await lf.ensureFace("zedmono")).toBe(true);
  expect(added.length).toBe(2);
  expect(await lf.ensureFace("Berkeley Mono")).toBe(false);
  expect((window as Window & { queryLocalFonts?: unknown }).queryLocalFonts).toHaveBeenCalledTimes(1);
});

// A denial is an answer, not a wait — and a change of mind in site settings has to reach a face
// that was refused, which is why a false is never remembered.
test("a denial answers no at once, and a later grant is picked up", async () => {
  const status = browser({ fonts: [file("Graphik")], permission: "denied" });
  const lf = await load();
  await settle();
  expect(await lf.ensureFace("Graphik")).toBe(false);

  status.state = "granted";
  status.onchange?.();
  await settle();
  expect(await lf.ensureFace("Graphik")).toBe(true);
  expect(added.map((f) => f.family)).toEqual(["Graphik"]);
});

// One file the browser's sanitizer refuses must not take the family's other weights down with it.
test("a file the browser refuses is skipped, not fatal", async () => {
  browser({ fonts: [file("Canela", 0), file("Canela")], permission: "granted" });
  const lf = await load();
  expect(await lf.ensureFace("Canela")).toBe(true);
  expect(added.length).toBe(1);
});

// Chromium refuses to enumerate for a page that isn't visible, so a tab opened in the background
// asks once it is looked at rather than failing while nobody is watching.
test("enumeration waits for the page to be visible", async () => {
  const fonts = [file("Proxima Nova")];
  browser({ fonts, permission: "granted" });
  Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
  const lf = await load();
  const want = lf.ensureFace("Proxima Nova");
  await settle();
  expect((window as Window & { queryLocalFonts?: unknown }).queryLocalFonts).not.toHaveBeenCalled();

  Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
  document.dispatchEvent(new Event("visibilitychange"));
  expect(await want).toBe(true);
});
