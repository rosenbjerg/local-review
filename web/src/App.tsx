import { useEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from "react";
import { api } from "./api";
import { CommentsPanel } from "./components/CommentsPanel";
import { DiffView, LARGE_FILE_LINES } from "./components/DiffView";
import { ExportModal } from "./components/ExportModal";
import { FileExplorer } from "./components/FileExplorer";
import { LazyFile } from "./components/LazyFile";
import type { Branch, Comment, CommentType, FileDiff, Review } from "./types";

const LS_LEFT = "lr.leftWidth";
const LS_RIGHT = "lr.rightWidth";
const LS_BASE_BY_REPO = "lr.baseByRepo";

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
  const [repo, setRepo] = useState("");
  const [branches, setBranches] = useState<Branch[]>([]);
  const [head, setHead] = useState("");
  const [base, setBase] = useState("");
  const [review, setReview] = useState<Review | null>(null);
  const [files, setFiles] = useState<FileDiff[]>([]);
  const [comments, setComments] = useState<Comment[]>([]);
  const [reviewedFiles, setReviewedFiles] = useState<Set<string>>(new Set());
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showExport, setShowExport] = useState(false);
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

  // Discover repositories under the root once on load.
  useEffect(() => {
    api
      .repos()
      .then((r) => {
        setRepos(r.repos);
        setRepo(r.repos[0] ?? "");
      })
      .catch((e) => setError((e as Error).message));
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
      const diff = await api.diff(repo, rev.headRef, rev.baseRef);
      if (reqSeq.current !== seq) return;
      setFiles(diff.files ?? []);
    } catch (e) {
      if (reqSeq.current === seq) setError((e as Error).message);
    } finally {
      if (reqSeq.current === seq) setLoading(false);
    }
  }

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
      const c = await api.addComment(review.id, args);
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

  function flashComment(id: number): boolean {
    const el = document.getElementById(`comment-${id}`);
    if (!el) return false;
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    el.classList.add("thread-flash");
    setTimeout(() => el.classList.remove("thread-flash"), 1200);
    return true;
  }

  function jumpTo(id: number) {
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
      await api.setReviewed(review.id, path, reviewed);
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
    return collapsed ? 44 : Math.min(lines, 400) * 18 + 44;
  }

  const shortSha = review?.headSha.slice(0, 7);
  const mainBranch = branches.find((b) => b.isMain)?.name;

  return (
    <div className="app">
      <header className="topbar">
        <span className="logo">local-review</span>
        <label>
          repo
          <select value={repo} onChange={(e) => setRepo(e.target.value)} disabled={loading}>
            {repos.length === 0 && <option value="">(none found)</option>}
            {repos.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
        </label>
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
        <span className="arrow">←</span>
        <label>
          head
          <select value={head} onChange={(e) => setHead(e.target.value)} disabled={loading}>
            {branches.map((b) => (
              <option key={b.name} value={b.name}>
                {b.name}
                {b.isCurrent ? " *" : ""}
              </option>
            ))}
          </select>
        </label>
        <button className="btn btn-primary" onClick={startReview} disabled={loading || !repo || !head}>
          {loading ? "Loading…" : review ? "Reload" : "Start review"}
        </button>
        <span className="spacer" />
        {review && (
          <>
            <span className="muted">
              {review.headRef} → {review.baseRef} @ {shortSha}
            </span>
            <button className="btn" onClick={() => setShowExport(true)}>
              Export ({comments.length})
            </button>
          </>
        )}
      </header>

      {error && <div className="error banner">{error}</div>}

      {!review && !error && (
        <div className="empty">Pick a branch and start a review.</div>
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
            {files.length === 0 && <div className="empty">No changes between base and head.</div>}
            {files.map((f) => {
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
                    comments={comments.filter((c) => c.filePath === path)}
                    onAddComment={handleAddComment}
                    onUpdateComment={handleUpdate}
                    onDeleteComment={handleDelete}
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
            <CommentsPanel comments={comments} onJump={jumpTo} />
          </aside>
        </div>
      )}

      {showExport && review && (
        <ExportModal reviewId={review.id} onClose={() => setShowExport(false)} />
      )}
    </div>
  );
}
