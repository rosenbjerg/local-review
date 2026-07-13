import { useEffect, useRef, useState } from "react";
import type { Comment } from "./types";

interface Params {
  comments: Comment[];
  setSelectedFile: (path: string) => void;
}

// Owns comment/file navigation: the active comment, the expand signals that mount
// a lazy file (expandTarget) and open a collapsed thread (expandComment), and the
// jump handlers. Returns what DiffView/FileExplorer/CommentsPanel and the keyboard
// shortcuts consume.
export function useJump({ comments, setSelectedFile }: Params) {
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
    setActiveComment(id);
    // Expand the thread if it's collapsed (resolved threads start collapsed), so
    // jumping to it reveals the body. Set before the early return below, since a
    // collapsed thread's node exists and flashComment would otherwise return first.
    setExpandComment({ id, n: ++expandCommentN.current });
    if (flashComment(id)) return;
    // The file may be lazy-unmounted/collapsed: signal expand, scroll to trigger
    // mount, then retry the flash once it renders.
    const c = comments.find((x) => x.id === id);
    if (!c) return;
    setExpandTarget({ path: c.filePath, n: ++expandN.current });
    document.getElementById(`file-${c.filePath}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
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
    setSelectedFile(path);
    document.getElementById(`file-${path}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  // Clear navigation state (e.g. on a repo switch), cancelling any in-flight jump.
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
