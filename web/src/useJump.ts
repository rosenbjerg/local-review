import { useEffect, useRef, useState, type RefObject } from "react";
import { commentAim, fileAim, scrollToAim, MAX_WAIT, SCROLL_MS } from "./scrollTo";
import { type Comment, effectivePath } from "./types";

interface Params {
  comments: Comment[];
  setSelectedFile: (path: string) => void;
  // The diff column: the scroller a jump drives.
  rootRef: RefObject<HTMLElement | null>;
  // Called before a programmatic scroll so a scroll-spy can pause and not flicker.
  onProgrammaticScroll?: (ms: number) => void;
}

// Comment/file navigation: the active comment, the expand signals that mount a lazy file / open a collapsed thread, and jumpTo.
export function useJump({ comments, setSelectedFile, rootRef, onProgrammaticScroll }: Params) {
  const [activeComment, setActiveComment] = useState<number | null>(null);
  const [expandTarget, setExpandTarget] = useState<{ path: string; n: number } | null>(null);
  // Nonce so jumping to the same collapsed thread twice re-expands it.
  const [expandComment, setExpandComment] = useState<{ id: number; n: number } | null>(null);
  const expandN = useRef(0);
  const expandCommentN = useRef(0);
  const cancelScroll = useRef<(() => void) | null>(null);
  const flashPoll = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => stopAll(cancelScroll, flashPoll), []);

  function flash(id: number): boolean {
    const el = document.getElementById(`comment-${id}`);
    if (!el) return false;
    el.classList.add("thread-flash");
    setTimeout(() => el.classList.remove("thread-flash"), 1200);
    return true;
  }

  function jumpTo(id: number) {
    // Supersede any in-flight jump so rapid n/p doesn't stack scroll loops.
    stopAll(cancelScroll, flashPoll);
    onProgrammaticScroll?.(SCROLL_MS);
    setActiveComment(id);
    // Set before anything can bail: a collapsed thread's node exists, so the aim would find it
    // without this ever expanding it.
    setExpandComment({ id, n: ++expandCommentN.current });
    // Cards are keyed by where the comment lives now, so a rename-moved one is under its new path.
    const c = comments.find((x) => x.id === id);
    const path = c ? effectivePath(c) : null;
    if (path) {
      setExpandTarget({ path, n: ++expandN.current });
      // The spy can't report the landing: a far jump's scroll events all fall inside its own
      // suppression window, so mark-reviewed and j/k would still be pointing at the file we left.
      setSelectedFile(path);
    } else if (!document.getElementById(`comment-${id}`)) {
      // Not in `comments` and not on screen — a ref to a comment this read hasn't caught up with.
      return;
    }
    // The thread may be unmounted (lazy card) or collapsed; until it exists the card stands in for
    // it, and the aim switches over by itself the frame it appears.
    cancelScroll.current = scrollToAim(
      rootRef.current,
      () => commentAim(id) ?? (path ? fileAim(path, true) : null),
      { onTarget: (ms) => onProgrammaticScroll?.(ms) }
    );
    if (flash(id)) return;
    // Same bound as the scroll's, so a card slow to mount gets both or neither.
    const until = performance.now() + MAX_WAIT;
    const poll = () => {
      if (flash(id) || performance.now() > until) {
        flashPoll.current = null;
        return;
      }
      flashPoll.current = setTimeout(poll, 100);
    };
    flashPoll.current = setTimeout(poll, 100);
  }

  function jumpToFile(path: string) {
    stopAll(cancelScroll, flashPoll);
    onProgrammaticScroll?.(SCROLL_MS);
    setSelectedFile(path);
    // No wait for the card to mount: an aim that finds nothing keeps looking.
    cancelScroll.current = scrollToAim(rootRef.current, () => fileAim(path));
  }

  function resetJump() {
    stopAll(cancelScroll, flashPoll);
    setActiveComment(null);
    setExpandTarget(null);
    setExpandComment(null);
  }

  return { activeComment, expandTarget, expandComment, jumpTo, jumpToFile, resetJump };
}

function stopAll(
  cancelScroll: { current: (() => void) | null },
  flashPoll: { current: ReturnType<typeof setTimeout> | null }
) {
  cancelScroll.current?.();
  cancelScroll.current = null;
  if (flashPoll.current !== null) clearTimeout(flashPoll.current);
  flashPoll.current = null;
}
