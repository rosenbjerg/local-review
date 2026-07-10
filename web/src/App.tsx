import { useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from "react";
import { api } from "./api";
import { CommentsPanel } from "./components/CommentsPanel";
import { DiffView, LARGE_FILE_LINES } from "./components/DiffView";
import { ExportModal } from "./components/ExportModal";
import { FileExplorer, orderedFiles } from "./components/FileExplorer";
import { LazyFile } from "./components/LazyFile";
import type { Branch, Comment, CommentType, FileDiff, Review } from "./types";
import { effectiveLines } from "./types";
import { useFocusTrap } from "./useFocusTrap";

const LS_LEFT = "lr.leftWidth";
const LS_RIGHT = "lr.rightWidth";
const LS_BASE_BY_REPO = "lr.baseByRepo";
const LS_REPO = "lr.repo";

function readWidth(key: string, def: number): number {
  const v = Number(localStorage.getItem(key));
  return Number.isFinite(v) && v > 0 ? v : def;
}

// Remembered base branch per repo (empty string = auto). Branch names differ
// across repos, so the preference is keyed by repo path.
function readBasePref(repo: string): string {
  try {
    const map = JSON.parse(localStorage.getItem(LS_BASE_BY_REPO) || "{}");
    const v = map[repo];
    return typeof v === "string" ? v : "";
  } catch {
    return "";
  }
}

function writeBasePref(repo: string, base: string): void {
  try {
    const map = JSON.parse(localStorage.getItem(LS_BASE_BY_REPO) || "{}");
    map[repo] = base;
    localStorage.setItem(LS_BASE_BY_REPO, JSON.stringify(map));
  } catch {
    // storage unavailable/full — preference is best-effort
  }
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

export default function App() {
  const [repos, setRepos] = useState<string[]>([]);
  const [reposLoaded, setReposLoaded] = useState(false); // repo discovery finished
  const [repo, setRepo] = useState("");
  const [branches, setBranches] = useState<Branch[]>([]);
  const [head, setHead] = useState("");
  const [base, setBase] = useState("");
  const [review, setReview] = useState<Review | null>(null);
  const [files, setFiles] = useState<FileDiff[]>([]);
  const [baseSha, setBaseSha] = useState(""); // resolved merge-base, for image "before"
  const [comments, setComments] = useState<Comment[]>([]);
  const [reviewedFiles, setReviewedFiles] = useState<Set<string>>(new Set());
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [uncommitted, setUncommitted] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showExport, setShowExport] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [confirmingReset, setConfirmingReset] = useState(false);
  // The comment last jumped to (via click or n/p), so n/p can step from it.
  const [activeComment, setActiveComment] = useState<number | null>(null);
  const [promptCopied, setPromptCopied] = useState(false);
  const [leftW, setLeftW] = useState(() => readWidth(LS_LEFT, 260));
  const [rightW, setRightW] = useState(() => readWidth(LS_RIGHT, 380));
  const mainRef = useRef<HTMLDivElement>(null);
  const diffColRef = useRef<HTMLDivElement>(null);
  const expandN = useRef(0);
  const [expandTarget, setExpandTarget] = useState<{ path: string; n: number } | null>(null);
  // Monotonic token identifying the latest load. A repo switch or a newer
  // startReview bumps it; in-flight responses check it before applying state so
  // a stale repo's review/diff can't repopulate the UI for the new selection.
  const reqSeq = useRef(0);
  // Focus traps for the two inline modals (the export modal manages its own).
  // Only one is ever open at a time; each restores focus to its trigger on close.
  const helpTrapRef = useFocusTrap<HTMLDivElement>(showHelp);
  const resetTrapRef = useFocusTrap<HTMLDivElement>(confirmingReset);

  useEffect(() => {
    localStorage.setItem(LS_LEFT, String(leftW));
  }, [leftW]);
  useEffect(() => {
    localStorage.setItem(LS_RIGHT, String(rightW));
  }, [rightW]);

  // Resize by writing grid-template-columns directly to the DOM during the drag
  // (no React re-render per mousemove — important with large diffs mounted),
  // then commit to state once on release so it persists.
  function startResize(e: ReactMouseEvent, side: "left" | "right") {
    e.preventDefault();
    const startX = e.clientX;
    const startLeft = leftW;
    const startRight = rightW;
    let finalLeft = startLeft;
    let finalRight = startRight;
    const onMove = (ev: MouseEvent) => {
      const dx = ev.clientX - startX;
      if (side === "left") finalLeft = clamp(startLeft + dx, 160, 560);
      else finalRight = clamp(startRight - dx, 220, 640);
      if (mainRef.current) {
        mainRef.current.style.gridTemplateColumns = `${finalLeft}px 6px 1fr 6px ${finalRight}px`;
      }
    };
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      document.body.style.userSelect = "";
      document.body.style.cursor = "";
      setLeftW(finalLeft);
      setRightW(finalRight);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    document.body.style.userSelect = "none";
    document.body.style.cursor = "col-resize";
  }

  // Reflect the active review in the tab title so several open reviews (the
  // whole point of the SSE multi-tab sync) are tellable apart at a glance.
  useEffect(() => {
    document.title = review
      ? `${repo} · ${review.headRef} → ${review.baseRef} — local-review`
      : "local-review";
  }, [review, repo]);

  // Discover repositories under the root once on load.
  useEffect(() => {
    api
      .repos()
      .then((r) => {
        setRepos(r.repos);
        // Restore the last-used repo if it still exists, else the first.
        const saved = localStorage.getItem(LS_REPO);
        setRepo(saved && r.repos.includes(saved) ? saved : (r.repos[0] ?? ""));
      })
      .catch((e) => setError((e as Error).message))
      .finally(() => setReposLoaded(true));
  }, []);

  // When the active repo changes, load its branches and clear any prior review.
  useEffect(() => {
    // Invalidate any in-flight load so a stale response can't land on the
    // newly-selected repo, and drop its loading state.
    reqSeq.current++;
    const seq = reqSeq.current;
    setLoading(false);
    // Clear the previous repo's branches/head synchronously so the dropdowns
    // never show branches that don't belong to the selected repo.
    setBranches([]);
    setHead("");
    if (!repo) return;
    setReview(null);
    setFiles([]);
    setComments([]);
    setReviewedFiles(new Set());
    setSelectedFile(null);
    setExpandTarget(null);
    setBase("");
    setUncommitted(false);
    api
      .branches(repo)
      .then((r) => {
        if (reqSeq.current !== seq) return; // superseded by another repo switch
        setBranches(r.branches);
        const current = r.branches.find((b) => b.isCurrent);
        setHead(current?.name ?? r.branches[0]?.name ?? "");
        // Restore the last base chosen for this repo, if it still exists
        // (auto/"" is always valid).
        const savedBase = readBasePref(repo);
        if (savedBase === "" || r.branches.some((b) => b.name === savedBase)) {
          setBase(savedBase);
        }
      })
      .catch((e) => {
        if (reqSeq.current === seq) setError((e as Error).message);
      });
  }, [repo]);

  // Live-sync this review across tabs. The server pushes a "changed" ping over
  // SSE whenever another tab mutates a comment or reviewed-file; we refetch the
  // whole review (backend is source of truth — the diff isn't refetched since
  // HEAD is pinned per review). Focus/visibility refetch stays as a catch-up for
  // when the stream is down (sleep, server restart, dropped ping), gated on the
  // stream not being OPEN so a healthy connection doesn't double-fetch.
  useEffect(() => {
    if (!review) return;
    const id = review.id;
    let cancelled = false;
    let inFlight = false;
    async function refresh() {
      if (inFlight || cancelled || document.visibilityState !== "visible") return;
      inFlight = true;
      try {
        const rev = await api.getReview(id);
        if (!cancelled) {
          setReview(rev);
          setComments(rev.comments ?? []);
          setReviewedFiles(new Set(rev.reviewedFiles ?? []));
        }
      } catch {
        // Transient refresh failure — keep the current state.
      } finally {
        inFlight = false;
      }
    }
    const es = new EventSource(`/api/reviews/${id}/events`);
    es.onmessage = () => refresh();
    // onerror is left to EventSource's own auto-reconnect; the fallback covers
    // the gap while it's down.
    function onFocus() {
      if (es.readyState === EventSource.OPEN) return; // stream live — it'll push
      refresh();
    }
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);
    return () => {
      cancelled = true;
      es.close();
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onFocus);
    };
  }, [review?.id]);

  // Refetch the diff when the "include uncommitted" toggle changes for an
  // active review. The initial diff is loaded by startReview; keying on
  // `uncommitted` alone means this only fires on a later toggle, not on load.
  useEffect(() => {
    if (!review) return;
    const seq = ++reqSeq.current;
    setLoading(true);
    api
      .diff(repo, review.headRef, review.baseRef, effectiveUncommitted)
      .then((d) => {
        if (reqSeq.current !== seq) return;
        setFiles(d.files ?? []);
        setBaseSha(d.base ?? "");
      })
      .catch((e) => {
        if (reqSeq.current === seq) setError((e as Error).message);
      })
      .finally(() => {
        if (reqSeq.current === seq) setLoading(false);
      });
  }, [uncommitted]);

  async function startReview() {
    if (!repo || !head) return;
    const seq = ++reqSeq.current;
    setLoading(true);
    setError(null);
    try {
      const rev = await api.createReview(repo, head, base || undefined);
      if (reqSeq.current !== seq) return; // superseded by a repo switch / newer load
      setReview(rev);
      setComments(rev.comments ?? []);
      setReviewedFiles(new Set(rev.reviewedFiles ?? []));
      const diff = await api.diff(repo, rev.headRef, rev.baseRef, effectiveUncommitted);
      if (reqSeq.current !== seq) return;
      setFiles(diff.files ?? []);
      setBaseSha(diff.base ?? "");
    } catch (e) {
      if (reqSeq.current !== seq) return;
      // The selected head may have gone stale (deleted/renamed/mid-rebase since
      // the branch list loaded). Refetch branches; if head vanished, drop it and
      // fall back to the current branch — the head change re-fires this review
      // via the auto-start effect. If head still exists, the failure was
      // something else, so surface it.
      let recovered = false;
      try {
        const r = await api.branches(repo);
        if (reqSeq.current === seq && !r.branches.some((b) => b.name === head)) {
          setBranches(r.branches);
          const current = r.branches.find((b) => b.isCurrent);
          setHead(current?.name ?? r.branches[0]?.name ?? "");
          recovered = true;
        }
      } catch {
        // Ignore; fall through to surfacing the original error.
      }
      if (!recovered && reqSeq.current === seq) setError((e as Error).message);
    } finally {
      if (reqSeq.current === seq) setLoading(false);
    }
  }

  // Auto-start (or restart) the review whenever the repo/head/base selection is
  // complete — selecting a branch is enough, no "Start review" click. Keyed on
  // the selection only; the uncommitted toggle has its own diff-refetch effect.
  useEffect(() => {
    if (repo && head) startReview();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repo, head, base]);

  // Returns true on success so the caller only closes its composer when the
  // comment actually saved (otherwise the typed text would be lost).
  async function handleAddComment(args: {
    filePath: string;
    startLine: number;
    endLine: number;
    snippet: string;
    body: string;
    type: CommentType;
  }): Promise<boolean> {
    if (!review) return false;
    try {
      // Tag the comment as working-tree-anchored when reviewing uncommitted
      // changes, so its snippet is later checked against the working tree
      // (not the committed head) and doesn't read as instantly outdated.
      const c = await api.addComment(review.id, { ...args, worktree: effectiveUncommitted });
      setComments((cs) => [...cs, c]);
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    }
  }

  async function handleUpdate(id: number, body: string, type: CommentType): Promise<boolean> {
    const existing = comments.find((c) => c.id === id);
    if (!existing) return false;
    try {
      const updated = await api.updateComment(id, {
        body,
        type,
        startLine: existing.startLine,
        endLine: existing.endLine,
      });
      setComments((cs) => cs.map((c) => (c.id === id ? updated : c)));
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    }
  }

  async function handleDelete(id: number) {
    try {
      await api.deleteComment(id);
      setComments((cs) => cs.filter((c) => c.id !== id));
    } catch (e) {
      setError((e as Error).message);
    }
  }

  // Reply handlers mutate the nested `replies` array of the parent comment. The
  // commentId is threaded through (rather than looked up from the reply) so the
  // state update stays a single map over comments.
  async function handleAddReply(commentId: number, body: string): Promise<boolean> {
    try {
      const rep = await api.addReply(commentId, body);
      setComments((cs) =>
        cs.map((c) => (c.id === commentId ? { ...c, replies: [...(c.replies ?? []), rep] } : c))
      );
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    }
  }

  async function handleUpdateReply(
    commentId: number,
    replyId: number,
    body: string
  ): Promise<boolean> {
    try {
      const rep = await api.updateReply(replyId, body);
      setComments((cs) =>
        cs.map((c) =>
          c.id === commentId
            ? { ...c, replies: (c.replies ?? []).map((r) => (r.id === replyId ? rep : r)) }
            : c
        )
      );
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    }
  }

  async function handleDeleteReply(commentId: number, replyId: number) {
    try {
      await api.deleteReply(replyId);
      setComments((cs) =>
        cs.map((c) =>
          c.id === commentId
            ? { ...c, replies: (c.replies ?? []).filter((r) => r.id !== replyId) }
            : c
        )
      );
    } catch (e) {
      setError((e as Error).message);
    }
  }

  // Resolve/reopen is optimistic (the dim/label flips immediately), rolling back
  // if the save fails — matching toggleReviewed.
  async function handleResolve(id: number, resolved: boolean) {
    setComments((cs) => cs.map((c) => (c.id === id ? { ...c, resolved } : c)));
    try {
      await api.setCommentResolved(id, resolved);
    } catch (e) {
      setComments((cs) => cs.map((c) => (c.id === id ? { ...c, resolved: !resolved } : c)));
      setError((e as Error).message);
    }
  }

  // Wipes the review clean: deletes every comment and unmarks every reviewed
  // file, keeping the review itself (the same branch resumes empty). It's
  // irreversible, so the Reset button opens a confirmation dialog first.
  function requestReset() {
    if (!review) return;
    if (comments.length === 0 && reviewedFiles.size === 0) return;
    setConfirmingReset(true);
  }

  // Runs the wipe after the dialog is confirmed. Clears local state on success;
  // the SSE ping keeps other tabs in sync.
  async function performReset() {
    setConfirmingReset(false);
    if (!review) return;
    try {
      await api.resetReview(review.id);
      setComments([]);
      setReviewedFiles(new Set());
    } catch (e) {
      setError((e as Error).message);
    }
  }

  function flashComment(id: number): boolean {
    const el = document.getElementById(`comment-${id}`);
    if (!el) return false;
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    el.classList.add("thread-flash");
    setTimeout(() => el.classList.remove("thread-flash"), 1200);
    return true;
  }

  function jumpTo(id: number) {
    setActiveComment(id);
    if (flashComment(id)) return;
    // The comment's file may be unmounted (lazy rendering) and/or collapsed
    // (large/reviewed file). Signal its DiffView to expand, scroll to trigger
    // mount, then retry the flash once it has rendered.
    const c = comments.find((x) => x.id === id);
    if (!c) return;
    setExpandTarget({ path: c.filePath, n: ++expandN.current });
    document.getElementById(`file-${c.filePath}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
    // Poll until the lazy file mounts and the comment renders, rather than
    // guessing a fixed delay (which fails on slow devices / long scrolls).
    let tries = 0;
    const poll = () => {
      if (flashComment(id) || tries++ > 40) return; // ~4s cap
      setTimeout(poll, 100);
    };
    setTimeout(poll, 100);
  }

  function jumpToFile(path: string) {
    setSelectedFile(path);
    document.getElementById(`file-${path}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  async function toggleReviewed(path: string, reviewed: boolean) {
    setReviewedFiles((s) => {
      const n = new Set(s);
      if (reviewed) n.add(path);
      else n.delete(path);
      return n;
    });
    if (!review) return;
    try {
      // Tag the fingerprint side to match what's on screen (uncommitted view ⇒
      // working tree), mirroring how new comments are anchored (see addComment).
      await api.setReviewed(review.id, path, reviewed, effectiveUncommitted);
    } catch (e) {
      // Roll back the optimistic change so the file isn't left marked
      // reviewed/collapsed when the save didn't actually land.
      setReviewedFiles((s) => {
        const n = new Set(s);
        if (reviewed) n.delete(path);
        else n.add(path);
        return n;
      });
      setError((e as Error).message);
    }
  }

  // Rough rendered height for a not-yet-mounted file, so the scrollbar and
  // jump-to-file behave before the diff mounts. Mirrors the collapse decision.
  function estFileHeight(f: FileDiff): number {
    const path = f.newPath || f.oldPath;
    const lines = f.hunks.reduce((n, h) => n + h.lines.length, 0);
    const collapsed = reviewedFiles.has(path) || lines > LARGE_FILE_LINES;
    if (collapsed) return 44;
    if (f.binary) return 400; // image/binary media view is roughly this tall
    return Math.min(lines, 400) * 18 + 44;
  }

  // Copies a short prompt pointing a coding agent at this review's API: fetch
  // the markdown directly and reply to comments by id. Uses the browser's own
  // origin so the URLs match wherever the server is reachable.
  async function copyAgentInstructions() {
    if (!review) return;
    const origin = window.location.origin;
    const text = `This is a code review produced with local-review. Fetch it from the API and address each comment.

# Fetch the review as markdown. The response is JSON; read its "markdown" field.
# Each comment is headed with an id like "#42".
curl -s -X POST ${origin}/api/reviews/${review.id}/export | jq -r .markdown

# Reply to a comment by its id (e.g. ask a question or note what you changed).
curl -s -X POST ${origin}/api/comments/<id>/replies \\
  -H 'Content-Type: application/json' \\
  -d '{"body": "your reply here"}'
`;
    try {
      await navigator.clipboard.writeText(text);
      setPromptCopied(true);
      setTimeout(() => setPromptCopied(false), 1500);
    } catch {
      setError("Copy failed — clipboard unavailable");
    }
  }

  const shortSha = review?.headSha.slice(0, 7);
  const mainBranch = branches.find((b) => b.isMain)?.name;
  // Uncommitted changes live in the working tree, which reflects the
  // checked-out branch — so the toggle only makes sense when head is current.
  const currentBranch = branches.find((b) => b.isCurrent)?.name;
  const headIsCurrent = !!head && head === currentBranch;
  // Effective toggle: uncommitted only applies on the checked-out branch. Kept
  // separate from the raw checkbox state so hopping branches doesn't clear the
  // user's choice — and, crucially, doesn't mutate `uncommitted` on a head
  // change, which would fire the diff-refetch effect on top of the auto-start.
  const effectiveUncommitted = uncommitted && headIsCurrent;
  // Render the middle pane in the same order the left-pane tree shows.
  const orderedDiffFiles = useMemo(() => orderedFiles(files), [files]);

  // Comment ids in reading order (file order, then line) — the sequence n/p
  // steps through. Comments whose file isn't in the diff trail at the end.
  const orderedCommentIds = useMemo(() => {
    const ids: number[] = [];
    const seen = new Set<number>();
    for (const f of orderedDiffFiles) {
      const p = f.newPath || f.oldPath;
      const inFile = comments
        .filter((c) => c.filePath === p)
        .sort((a, b) => effectiveLines(a).start - effectiveLines(b).start);
      for (const c of inFile) {
        ids.push(c.id);
        seen.add(c.id);
      }
    }
    for (const c of comments) if (!seen.has(c.id)) ids.push(c.id);
    return ids;
  }, [orderedDiffFiles, comments]);

  // Global keyboard shortcuts. Suppressed while typing in a field or with a
  // modifier held (so browser shortcuts still work); the help overlay and
  // export modal capture keys while open. See the `?` overlay for the list.
  useEffect(() => {
    if (!review) return;
    const fileList = orderedDiffFiles.map((f) => f.newPath || f.oldPath);
    const moveFile = (delta: number) => {
      if (fileList.length === 0) return;
      const cur = selectedFile ? fileList.indexOf(selectedFile) : -1;
      const next =
        cur === -1 ? (delta > 0 ? 0 : fileList.length - 1) : clamp(cur + delta, 0, fileList.length - 1);
      jumpToFile(fileList[next]);
    };
    const moveComment = (delta: number) => {
      if (orderedCommentIds.length === 0) return;
      const cur = activeComment != null ? orderedCommentIds.indexOf(activeComment) : -1;
      const next =
        cur === -1
          ? delta > 0
            ? 0
            : orderedCommentIds.length - 1
          : clamp(cur + delta, 0, orderedCommentIds.length - 1);
      jumpTo(orderedCommentIds[next]);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (
        t &&
        (t.tagName === "INPUT" ||
          t.tagName === "TEXTAREA" ||
          t.tagName === "SELECT" ||
          t.isContentEditable)
      ) {
        return;
      }
      if (showHelp) {
        if (e.key === "Escape" || e.key === "?") {
          e.preventDefault();
          setShowHelp(false);
        }
        return;
      }
      if (confirmingReset) {
        if (e.key === "Escape") {
          e.preventDefault();
          setConfirmingReset(false);
        }
        return;
      }
      if (showExport) return; // the export modal handles its own Escape
      switch (e.key) {
        case "j":
          e.preventDefault();
          moveFile(1);
          break;
        case "k":
          e.preventDefault();
          moveFile(-1);
          break;
        case "n":
          e.preventDefault();
          moveComment(1);
          break;
        case "p":
          e.preventDefault();
          moveComment(-1);
          break;
        case "e":
          e.preventDefault();
          setShowExport(true);
          break;
        case "r":
          if (!loading) {
            e.preventDefault();
            startReview();
          }
          break;
        case "?":
          e.preventDefault();
          setShowHelp(true);
          break;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    review,
    showExport,
    showHelp,
    confirmingReset,
    loading,
    repo,
    head,
    base,
    orderedDiffFiles,
    orderedCommentIds,
    selectedFile,
    activeComment,
  ]);

  return (
    <div className="app">
      <header className="topbar">
        <span className="logo">local-review</span>
        <label>
          repo
          <select
            value={repo}
            onChange={(e) => {
              setRepo(e.target.value);
              localStorage.setItem(LS_REPO, e.target.value);
            }}
            disabled={loading}
          >
            {repos.length === 0 && <option value="">(none found)</option>}
            {repos.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
        </label>
        <label>
          head
          <select
            value={head}
            onChange={(e) => setHead(e.target.value)}
            disabled={loading}
          >
            {branches.map((b) => (
              <option key={b.name} value={b.name}>
                {b.name}
                {b.isCurrent ? " *" : ""}
              </option>
            ))}
          </select>
        </label>
        <span className="arrow">→</span>
        <label>
          base
          <select
            value={base}
            onChange={(e) => {
              setBase(e.target.value);
              writeBasePref(repo, e.target.value);
            }}
            disabled={loading}
          >
            <option value="">
              auto{mainBranch ? ` (${mainBranch})` : ""}
            </option>
            {branches.map((b) => (
              <option key={b.name} value={b.name}>
                {b.name}
                {b.isMain ? " (main)" : ""}
              </option>
            ))}
          </select>
        </label>
        {headIsCurrent && (
          <label className="checkbox" title="Diff against the working tree instead of the head commit (staged + unstaged tracked changes; excludes untracked files)">
            <input
              type="checkbox"
              checked={uncommitted}
              onChange={(e) => setUncommitted(e.target.checked)}
              disabled={loading}
            />
            uncommitted
          </label>
        )}
        <button
          className="btn"
          onClick={startReview}
          disabled={loading || !repo || !head}
          title="Re-run the review to pick up new commits"
        >
          {loading ? "Loading…" : "Reload"}
        </button>
        <span className="spacer" />
        {review && (
          <>
            <span className="muted">
              {shortSha}
              {effectiveUncommitted && " + uncommitted"}
            </span>
            <button
              className="btn"
              onClick={copyAgentInstructions}
              title="Copy a prompt telling a coding agent how to fetch this review from the API and reply to comments"
            >
              {promptCopied ? "Copied ✓" : "Copy agent instructions"}
            </button>
            <button
              className="btn"
              onClick={() => setShowExport(true)}
              title="Exports unresolved threads"
            >
              Export ({comments.filter((c) => !c.resolved).length})
            </button>
            <button
              className="btn danger"
              onClick={requestReset}
              disabled={comments.length === 0 && reviewedFiles.size === 0}
              title="Delete all comments and unmark all reviewed files"
            >
              Reset
            </button>
          </>
        )}
        <button
          className="btn btn-icon"
          onClick={() => setShowHelp(true)}
          title="Keyboard shortcuts (?)"
          aria-label="Keyboard shortcuts"
        >
          ?
        </button>
        <a
          className="btn btn-icon"
          href="https://github.com/rosenbjerg/local-review"
          target="_blank"
          rel="noopener noreferrer"
          title="View local-review on GitHub"
          aria-label="View local-review on GitHub"
        >
          <svg aria-hidden="true" viewBox="0 0 24 24" width="18" height="18" fill="currentColor">
            <path d="M10.226 17.284c-2.965-.36-5.054-2.493-5.054-5.256 0-1.123.404-2.336 1.078-3.144-.292-.741-.247-2.314.09-2.965.898-.112 2.111.36 2.83 1.01.853-.269 1.752-.404 2.853-.404 1.1 0 1.999.135 2.807.382.696-.629 1.932-1.1 2.83-.988.315.606.36 2.179.067 2.942.72.854 1.101 2 1.101 3.167 0 2.763-2.089 4.852-5.098 5.234.763.494 1.28 1.572 1.28 2.807v2.336c0 .674.561 1.056 1.235.786 4.066-1.55 7.255-5.615 7.255-10.646C23.5 6.188 18.334 1 11.978 1 5.62 1 .5 6.188.5 12.545c0 4.986 3.167 9.12 7.435 10.669.606.225 1.19-.18 1.19-.786V20.63a2.9 2.9 0 0 1-1.078.224c-1.483 0-2.359-.808-2.987-2.313-.247-.607-.517-.966-1.034-1.033-.27-.023-.359-.135-.359-.27 0-.27.45-.471.898-.471.652 0 1.213.404 1.797 1.235.45.651.921.943 1.483.943.561 0 .92-.202 1.437-.719.382-.381.674-.718.944-.943"></path>
          </svg>
        </a>
      </header>

      {error && <div className="error banner">{error}</div>}

      {!review && !error && (
        <div className="empty">
          {reposLoaded && repos.length === 0
            ? "No git repositories found under the served folder."
            : "Select a branch to start a review."}
        </div>
      )}

      {review && (
        <div
          className="main"
          ref={mainRef}
          style={{ gridTemplateColumns: `${leftW}px 6px 1fr 6px ${rightW}px` }}
        >
          <aside className="explorer-column">
            <FileExplorer
              files={files}
              comments={comments}
              reviewed={reviewedFiles}
              selected={selectedFile}
              onSelect={jumpToFile}
              onToggleReviewed={toggleReviewed}
            />
          </aside>
          <div className="resizer" onMouseDown={(e) => startResize(e, "left")} />
          <div className="diff-column" ref={diffColRef}>
            {files.length === 0 && !loading && (
              <div className="empty">No changes between base and head.</div>
            )}
            {orderedDiffFiles.map((f) => {
              const path = f.newPath || f.oldPath;
              return (
                <LazyFile
                  key={path}
                  anchorId={`file-${path}`}
                  label={path}
                  estHeight={estFileHeight(f)}
                  rootRef={diffColRef}
                >
                  <DiffView
                    file={f}
                    repo={repo}
                    headRef={review.headRef}
                    baseRef={baseSha}
                    uncommitted={effectiveUncommitted}
                    comments={comments.filter((c) => c.filePath === path)}
                    onAddComment={handleAddComment}
                    onUpdateComment={handleUpdate}
                    onDeleteComment={handleDelete}
                    onAddReply={handleAddReply}
                    onUpdateReply={handleUpdateReply}
                    onDeleteReply={handleDeleteReply}
                    onResolve={handleResolve}
                    reviewed={reviewedFiles.has(path)}
                    onToggleReviewed={(r) => toggleReviewed(path, r)}
                    expandTarget={expandTarget}
                  />
                </LazyFile>
              );
            })}
          </div>
          <div className="resizer" onMouseDown={(e) => startResize(e, "right")} />
          <aside className="side-column">
            <CommentsPanel comments={comments} onJump={jumpTo} onDelete={handleDelete} />
          </aside>
        </div>
      )}

      {showExport && review && (
        <ExportModal reviewId={review.id} onClose={() => setShowExport(false)} />
      )}

      {showHelp && (
        <div className="modal-backdrop" onClick={() => setShowHelp(false)}>
          <div className="modal modal-sm" ref={helpTrapRef} onClick={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <h2>Keyboard shortcuts</h2>
              <span className="spacer" />
              <button className="btn" onClick={() => setShowHelp(false)}>
                Close
              </button>
            </div>
            <div className="help-body">
              <table className="shortcuts">
                <tbody>
                  <tr>
                    <td>
                      <kbd>j</kbd> / <kbd>k</kbd>
                    </td>
                    <td>Next / previous file</td>
                  </tr>
                  <tr>
                    <td>
                      <kbd>n</kbd> / <kbd>p</kbd>
                    </td>
                    <td>Next / previous comment</td>
                  </tr>
                  <tr>
                    <td>
                      <kbd>e</kbd>
                    </td>
                    <td>Export review</td>
                  </tr>
                  <tr>
                    <td>
                      <kbd>r</kbd>
                    </td>
                    <td>Reload review</td>
                  </tr>
                  <tr>
                    <td>
                      <kbd>?</kbd>
                    </td>
                    <td>Toggle this help</td>
                  </tr>
                  <tr>
                    <td>
                      <kbd>Esc</kbd>
                    </td>
                    <td>Close a dialog / cancel a comment</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {confirmingReset && (
        <div className="modal-backdrop" onClick={() => setConfirmingReset(false)}>
          <div className="modal modal-sm" ref={resetTrapRef} onClick={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <h2>Reset review?</h2>
            </div>
            <div className="confirm-body">
              <p>
                This deletes{" "}
                <strong>
                  {comments.length} comment{comments.length === 1 ? "" : "s"}
                </strong>{" "}
                and unmarks{" "}
                <strong>
                  {reviewedFiles.size} reviewed file{reviewedFiles.size === 1 ? "" : "s"}
                </strong>{" "}
                in this review. It can't be undone.
              </p>
            </div>
            <div className="confirm-actions">
              <button className="btn" data-autofocus onClick={() => setConfirmingReset(false)}>
                Cancel
              </button>
              <button className="btn danger" onClick={performReset}>
                Delete everything
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
