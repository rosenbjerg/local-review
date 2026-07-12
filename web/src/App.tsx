import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
} from "react";
import { api } from "./api";
import { AgentPromptsModal } from "./components/AgentPromptsModal";
import { CommentsPanel } from "./components/CommentsPanel";
import type { CommentActions } from "./components/CommentThread";
import { DiffView, LARGE_FILE_LINES } from "./components/DiffView";
import { ExportModal } from "./components/ExportModal";
import { FileExplorer, orderedFiles } from "./components/FileExplorer";
import { LazyFile } from "./components/LazyFile";
import { Modal } from "./components/Modal";
import type { Branch, Comment, CommentType, FileDiff, Reply, Review } from "./types";
import { effectiveLines } from "./types";
import { LS, getJSON, getNumber, getString, setJSON, setNumber, setString } from "./storage";

function readBasePref(repo: string): string {
  const v = getJSON<Record<string, string>>(LS.baseByRepo, {})[repo];
  return typeof v === "string" ? v : "";
}

function writeBasePref(repo: string, base: string): void {
  const map = getJSON<Record<string, string>>(LS.baseByRepo, {});
  map[repo] = base;
  setJSON(LS.baseByRepo, map);
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

export default function App() {
  const [repos, setRepos] = useState<string[]>([]);
  const [reposLoaded, setReposLoaded] = useState(false);
  const [repo, setRepo] = useState("");
  const [branches, setBranches] = useState<Branch[]>([]);
  const [head, setHead] = useState("");
  const [base, setBase] = useState("");
  const [review, setReview] = useState<Review | null>(null);
  const [files, setFiles] = useState<FileDiff[]>([]);
  const [baseSha, setBaseSha] = useState("");
  const [comments, setComments] = useState<Comment[]>([]);
  const [reviewedFiles, setReviewedFiles] = useState<Set<string>>(new Set());
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [uncommitted, setUncommitted] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showExport, setShowExport] = useState(false);
  const [showPrompts, setShowPrompts] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [confirmingReset, setConfirmingReset] = useState(false);
  const [activeComment, setActiveComment] = useState<number | null>(null);
  const [leftW, setLeftW] = useState(() => getNumber(LS.leftWidth, 260));
  const [rightW, setRightW] = useState(() => getNumber(LS.rightWidth, 380));
  const mainRef = useRef<HTMLDivElement>(null);
  const diffColRef = useRef<HTMLDivElement>(null);
  const expandN = useRef(0);
  const jumpPoll = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [expandTarget, setExpandTarget] = useState<{ path: string; n: number } | null>(null);
  // Bumped on each load; in-flight responses check it before applying state, so
  // a stale repo's review/diff can't repopulate the UI for the new selection.
  const reqSeq = useRef(0);

  useEffect(
    () => () => {
      if (jumpPoll.current !== null) clearTimeout(jumpPoll.current);
    },
    []
  );

  useEffect(() => {
    setNumber(LS.leftWidth, leftW);
  }, [leftW]);
  useEffect(() => {
    setNumber(LS.rightWidth, rightW);
  }, [rightW]);

  // Write grid-template-columns straight to the DOM during the drag — a
  // per-mousemove setState re-renders every mounted diff — then commit on release.
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

  function onResizeKey(e: ReactKeyboardEvent, side: "left" | "right") {
    const step = e.shiftKey ? 40 : 12;
    let delta = 0;
    if (e.key === "ArrowLeft") delta = -step;
    else if (e.key === "ArrowRight") delta = step;
    else return;
    e.preventDefault();
    if (side === "left") setLeftW((w) => clamp(w + delta, 160, 560));
    else setRightW((w) => clamp(w - delta, 220, 640));
  }

  useEffect(() => {
    document.title = review
      ? `${repo} · ${review.headRef} → ${review.baseRef} — local-review`
      : "local-review";
  }, [review, repo]);

  useEffect(() => {
    api
      .repos()
      .then((r) => {
        setRepos(r.repos);
        const saved = getString(LS.repo);
        setRepo(saved && r.repos.includes(saved) ? saved : (r.repos[0] ?? ""));
      })
      .catch((e) => setError((e as Error).message))
      .finally(() => setReposLoaded(true));
  }, []);

  useEffect(() => {
    reqSeq.current++;
    const seq = reqSeq.current;
    setLoading(false);
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
        const savedBase = readBasePref(repo);
        if (savedBase === "" || r.branches.some((b) => b.name === savedBase)) {
          setBase(savedBase);
        }
      })
      .catch((e) => {
        if (reqSeq.current === seq) setError((e as Error).message);
      });
  }, [repo]);

  // Refetch the whole review on an SSE "changed" ping; HEAD is pinned so the diff
  // isn't refetched. The focus/visibility refetch is a fallback for a dead stream,
  // gated on the stream not being OPEN so a healthy one doesn't double-fetch.
  useEffect(() => {
    if (!review) return;
    const id = review.id;
    let cancelled = false;
    let inFlight = false;
    let pending = false;
    async function refresh() {
      if (cancelled || document.visibilityState !== "visible") return;
      if (inFlight) {
        // Ping mid-fetch: the in-flight response may predate the change, so
        // queue exactly one trailing refetch rather than drop it.
        pending = true;
        return;
      }
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
        if (pending && !cancelled) {
          pending = false;
          refresh();
        }
      }
    }
    const es = new EventSource(`/api/reviews/${id}/events`);
    es.onmessage = () => refresh();
    // No onerror — EventSource auto-reconnects; the focus fallback covers the gap.
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

  // Refetch the diff when the uncommitted toggle flips — keyed on `uncommitted`
  // alone so it fires only on a later toggle, not on load.
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
      // head may be stale (deleted/renamed/mid-rebase): refetch branches and, if
      // it's gone, fall back to current (auto-start re-fires); else surface the error.
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
        // ignore — surface the original error below
      }
      if (!recovered && reqSeq.current === seq) setError((e as Error).message);
    } finally {
      if (reqSeq.current === seq) setLoading(false);
    }
  }

  // Auto-start on a complete repo/head/base selection; the uncommitted toggle has
  // its own effect, so it's not a dep here.
  useEffect(() => {
    if (repo && head) startReview();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repo, head, base]);

  // Returns success so the caller can keep the composer (and its text) open on failure.
  async function handleAddComment(args: {
    filePath: string;
    startLine: number;
    endLine: number;
    body: string;
    type: CommentType;
  }): Promise<boolean> {
    if (!review) return false;
    setError(null);
    try {
      // Anchor to the working tree for uncommitted reviews, so the server captures
      // the snippet from the side the staleness check reads (head would read outdated).
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
    setError(null);
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
    setError(null);
    try {
      await api.deleteComment(id);
      setComments((cs) => cs.filter((c) => c.id !== id));
    } catch (e) {
      setError((e as Error).message);
    }
  }

  function updateCommentReplies(commentId: number, fn: (replies: Reply[]) => Reply[]) {
    setComments((cs) =>
      cs.map((c) => (c.id === commentId ? { ...c, replies: fn(c.replies ?? []) } : c))
    );
  }

  async function handleAddReply(commentId: number, body: string): Promise<boolean> {
    setError(null);
    try {
      const rep = await api.addReply(commentId, body);
      updateCommentReplies(commentId, (replies) => [...replies, rep]);
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
    setError(null);
    try {
      const rep = await api.updateReply(replyId, body);
      updateCommentReplies(commentId, (replies) => replies.map((r) => (r.id === replyId ? rep : r)));
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    }
  }

  async function handleDeleteReply(commentId: number, replyId: number) {
    setError(null);
    try {
      await api.deleteReply(replyId);
      updateCommentReplies(commentId, (replies) => replies.filter((r) => r.id !== replyId));
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function handleResolve(id: number, resolved: boolean) {
    setError(null);
    setComments((cs) => cs.map((c) => (c.id === id ? { ...c, resolved } : c)));
    try {
      await api.setCommentResolved(id, resolved);
    } catch (e) {
      setComments((cs) => cs.map((c) => (c.id === id ? { ...c, resolved: !resolved } : c)));
      setError((e as Error).message);
    }
  }

  // Rebuilt each render so the handlers close over live `comments`; do not memoize.
  const commentActions: CommentActions = {
    onUpdate: handleUpdate,
    onDelete: handleDelete,
    onAddReply: handleAddReply,
    onUpdateReply: handleUpdateReply,
    onDeleteReply: handleDeleteReply,
    onResolve: handleResolve,
  };

  function requestReset() {
    if (!review) return;
    if (comments.length === 0 && reviewedFiles.size === 0) return;
    setConfirmingReset(true);
  }

  async function performReset() {
    setConfirmingReset(false);
    if (!review) return;
    setError(null);
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
    // Supersede any in-flight jump so rapid n/p doesn't stack scroll loops.
    if (jumpPoll.current !== null) {
      clearTimeout(jumpPoll.current);
      jumpPoll.current = null;
    }
    setActiveComment(id);
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

  async function toggleReviewed(path: string, reviewed: boolean) {
    setError(null);
    setReviewedFiles((s) => {
      const n = new Set(s);
      if (reviewed) n.add(path);
      else n.delete(path);
      return n;
    });
    if (!review) return;
    try {
      // Fingerprint the side on screen (uncommitted ⇒ working tree), like addComment.
      await api.setReviewed(review.id, path, reviewed, effectiveUncommitted);
    } catch (e) {
      setReviewedFiles((s) => {
        const n = new Set(s);
        if (reviewed) n.delete(path);
        else n.add(path);
        return n;
      });
      setError((e as Error).message);
    }
  }

  function estFileHeight(f: FileDiff): number {
    const path = f.newPath || f.oldPath;
    const lines = f.hunks.reduce((n, h) => n + h.lines.length, 0);
    const collapsed = reviewedFiles.has(path) || lines > LARGE_FILE_LINES;
    if (collapsed) return 44;
    if (f.binary) return 400;
    return Math.min(lines, 400) * 18 + 44;
  }

  function buildReplyPrompt(): string {
    if (!review) return "";
    const origin = window.location.origin;
    return `This is a code review produced with local-review. Fetch it from the API and work through every open comment.

For each comment: if you agree, make the change and reply noting what you did; if you disagree or need clarification, reply explaining why or asking a question. Comment types signal intent — bug and suggestion want a fix (or a reason it's declined), question wants an answer, nit is optional. A comment marked (outdated) or (moved from …) means the code shifted since it was written — trust the quoted snippet over the line number.

# Fetch the review as markdown. The response is JSON; read its "markdown" field.
# Each comment is headed with an id like "#42".
curl -s -X POST ${origin}/api/reviews/${review.id}/export | jq -r .markdown

# Reply to a comment by its id (the #42 in each heading; different per comment).
curl -s -X POST ${origin}/api/comments/<id>/replies \\
  -H 'Content-Type: application/json' \\
  -d '{"body": "your reply here"}'
`;
  }

  function buildReviewPrompt(): string {
    if (!review) return "";
    const origin = window.location.origin;
    return `Adversarially review the changes branch \`${review.headRef}\` introduces over \`${review.baseRef}\` in this repo, then file your findings as comments via the local-review API so the human reviewer sees them next to their own.

See exactly what changed:
git diff ${review.baseRef}...${review.headRef}

Hunt for real defects — bugs, broken edge cases, race conditions, security holes, missing error handling, violated invariants. Read the surrounding code, not just the diff, to judge correctness. Favour a few high-confidence findings over noise.

# File a comment. Anchor it to the NEW side: the file's post-change path and its
# new-side line range (the server captures the code snippet from that range, so
# you don't send it). type is one of: bug | suggestion | question | nit.
curl -s -X POST ${origin}/api/reviews/${review.id}/comments \\
  -H 'Content-Type: application/json' \\
  -d '{"filePath": "path/to/file", "startLine": 42, "endLine": 45, "type": "bug", "body": "what is wrong and why"}'

# Re-read only the threads you started, with any reviewer replies nested under
# each comment's "replies" (JSON). Poll this to continue the conversation.
curl -s '${origin}/api/reviews/${review.id}/comments?author=agent'

# Reply to a thread (use the comment's "id" from the JSON above).
curl -s -X POST ${origin}/api/comments/<id>/replies \\
  -H 'Content-Type: application/json' \\
  -d '{"body": "your reply here"}'

# Resolve a thread once it's addressed or you're satisfied it's a non-issue.
curl -s -X POST ${origin}/api/comments/<id>/resolved \\
  -H 'Content-Type: application/json' \\
  -d '{"resolved": true}'
`;
  }

  const shortSha = review?.headSha.slice(0, 7);
  const mainBranch = branches.find((b) => b.isMain)?.name;
  // The working tree reflects the checked-out branch, so the uncommitted toggle
  // only makes sense when head is current.
  const currentBranch = branches.find((b) => b.isCurrent)?.name;
  const headIsCurrent = !!head && head === currentBranch;
  // Separate from the raw checkbox so a head change doesn't mutate `uncommitted`
  // and fire the diff-refetch effect on top of the auto-start.
  const effectiveUncommitted = uncommitted && headIsCurrent;
  const orderedDiffFiles = useMemo(() => orderedFiles(files), [files]);
  const orderedFilePaths = useMemo(
    () => orderedDiffFiles.map((f) => f.newPath || f.oldPath),
    [orderedDiffFiles]
  );

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
      // Modals suppress the shortcuts below; the Modal shell owns Escape, so only
      // `?`-toggles-help stays here.
      if (showHelp || confirmingReset || showExport || showPrompts) {
        if (showHelp && e.key === "?") {
          e.preventDefault();
          setShowHelp(false);
        }
        return;
      }
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
    showPrompts,
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
              setString(LS.repo, e.target.value);
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
                {b.isCurrent ? " (current)" : ""}
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
              onClick={() => setShowPrompts(true)}
              title="Copyable prompts: hand a coding agent this review to address, or have an agent review the branch itself"
            >
              Agent prompts
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

      {error && (
        <div className="error banner" role="alert">
          <span>{error}</span>
          <button
            className="banner-dismiss"
            onClick={() => setError(null)}
            title="Dismiss"
            aria-label="Dismiss error"
          >
            ×
          </button>
        </div>
      )}

      {!review && !error && (
        <div className="empty">
          {!reposLoaded ? (
            <>
              <span className="spinner" aria-hidden="true" />
              Loading…
            </>
          ) : repos.length === 0 ? (
            "No git repositories found under the served folder."
          ) : (
            "Select a branch to start a review."
          )}
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
          <div
            className="resizer"
            role="separator"
            aria-orientation="vertical"
            aria-label="Resize files panel"
            aria-valuemin={160}
            aria-valuemax={560}
            aria-valuenow={leftW}
            tabIndex={0}
            onMouseDown={(e) => startResize(e, "left")}
            onKeyDown={(e) => onResizeKey(e, "left")}
          />
          <div className="diff-column" ref={diffColRef}>
            {files.length === 0 && loading && (
              <div className="empty">
                <span className="spinner" aria-hidden="true" />
                Loading diff…
              </div>
            )}
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
                    actions={commentActions}
                    reviewed={reviewedFiles.has(path)}
                    onToggleReviewed={(r) => toggleReviewed(path, r)}
                    expandTarget={expandTarget}
                  />
                </LazyFile>
              );
            })}
          </div>
          <div
            className="resizer"
            role="separator"
            aria-orientation="vertical"
            aria-label="Resize comments panel"
            aria-valuemin={220}
            aria-valuemax={640}
            aria-valuenow={rightW}
            tabIndex={0}
            onMouseDown={(e) => startResize(e, "right")}
            onKeyDown={(e) => onResizeKey(e, "right")}
          />
          <aside className="side-column">
            <CommentsPanel
              comments={comments}
              fileOrder={orderedFilePaths}
              onJump={jumpTo}
              onDelete={handleDelete}
            />
          </aside>
        </div>
      )}

      {showExport && review && (
        <ExportModal reviewId={review.id} onClose={() => setShowExport(false)} />
      )}

      {showPrompts && review && (
        <AgentPromptsModal
          onClose={() => setShowPrompts(false)}
          prompts={[
            { value: "reply", label: "Address the review", text: buildReplyPrompt() },
            { value: "review", label: "Do a review", text: buildReviewPrompt() },
          ]}
        />
      )}

      {showHelp && (
        <Modal onClose={() => setShowHelp(false)} labelledBy="help-title" className="modal-sm">
          <div className="modal-head">
            <h2 id="help-title">Keyboard shortcuts</h2>
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
              <h3 className="help-subhead">Reviewing</h3>
              <table className="shortcuts">
                <tbody>
                  <tr>
                    <td>Click a line №</td>
                    <td>Start a comment on that line</td>
                  </tr>
                  <tr>
                    <td>Drag / Shift-click</td>
                    <td>Comment on a line range</td>
                  </tr>
                  <tr>
                    <td>
                      <kbd>⌘</kbd>/<kbd>Ctrl</kbd>+<kbd>Enter</kbd>
                    </td>
                    <td>Submit the comment</td>
                  </tr>
                </tbody>
              </table>
            </div>
        </Modal>
      )}

      {confirmingReset && (
        <Modal
          onClose={() => setConfirmingReset(false)}
          labelledBy="reset-title"
          className="modal-sm"
        >
          <div className="modal-head">
            <h2 id="reset-title">Reset review?</h2>
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
        </Modal>
      )}
    </div>
  );
}
