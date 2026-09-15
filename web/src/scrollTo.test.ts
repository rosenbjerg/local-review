import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { PAD, SCROLL_MS, offsetFor, scrollToAim } from "./scrollTo";

// jsdom lays nothing out, so the geometry is faked: a scroller 500px tall over 20000px of content,
// and cards that report a viewport rect derived from their document offset — which is what makes a
// card "growing" mid-scroll observable, the whole point of the thing under test.
function scroller() {
  const root = document.createElement("div");
  document.body.appendChild(root);
  Object.defineProperty(root, "clientHeight", { value: 500 });
  Object.defineProperty(root, "scrollHeight", { value: 20000 });
  root.getBoundingClientRect = () => ({ top: 0, height: 500 }) as DOMRect;
  return root;
}

function card(root: HTMLElement, id: string, docTop: () => number, height = 200) {
  const el = document.createElement("div");
  el.id = id;
  root.appendChild(el);
  el.getBoundingClientRect = () => ({ top: docTop() - root.scrollTop, height }) as DOMRect;
  return el;
}

const frames = (n: number) => {
  for (let i = 0; i < n; i++) vi.advanceTimersByTime(16);
};

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.useRealTimers();
  document.body.innerHTML = "";
});

// The trip is what costs — every card passed mounts and never unmounts again — so a far jump skips
// to the approach and animates only from there. The motion survives; the forty mounts don't.
test("a far jump skips the journey and animates the arrival", () => {
  const root = scroller();
  const el = card(root, "file-far", () => 9000);

  scrollToAim(root, () => ({ el, block: "start" }));
  frames(1);
  // 0.6 of the 500px column short of the target, not at it.
  expect(root.scrollTop).toBe(9000 - 8 - 300);

  frames(30);
  expect(root.scrollTop).toBe(9000 - 8);
});

test("a far jump upwards approaches from below", () => {
  const root = scroller();
  const el = card(root, "file-far", () => 2000);
  root.scrollTop = 12000;

  scrollToAim(root, () => ({ el, block: "start" }));
  frames(1);
  expect(root.scrollTop).toBe(2000 - 8 + 300);

  frames(30);
  expect(root.scrollTop).toBe(2000 - 8);
});

test("a near jump eases rather than snapping", () => {
  const root = scroller();
  const el = card(root, "file-near", () => 600);

  scrollToAim(root, () => ({ el, block: "start" }));
  // The first frame is the animation's own start, so the movement only shows from the second.
  frames(3);

  expect(root.scrollTop).toBeGreaterThan(0);
  expect(root.scrollTop).toBeLessThan(592);
  frames(30);
  expect(root.scrollTop).toBe(592);
});

// The drift that a one-shot scrollIntoView can't survive: the cards above the target mount while
// the scroll is on its way, the target slides down, and the offset computed at call time is short.
test("the target moving after the scroll started is corrected for", () => {
  const root = scroller();
  let top = 9000;
  const el = card(root, "file-target", () => top);

  scrollToAim(root, () => ({ el, block: "start" }));
  frames(30);
  expect(root.scrollTop).toBe(8992);

  top = 9400; // a placeholder above it mounted and grew
  frames(2);
  expect(root.scrollTop).toBe(9392);
});

test("a target that only appears later is waited for, then scrolled to", () => {
  const root = scroller();
  let el: HTMLElement | null = null;

  scrollToAim(root, () => (el ? { el, block: "start" } : null));
  frames(5);
  expect(root.scrollTop).toBe(0);

  el = card(root, "comment-1", () => 9000);
  frames(30);
  expect(root.scrollTop).toBe(8992);
});

// Fighting the user for the scrollbar for a second after a jump is worse than landing short.
test("a wheel gesture on the column gives up the scroll", () => {
  const root = scroller();
  const el = card(root, "file-far", () => 9000);

  scrollToAim(root, () => ({ el, block: "start" }));
  frames(30);
  root.dispatchEvent(new Event("wheel"));
  root.scrollTop = 3000;
  frames(10);

  expect(root.scrollTop).toBe(3000);
});

test("cancelling stops the correction", () => {
  const root = scroller();
  let top = 9000;
  const el = card(root, "file-far", () => top);

  const cancel = scrollToAim(root, () => ({ el, block: "start" }));
  frames(30);
  cancel();
  top = 11500;
  frames(10);

  expect(root.scrollTop).toBe(8992);
});

test("the correction window is finite", () => {
  const root = scroller();
  let top = 9000;
  const el = card(root, "file-far", () => top);

  scrollToAim(root, () => ({ el, block: "start" }));
  frames(Math.ceil(SCROLL_MS / 16) + 2);
  top = 11500;
  frames(10);

  expect(root.scrollTop).toBe(8992);
});

test("centring puts the target's middle at the column's middle, clamped to the scroll range", () => {
  const root = scroller();
  const el = card(root, "comment-1", () => 9000, 100);

  expect(offsetFor(root, { el, block: "center" })).toBe(9000 - 200);
  expect(offsetFor(root, { el: card(root, "comment-2", () => 10), block: "center" })).toBe(0);
});

