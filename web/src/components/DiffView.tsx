import { useEffect, useMemo, useState, type MouseEvent as ReactMouseEvent, type ReactNode } from "react";
import { api } from "../api";
import { langForPath, tokenize, type Token } from "../highlight";
import type { Comment, CommentType, FileDiff, LineKind } from "../types";
import { effectiveLines } from "../types";
import { CommentComposer } from "./CommentComposer";
import { CommentThread } from "./CommentThread";

const IMAGE_EXTS = new Set(["png", "jpg", "jpeg", "gif", "webp", "bmp", "ico", "avif"]);

function extOf(path: string): string {
  const dot = path.lastIndexOf(".");
  return dot < 0 ? "" : path.slice(dot + 1).toLowerCase();
}
const isRasterImage = (path: string) => IMAGE_EXTS.has(extOf(path));
const isSvg = (path: string) => extOf(path) === "svg";

interface Row {
  key: string;
  kind: LineKind | "hunk";
  oldLine?: number;
  newLine?: number;
  content: string;
}

interface Props {
  file: FileDiff;
  repo: string;
  headRef: string;
  baseRef: string;
  uncommitted: boolean;
  comments: Comment[];
  onAddComment: (args: {
    filePath: string;
    startLine: number;
    endLine: number;
    snippet: string;
    body: string;
    type: CommentType;
  }) => Promise<boolean>;
  onUpdateComment: (id: number, body: string, type: CommentType) => Promise<boolean>;
  onDeleteComment: (id: number) => Promise<void>;
  onAddReply: (commentId: number, body: string) => Promise<boolean>;
  onUpdateReply: (commentId: number, replyId: number, body: string) => Promise<boolean>;
  onDeleteReply: (commentId: number, replyId: number) => Promise<void>;
  onResolve: (id: number, resolved: boolean) => void;
  reviewed: boolean;
  onToggleReviewed: (reviewed: boolean) => void;
  expandTarget: { path: string; n: number } | null;
}

// Files with more changed lines than this start collapsed, and are not syntax
// highlighted (both to keep large change-sets responsive).
export const LARGE_FILE_LINES = 500;
const HIGHLIGHT_MAX_LINES = 2000;

