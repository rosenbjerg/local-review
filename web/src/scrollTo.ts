// Scrolling the diff column means aiming at a moving target. Cards mount lazily as they near the
// viewport and each one grows again once its source arrives and the gap rows appear, so the offset
// `scrollIntoView` computes is already stale before its own animation ends — and the further the
// jump, the worse, because every card passed on the way mounts and resizes behind the animation.
// So: re-read the target every frame, and keep correcting for a moment after arriving. A jump
// further than a couple of screens skips to just short of its destination and animates only the
// arrival — the motion is the part worth keeping, the trip past forty cards is not.

export type Block = "start" | "center";

export interface Aim {
  el: HTMLElement;
  block: Block;
  // A stand-in for a target that hasn't mounted yet — a card holding the place of a thread inside
  // it. Keeps the scroll watching past its normal window, up to MAX_WAIT.
  provisional?: boolean;
}

// Matches .diff-column::before, so `start` lands a card where a resting scroll would leave it.
export const PAD = 8;
const DURATION = 260;
// Long enough to cover a card's fetch → gap rows → tokens, short enough to let go of the scroll.
const SETTLE = 900;
// Past this many viewport heights the journey is not worth animating: every card it passes would
// mount — a fetch and a tokenize each — and none of them ever unmounts again.
const FAR_SCREENS = 2;
// So a far jump keeps its arrival instead: land this much of a screen out and glide the rest, which
// reads as a direction without paying for the trip.
const APPROACH_SCREENS = 0.6;
// The cap on waiting for a provisional target. `useJump`'s flash poll runs off the same number, so a
// card slow to fetch either gets both the scroll and the flash or neither.
export const MAX_WAIT = 4000;

// How long a jump keeps moving the column once it has its real target — what the scroll-spy has to
// stay quiet for. Waiting on a provisional aim can put that window off by as much as MAX_WAIT, which
// is why `onTarget` exists: the caller re-suppresses when the real target turns up.
export const SCROLL_MS = DURATION + SETTLE;

// One scroll per column. Find-next during a jump's settle, or a second jump, replaces the first
// rather than the two writing scrollTop over each other every frame.
const running = new WeakMap<HTMLElement, () => void>();

export interface AimOpts {
  // Called once the aim is no longer provisional, with the window the scroll will run for from then.
  onTarget?: (ms: number) => void;
}

const easeOut = (t: number) => 1 - (1 - t) ** 3;

function reducedMotion(): boolean {
  return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
}

const clampTop = (root: HTMLElement, top: number) =>
  Math.max(0, Math.min(top, root.scrollHeight - root.clientHeight));

// Where the column would have to sit for `aim` to be where it asked to be.
export function offsetFor(root: HTMLElement, aim: Aim): number {
  const r = aim.el.getBoundingClientRect();
  const top = root.scrollTop + r.top - root.getBoundingClientRect().top;
  const want =
    aim.block === "center" ? top - Math.max(0, root.clientHeight - r.height) / 2 : top - PAD;
  return clampTop(root, want);
}

// Scrolls `root` so that whatever `aim` currently points at ends up in view, re-aiming every frame
// for SCROLL_MS after it has its real target. `aim` may return null, or a provisional stand-in,
// while the target is still unmounted — a thread inside a lazy card — and the scroll holds there and
// glides the rest of the way once it appears. Returns a cancel; a wheel, touch or pointer gesture on
// the column cancels it too, so a jump never fights the user for the scrollbar.
export function scrollToAim(
  root: HTMLElement | null,
  aim: () => Aim | null,
  opts: AimOpts = {}
): () => void {
  if (!root) return () => {};
  running.get(root)?.();
  const motion = !reducedMotion();
  const t0 = performance.now();
  const maxAt = t0 + MAX_WAIT;
  // Nothing may run past this, however the deadline is renewed.
  const hardStop = maxAt + SCROLL_MS;
  let raf = 0;
  let stopped = false;
  let arrived = false;
  let last: HTMLElement | null = null;
  let from = root.scrollTop;
  let startedAt = t0;
  let duration = motion ? DURATION : 0;
  let deadline = t0 + SCROLL_MS;

  const stop = () => {
    if (stopped) return;
    stopped = true;
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
    if (running.get(root) === stop) running.delete(root);
    root.removeEventListener("wheel", stop);
    root.removeEventListener("touchstart", stop);
    root.removeEventListener("pointerdown", stop);
  };

  const frame = () => {
    raf = 0;
    if (stopped) return;
    const t = performance.now();
    const a = aim();
    // Holding a place rather than arrived: keep watching, but never past MAX_WAIT. Once the real
    // target has been seen the cap is spent — it bounds the waiting, not the move it waited for.
    if ((!a || a.provisional) && !arrived) {
      deadline = Math.min(Math.max(deadline, t + SETTLE), maxAt);
    }
    if (!a) {
      if (t > deadline) return stop();
      raf = requestAnimationFrame(frame);
      return;
    }
    if (a.el !== last) {
      // A new target — the first one, or the thread we were waiting for. Ease from here rather
      // than snap, so an expanding card reads as one movement.
      last = a.el;
      from = root.scrollTop;
      startedAt = t;
      duration = motion ? DURATION : 0;
      if (!a.provisional) {
        deadline = Math.min(t + SCROLL_MS, hardStop);
        if (!arrived) {
          arrived = true;
          opts.onTarget?.(SCROLL_MS);
        }
      }
    }
    const target = offsetFor(root, a);
    // Tested against where the column is now, every frame, not once per target: the first aim, the
    // hand-off to a thread deep inside a card, and a card above collapsing or loading and throwing
    // the target screens away are all the same problem. Skipping to the approach leaves everything
    // behind it a placeholder, which is both far cheaper and what keeps the rest of the animation
    // short enough that the offset can't drift out from under it. It can't thrash: after a skip the
    // target is APPROACH_SCREENS away, well inside the test.
    if (motion && Math.abs(target - root.scrollTop) > FAR_SCREENS * root.clientHeight) {
      const dir = target > root.scrollTop ? 1 : -1;
      from = clampTop(root, target - dir * APPROACH_SCREENS * root.clientHeight);
      startedAt = t;
    }
    const e = t - startedAt;
    root.scrollTop = e >= duration ? target : from + (target - from) * easeOut(e / duration);
    if (t > deadline) return stop();
    raf = requestAnimationFrame(frame);
  };

  running.set(root, stop);
  root.addEventListener("wheel", stop, { passive: true });
  root.addEventListener("touchstart", stop, { passive: true });
  root.addEventListener("pointerdown", stop, { passive: true });
  raf = requestAnimationFrame(frame);
  return stop;
}

// The card for a path; the wrapper exists whether or not the card inside it has mounted.
export function fileAim(path: string, provisional = false): Aim | null {
  const el = document.getElementById(`file-${path}`);
  return el ? { el, block: "start", provisional } : null;
}

// The thread for a comment, which only exists once its card has mounted and expanded.
export function commentAim(id: number): Aim | null {
  const el = document.getElementById(`comment-${id}`);
  return el ? { el, block: "center" } : null;
}