// A card slow to fetch and expand used to blow past the window: the scroll gave up while its thread
// was still a spinner, and the jump landed on the card's top edge instead of the comment.
test("a provisional aim holds the window open until the real target mounts", () => {
  const root = scroller();
  const stand = card(root, "file-slow", () => 9000);
  let real: HTMLElement | null = null;

  scrollToAim(root, () =>
    real ? { el: real, block: "center" } : { el: stand, block: "start", provisional: true }
  );
  frames(30);
  expect(root.scrollTop).toBe(8992);

  frames(Math.ceil((SCROLL_MS * 2) / 16));
  real = card(root, "comment-9", () => 10000, 100);
  frames(40);

  expect(root.scrollTop).toBe(10000 - 200);
});

// …but not forever: a target that never arrives must not leave a frame loop running.
test("a provisional aim gives up eventually", () => {
  const root = scroller();
  const stand = card(root, "file-slow", () => 9000);
  let real: HTMLElement | null = null;

  scrollToAim(root, () =>
    real ? { el: real, block: "center" } : { el: stand, block: "start", provisional: true }
  );
  frames(400); // 6.4s, well past MAX_WAIT
  real = card(root, "comment-9", () => 10000, 100);
  frames(40);

  expect(root.scrollTop).toBe(8992);
});

// Two scrolls writing scrollTop over each other every frame reads as a jam: find-next would move the
// column and the jump still settling would yank it straight back.
test("a new scroll on the same column replaces the one running", () => {
  const root = scroller();
  const a = card(root, "file-a", () => 9000);
  const b = card(root, "file-b", () => 15000);

  scrollToAim(root, () => ({ el: a, block: "start" }));
  frames(1);
  scrollToAim(root, () => ({ el: b, block: "start" }));
  frames(61);

  expect(root.scrollTop).toBe(15000 - 8);
});

test("onTarget fires once, when the aim stops being provisional", () => {
  const root = scroller();
  const stand = card(root, "file-slow", () => 9000);
  let real: HTMLElement | null = null;
  const windows: number[] = [];

  scrollToAim(
    root,
    () => (real ? { el: real, block: "center" } : { el: stand, block: "start", provisional: true }),
    { onTarget: (ms) => windows.push(ms) }
  );
  frames(10);
  expect(windows).toEqual([]);

  real = card(root, "comment-9", () => 10000, 100);
  frames(10);
  expect(windows).toEqual([SCROLL_MS]);
});

// The hand-off from a card to a thread far inside it is its own long jump, and gets the same
// treatment — animating the whole of it re-opens the drift this exists to close.
test("the hand-off to a distant thread skips its journey too", () => {
  const root = scroller();
  const stand = card(root, "file-big", () => 9000);
  let real: HTMLElement | null = null;

  scrollToAim(root, () =>
    real ? { el: real, block: "center" } : { el: stand, block: "start", provisional: true }
  );
  frames(30);
  real = card(root, "comment-9", () => 14000, 100);
  frames(1);
  expect(root.scrollTop).toBe(14000 - 200 - 300);

  frames(30);
  expect(root.scrollTop).toBe(14000 - 200);
});

// The window a real target earns must not be clipped back by the cap on waiting for it.
test("a target found late still gets its full window", () => {
  const root = scroller();
  const stand = card(root, "file-slow", () => 9000);
  let real: HTMLElement | null = null;
  let top = 14000;

  scrollToAim(root, () =>
    real ? { el: real, block: "center" } : { el: stand, block: "start", provisional: true }
  );
  frames(Math.ceil(3900 / 16));
  real = card(root, "comment-9", () => top, 100);
  frames(30);
  expect(root.scrollTop).toBe(13800);

  top = 15000; // the card above it finished loading
  frames(30);
  expect(root.scrollTop).toBe(14800);
});

// PAD is a copy of the column's top gap; landing a card on it means landing where a resting scroll
// would. Change the padding without this and every `block:"start"` jump mis-lands by the delta.
test("PAD matches the gap the diff column reserves above the first card", () => {
  const css = readFileSync(join(__dirname, "styles.css"), "utf8");
  expect(css).toContain(`.diff-column {\n  flex: 1;`);
  expect(css).toMatch(new RegExp(`\\.diff-column::before \\{[^}]*height: ${PAD}px;`));
});

// Mark-reviewed-and-advance moves the target while the scroll is already on its way: the card being
// left collapses a screenful out from under it. Correcting that by animating the whole distance
// would mount everything it crossed — so a correction that large gets the approach treatment too.
test("a target thrown screens away mid-flight is re-approached, not chased", () => {
  const root = scroller();
  let top = 9000;
  const el = card(root, "file-next", () => top);

  scrollToAim(root, () => ({ el, block: "start" }));
  frames(30);
  expect(root.scrollTop).toBe(8992);

  top = 3000; // the card above it collapsed
  frames(1);
  // Straight to 0.6 of a screen below it, then eased up — not a 6000px slide past every card.
  expect(root.scrollTop).toBe(3000 - 8 + 300);
  frames(30);
  expect(root.scrollTop).toBe(2992);
});