export function DiffView({
  file,
  repo,
  headRef,
  baseRef,
  uncommitted,
  comments,
  onAddComment,
  onUpdateComment,
  onDeleteComment,
  onAddReply,
  onUpdateReply,
  onDeleteReply,
  onResolve,
  reviewed,
  onToggleReviewed,
  expandTarget,
}: Props) {
  const changedLines = useMemo(
    () => file.hunks.reduce((n, h) => n + h.lines.length, 0),
    [file]
  );
  const isLarge = changedLines > LARGE_FILE_LINES;

  const [mode, setMode] = useState<"changed" | "full">("changed");
  const [source, setSource] = useState<string[] | null>(null);
  const [collapsed, setCollapsed] = useState(reviewed || isLarge);
  const [selection, setSelection] = useState<{ start: number; end: number } | null>(null);
  const [dragAnchor, setDragAnchor] = useState<number | null>(null);
  const [newTokens, setNewTokens] = useState<Map<number, Token[]> | null>(null);
  const [delTokens, setDelTokens] = useState<Map<string, Token[]> | null>(null);
  const [svgAsImage, setSvgAsImage] = useState(false);
  const [fileComposer, setFileComposer] = useState(false);

  const path = file.newPath || file.oldPath;
  const lang = langForPath(path);

  // Media (image / non-previewable binary) files render an image or a placeholder
  // instead of a line-by-line diff, and take file-level comments (anchored at
  // line 0) since they have no lines. SVGs are text by default with an opt-in
  // image view.
  const svg = isSvg(path);
  const asImage = isRasterImage(path) || (svg && svgAsImage);
  const mediaView = asImage || (!!file.binary && !svg);

  // Auto-collapse when marked reviewed; large files stay collapsed regardless.
  useEffect(() => {
    setCollapsed(reviewed || isLarge);
  }, [reviewed, isLarge]);

  // Expand when a jump targets this file (e.g. clicking a comment on a
  // collapsed large/reviewed file). Runs after the collapse effect so it wins.
  useEffect(() => {
    if (expandTarget && expandTarget.path === path) setCollapsed(false);
  }, [expandTarget, path]);

  // In uncommitted mode the new side is the working tree, so read from disk
  // (git show can't reach an uncommitted new file). Reset source when the mode
  // flips so the full view refetches the correct side.
  useEffect(() => {
    setSource(null);
  }, [uncommitted]);

  // Fetch the full new-side file (once expanded) for both the Full view and
  // syntax highlighting of add/context lines. Skipped for deleted files.
  useEffect(() => {
    if (collapsed || source || file.status === "deleted" || !file.newPath || mediaView) return;
    let cancelled = false;
    api
      .file(repo, file.newPath, headRef, uncommitted)
      .then((res) => {
        if (!cancelled) setSource(res.content.replace(/\n$/, "").split("\n"));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [collapsed, source, file, headRef, repo, uncommitted, mediaView]);

  // Tokenize the full source → one token array per line (keyed by new line no).
  // Skipped for very large files to avoid blocking the main thread.
  useEffect(() => {
    if (!source || !lang || source.length > HIGHLIGHT_MAX_LINES) {
      setNewTokens(null);
      return;
    }
    let cancelled = false;
    tokenize(source.join("\n"), lang).then((toks) => {
      if (cancelled || !toks) return;
      const m = new Map<number, Token[]>();
      toks.forEach((t, i) => m.set(i + 1, t));
      setNewTokens(m);
    });
    return () => {
      cancelled = true;
    };
  }, [source, lang]);

  // Tokenize deleted (old-side) lines individually, keyed by content.
  useEffect(() => {
    if (!lang) {
      setDelTokens(null);
      return;
    }
    const contents = [
      ...new Set(
        file.hunks.flatMap((h) => h.lines.filter((l) => l.kind === "del").map((l) => l.content))
      ),
    ];
    if (contents.length === 0 || contents.length > HIGHLIGHT_MAX_LINES) {
      setDelTokens(null);
      return;
    }
    let cancelled = false;
    tokenize(contents.join("\n"), lang).then((toks) => {
      if (cancelled || !toks) return;
      const m = new Map<string, Token[]>();
      contents.forEach((c, i) => m.set(c, toks[i] ?? []));
      setDelTokens(m);
    });
    return () => {
      cancelled = true;
    };
  }, [file, lang]);

  // End a range drag when the mouse is released anywhere.
  useEffect(() => {
    if (dragAnchor === null) return;
    const onUp = () => setDragAnchor(null);
    window.addEventListener("mouseup", onUp);
    return () => window.removeEventListener("mouseup", onUp);
  }, [dragAnchor]);

  const addedSet = useMemo(() => {
    const s = new Set<number>();
    for (const h of file.hunks) {
      for (const l of h.lines) {
        if (l.kind === "add" && l.newLine) s.add(l.newLine);
      }
    }
    return s;
  }, [file]);

  // Comments grouped by the line they currently anchor to (the effective end
  // line — the relocated line for moved comments, else their stored endLine).
  const commentsByEndLine = useMemo(() => {
    const m = new Map<number, Comment[]>();
    for (const c of comments) {
      const end = effectiveLines(c).end;
      const arr = m.get(end) ?? [];
      arr.push(c);
      m.set(end, arr);
    }
    return m;
  }, [comments]);

  const commentedLines = useMemo(() => {
    const s = new Set<number>();
    for (const c of comments) {
      const { start, end } = effectiveLines(c);
      for (let n = start; n <= end; n++) s.add(n);
    }
    return s;
  }, [comments]);

  const rows: Row[] = useMemo(() => {
    if (mode === "full" && source) {
      return source.map((content, i) => {
        const newLine = i + 1;
        return {
          key: `f${newLine}`,
          kind: addedSet.has(newLine) ? "add" : "context",
          newLine,
          content,
        } as Row;
      });
    }
    const out: Row[] = [];
    file.hunks.forEach((h, hi) => {
      out.push({ key: `h${hi}`, kind: "hunk", content: h.header });
      h.lines.forEach((l, li) => {
        out.push({
          key: `h${hi}l${li}`,
          kind: l.kind,
          oldLine: l.oldLine,
          newLine: l.newLine,
          content: l.content,
        });
      });
    });
    return out;
  }, [mode, source, file, addedSet]);

  async function switchMode(next: "changed" | "full") {
    if (next === "full" && !source) {
      try {
        const res = await api.file(repo, file.newPath, headRef, uncommitted);
        setSource(res.content.replace(/\n$/, "").split("\n"));
      } catch (e) {
        alert(`Could not load full file: ${(e as Error).message}`);
        return;
      }
    }
    setMode(next);
  }

  function snippetFor(start: number, end: number): string {
    const byLine = new Map<number, string>();
    for (const r of rows) {
      if (r.newLine && r.kind !== "hunk" && r.kind !== "del") byLine.set(r.newLine, r.content);
    }
    const parts: string[] = [];
    for (let n = start; n <= end; n++) {
      const c = byLine.get(n);
      if (c !== undefined) parts.push(c);
    }
    return parts.join("\n");
  }

  function onGutterMouseDown(newLine: number, shift: boolean, e: ReactMouseEvent) {
    e.preventDefault(); // avoid starting a native text selection while dragging
    if (shift && selection) {
      // Shift-click extends from the existing anchor (the range start).
      setDragAnchor(selection.start);
      setSelection({
        start: Math.min(selection.start, newLine),
        end: Math.max(selection.start, newLine),
      });
    } else {
      setDragAnchor(newLine);
      setSelection({ start: newLine, end: newLine });
    }
  }

  function onGutterMouseEnter(newLine: number) {
    if (dragAnchor === null) return;
    setSelection({
      start: Math.min(dragAnchor, newLine),
      end: Math.max(dragAnchor, newLine),
    });
  }

  async function submit(body: string, type: CommentType) {
    if (!selection) return;
    const ok = await onAddComment({
      filePath: file.newPath,
      startLine: selection.start,
      endLine: selection.end,
      snippet: snippetFor(selection.start, selection.end),
      body,
      type,
    });
    if (ok) setSelection(null); // keep the composer open (with the text) on failure
  }

  // File-level comment (binary/image files have no lines) — anchored at line 0.
  async function submitFileComment(body: string, type: CommentType) {
    const ok = await onAddComment({
      filePath: path,
      startLine: 0,
      endLine: 0,
      snippet: "",
      body,
      type,
    });
    if (ok) setFileComposer(false);
  }

  function renderContent(kind: LineKind | "hunk", newLine: number | undefined, content: string) {
    const toks = kind === "del" ? delTokens?.get(content) : newLine ? newTokens?.get(newLine) : undefined;
    if (!toks || toks.length === 0) return content;
    return toks.map((t, i) => (
      <span key={i} style={{ color: t.color }}>
        {t.content}
      </span>
    ));
  }

  function threadRow(key: string, children: ReactNode) {
    return (
      <tr key={key} className="thread-row">
        <td className="gutter thread-gutter" colSpan={2} />
        <td className="thread-cell">{children}</td>
      </tr>
    );
  }

  // Build the table body, interleaving comment threads and the composer with
  // the diff rows. Track which comments/selection get placed so anything whose
  // anchor line isn't currently visible falls back to the end of the file.
  const rendered = new Set<number>();
  let composerPlaced = false;
  const body: ReactNode[] = [];

  for (const r of rows) {
    if (r.kind === "hunk") {
      body.push(
        <tr key={r.key} className="row-hunk">
          <td className="gutter" />
          <td className="gutter" />
          <td className="line-content">{r.content}</td>
        </tr>
      );
      continue;
    }
    const commentable = !!r.newLine && r.kind !== "del";
    const selected =
      !!r.newLine && selection != null && r.newLine >= selection.start && r.newLine <= selection.end;
    const hasComment = !!r.newLine && commentedLines.has(r.newLine);
    body.push(
      <tr
        key={r.key}
        className={`row-${r.kind}${selected ? " row-selected" : ""}${
          hasComment ? " row-commented" : ""
        }`}
      >
        <td className="gutter">{r.oldLine ?? ""}</td>
        <td
          className={`gutter${commentable ? " gutter-click" : ""}`}
          onMouseDown={(e) => commentable && onGutterMouseDown(r.newLine!, e.shiftKey, e)}
          onMouseEnter={() => commentable && onGutterMouseEnter(r.newLine!)}
          title={commentable ? "Click, drag, or shift-click to select line(s)" : ""}
        >
          {r.newLine ?? ""}
        </td>
        <td className="line-content">
          <span className="sign">
            {r.kind === "add" ? "+" : r.kind === "del" ? "-" : " "}
          </span>
          {renderContent(r.kind, r.newLine, r.content)}
        </td>
      </tr>
    );

    if (r.newLine) {
      const threads = commentsByEndLine.get(r.newLine);
      if (threads) {
        for (const c of threads) rendered.add(c.id);
        body.push(
          threadRow(
            `t${r.newLine}`,
            threads.map((c) => (
              <CommentThread
                key={c.id}
                comment={c}
                onUpdate={onUpdateComment}
                onDelete={onDeleteComment}
                onAddReply={onAddReply}
                onUpdateReply={onUpdateReply}
                onDeleteReply={onDeleteReply}
                onResolve={onResolve}
              />
            ))
          )
        );
      }
      if (selection && dragAnchor === null && r.newLine === selection.end) {
        composerPlaced = true;
        body.push(threadRow("composer", renderComposer()));
      }
    }
  }

  // Fallbacks for anchors not visible in the current view mode.
  const leftover = comments.filter((c) => !rendered.has(c.id));
  if (leftover.length > 0) {
    body.push(
      threadRow(
        "leftover",
        leftover.map((c) => (
          <CommentThread
            key={c.id}
            comment={c}
            onUpdate={onUpdateComment}
            onDelete={onDeleteComment}
            onAddReply={onAddReply}
            onUpdateReply={onUpdateReply}
            onDeleteReply={onDeleteReply}
            onResolve={onResolve}
          />
        ))
      )
    );
  }
  if (selection && !composerPlaced && dragAnchor === null) {
    body.push(threadRow("composer", renderComposer()));
  }

  function renderComposer() {
    if (!selection) return null;
    return (
      <div className="thread">
        <div className="thread-meta">
          <span className="muted">
            New comment ·{" "}
            {selection.start === selection.end
              ? `L${selection.start}`
              : `L${selection.start}–${selection.end}`}
          </span>
        </div>
        <CommentComposer onSubmit={submit} onCancel={() => setSelection(null)} />
      </div>
    );
  }

  function renderImages() {
    const showBefore = file.status !== "added" && file.oldPath && baseRef;
    const showAfter = file.status !== "deleted" && file.newPath;
    return (
      <div className="image-diff">
        {showBefore && (
          <figure className="image-side">
            <figcaption>before</figcaption>
            <img src={api.blobURL(repo, file.oldPath, baseRef)} alt="before" />
          </figure>
        )}
        {showAfter && (
          <figure className="image-side">
            <figcaption>after</figcaption>
            <img src={api.blobURL(repo, file.newPath, headRef, uncommitted)} alt="after" />
          </figure>
        )}
      </div>
    );
  }

  function renderMedia() {
    return (
      <div className="media-body">
        {asImage ? renderImages() : <div className="binary-note">Binary file — no preview</div>}
        <div className="file-comments">
          {comments.map((c) => (
            <CommentThread
              key={c.id}
              comment={c}
              onUpdate={onUpdateComment}
              onDelete={onDeleteComment}
              onAddReply={onAddReply}
              onUpdateReply={onUpdateReply}
              onDeleteReply={onDeleteReply}
              onResolve={onResolve}
            />
          ))}
          {fileComposer ? (
            <CommentComposer
              submitLabel="Add comment"
              onSubmit={submitFileComment}
              onCancel={() => setFileComposer(false)}
            />
          ) : (
            <button className="btn add-file-comment" onClick={() => setFileComposer(true)}>
              + Add file comment
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className={`file${reviewed ? " file-reviewed" : ""}`}>
      <div className="file-header">
        <button className="file-toggle" onClick={() => setCollapsed((c) => !c)}>
          {collapsed ? "▸" : "▾"}
        </button>
        <span className={`status status-${file.status}`}>{file.status}</span>
        <span className="file-path">{path}</span>
        <span className="file-count">{comments.length > 0 ? `${comments.length} 💬` : ""}</span>
        <label className="viewed-check" title="Mark file reviewed">
          <input
            type="checkbox"
            checked={reviewed}
            onChange={(e) => onToggleReviewed(e.target.checked)}
          />
          Viewed
        </label>
        {svg && (
          <div className="view-toggle">
            <button className={!svgAsImage ? "active" : ""} onClick={() => setSvgAsImage(false)}>
              Text
            </button>
            <button className={svgAsImage ? "active" : ""} onClick={() => setSvgAsImage(true)}>
              Image
            </button>
          </div>
        )}
        {!mediaView && file.newPath !== "" && (
          <div className="view-toggle">
            <button
              className={mode === "changed" ? "active" : ""}
              onClick={() => switchMode("changed")}
            >
              Changed
            </button>
            <button className={mode === "full" ? "active" : ""} onClick={() => switchMode("full")}>
              Full
            </button>
          </div>
        )}
      </div>

      {!collapsed &&
        (mediaView ? (
          renderMedia()
        ) : (
          <table className="diff">
            <tbody>{body}</tbody>
          </table>
        ))}
    </div>
  );
}
