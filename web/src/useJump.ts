import { useEffect, useRef, useState } from "react";
import { type Comment, effectivePath } from "./types";

interface Params {
  comments: Comment[];
  setSelectedFile: (path: string) => void;
  // Called before a programmatic scroll so a scroll-spy can pause and not flicker.
  onProgrammaticScroll?: () => void;
}

// Comment/file navigation: the active comment, the expand signals that mount a lazy file / open a collapsed thread, and jumpTo.
export function useJump({ comments, setSelectedFile, onProgrammaticScroll }: Params) {
  const [activeComment, setActiveComment] = useState<number | null>(null);
  const [expandTarget, setExpandTarget] = useState<{ path: string; n: number } | null>(null);
  // Nonce so jumping to the same collapsed thread twice re-expands it.
  const [expandComment, setExpandComment] = useState<{ id: number; n: number } | null>(null);
  const expandN = useRef(0);
  const expandCommentN = useRef(0);
  const jumpPoll = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (jumpPoll.current !== null) clearTimeout(jumpPoll.current);
    },
    []
  );

  function flashComment(id: number): boolean {
    const el = document.getElementById(`comment-${id}`);
    if (!el) return false;
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    el.classList.add("thread-flash");
    setTimeout(() => el.classList.remove("thread-flash"), 1200);
    return true;
  }

  function jumpTo(id: number) {
    // Supersede any in-flight jump so rapid n/p doesn't stack scroll loops.
    if (jumpPoll.current !== null) {
      clearTimeout(jumpPoll.current);
      jumpPoll.current = null;
    }
    onProgrammaticScroll?.();
    setActiveComment(id);
    // Set before the early return: a collapsed thread's node exists, so flashComment would return first without expanding it.
    setExpandComment({ id, n: ++expandCommentN.current });
    if (flashComment(id)) return;
    // The file may be lazy-unmounted or collapsed: signal expand, scroll to mount it, then retry the flash.
    const c = comments.find((x) => x.id === id);
    if (!c) return;
    // Cards are keyed by where the comment lives now, so a rename-moved one is under its new path.
    const path = effectivePath(c);
    setExpandTarget({ path, n: ++expandN.current });
    document.getElementById(`file-${path}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
    let tries = 0;
    const poll = () => {
      if (flashComment(id) || tries++ > 40) {
        jumpPoll.current = null;
        return;
      }
      jumpPoll.current = setTimeout(poll, 100);
    };
    jumpPoll.current = setTimeout(poll, 100);
  }

  function jumpToFile(path: string) {
    onProgrammaticScroll?.();
    setSelectedFile(path);
    document.getElementById(`file-${path}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function resetJump() {
    if (jumpPoll.current !== null) {
      clearTimeout(jumpPoll.current);
      jumpPoll.current = null;
    }
    setActiveComment(null);
    setExpandTarget(null);
    setExpandComment(null);
  }

  return { activeComment, expandTarget, expandComment, jumpTo, jumpToFile, resetJump };
}
