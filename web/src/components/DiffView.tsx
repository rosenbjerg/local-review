import { useEffect, useMemo, useState, type MouseEvent as ReactMouseEvent, type ReactNode } from "react";
import { api } from "../api";
import { langForPath, tokenize, type Token } from "../highlight";
import type { Comment, CommentType, FileDiff, LineKind } from "../types";
import { effectiveLines } from "../types";
import { CommentComposer } from "./CommentComposer";
import { CommentThread, type CommentActions } from "./CommentThread";
import { FileHeader } from "./FileHeader";
import { MarkdownView } from "./MarkdownView";
import { MediaView } from "./MediaView";

const IMAGE_EXTS = new Set(["png", "jpg", "jpeg", "gif", "webp", "bmp", "ico", "avif"]);

function extOf(path: string): string {
  const dot = path.lastIndexOf(".");
  return dot < 0 ? "" : path.slice(dot + 1).toLowerCase();
}
const isRasterImage = (path: string) => IMAGE_EXTS.has(extOf(path));
const isSvg = (path: string) => extOf(path) === "svg";
const isMarkdown = (path: string) => extOf(path) === "md" || extOf(path) === "markdown";

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
  worktree: boolean;
  indexed: boolean;
  comments: Comment[];
  onAddComment: (args: {
    filePath: string;
    startLine: number;
    endLine: number;
    body: string;
    type: CommentType;
  }) => Promise<boolean>;
  actions: CommentActions;
  reviewed: boolean;
  onToggleReviewed: (reviewed: boolean) => void;
  expandTarget: { path: string; n: number } | null;
  expandComment: { id: number; n: number } | null;
  activeComment: number | null;
}

export const LARGE_FILE_LINES = 500;
const HIGHLIGHT_MAX_LINES = 2000;

export function DiffView({
  file,
  repo,
  headRef,
  baseRef,
  worktree,
  indexed,
  comments,
  onAddComment,
  actions,
  reviewed,
  onToggleReviewed,
  expandTarget,
  expandComment,
  activeComment,
}: Props) {
  const changedLines = useMemo(
    () => file.hunks.reduce((n, h) => n + h.lines.length, 0),
    [file]
  );
  const isLarge = changedLines > LARGE_FILE_LINES;

  // A synthetic "unchanged" file (opened to comment on, no diff hunks) has
  // nothing in "changed" view, so it lives entirely in "full" mode.
  const unchanged = file.status === "unchanged";
  const [mode, setMode] = useState<"changed" | "full">(unchanged ? "full" : "changed");
  const [source, setSource] = useState<string[] | null>(null);
  const [collapsed, setCollapsed] = useState(reviewed || isLarge);
  const [selection, setSelection] = useState<{ start: number; end: number } | null>(null);
  const [dragAnchor, setDragAnchor] = useState<number | null>(null);
  const [newTokens, setNewTokens] = useState<Map<number, Token[]> | null>(null);
  const [delTokens, setDelTokens] = useState<Map<string, Token[]> | null>(null);
  const [svgAsImage, setSvgAsImage] = useState(false);
  const [mdRendered, setMdRendered] = useState(false);
  const [fileComposer, setFileComposer] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const path = file.newPath || file.oldPath;
  const lang = langForPath(path);
  const openCount = comments.filter((c) => !c.resolved).length;

  const svg = isSvg(path);
  const asImage = isRasterImage(path) || (svg && svgAsImage);
  const mediaView = asImage || (!!file.binary && !svg);
  // A markdown file with a new side can be viewed rendered instead of as a diff.
  const markdown = isMarkdown(path) && file.status !== "deleted" && file.newPath !== "";
  const docView = markdown && mdRendered;

  useEffect(() => {
    setCollapsed(reviewed || isLarge);
  }, [reviewed, isLarge]);

  // Runs after the collapse effect so an expand-on-jump wins over it.
  useEffect(() => {
    if (expandTarget && expandTarget.path === path) setCollapsed(false);
  }, [expandTarget, path]);

  // Drop the cached source when the new side changes (toggle/Reload): the review
  // isn't remounted, so stale text/tokens would persist. Hunks stand in for the
  // new-side content in the key, so an unchanged file keeps its source.
  const contentKey = useMemo(
    () => `${worktree} ${indexed} ${file.status} ${file.newPath} ${JSON.stringify(file.hunks)}`,
    [worktree, indexed, file]
  );
  useEffect(() => {
    setSource(null);
  }, [contentKey]);

  useEffect(() => {
    if (collapsed || source || file.status === "deleted" || !file.newPath || mediaView) return;
    let cancelled = false;
    api
      .file(repo, file.newPath, headRef, worktree, indexed)
      .then((res) => {
        if (!cancelled) setSource(res.content.replace(/\n$/, "").split("\n"));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [collapsed, source, file, headRef, repo, worktree, indexed, mediaView]);

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

  // The effective line range of the thread jumped to (n/p or the comments panel),
  // if it lives in this file — its rows stay lit until another is picked.
  const activeRange = useMemo(() => {
    if (activeComment == null) return null;
    const c = comments.find((x) => x.id === activeComment);
    return c ? effectiveLines(c) : null;
  }, [activeComment, comments]);

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
        const res = await api.file(repo, file.newPath, headRef, worktree, indexed);
        setSource(res.content.replace(/\n$/, "").split("\n"));
      } catch (e) {
        setLoadError(`Could not load full file: ${(e as Error).message}`);
        return;
      }
    }
    setLoadError(null);
    setMode(next);
  }

  function onGutterMouseDown(newLine: number, shift: boolean, e: ReactMouseEvent) {
    e.preventDefault(); // avoid starting a native text selection while dragging
    if (shift && selection) {
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
      body,
      type,
    });
    if (ok) setSelection(null); // keep the composer open (with the text) on failure
  }

  async function submitFileComment(body: string, type: CommentType) {
    const ok = await onAddComment({
      filePath: path,
      startLine: 0,
      endLine: 0,
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

  const renderThread = (c: Comment) => (
    <CommentThread key={c.id} comment={c} actions={actions} expandSignal={expandComment} />
  );

  // Comments whose anchor line isn't rendered in this view fall back to the end
  // (tracked via `rendered`).
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
    const activeHL =
      !!r.newLine && activeRange != null && r.newLine >= activeRange.start && r.newLine <= activeRange.end;
    body.push(
      <tr
        key={r.key}
        className={`row-${r.kind}${selected ? " row-selected" : ""}${
          hasComment ? " row-commented" : ""
        }${activeHL ? " row-comment-active" : ""}`}
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
        body.push(threadRow(`t${r.newLine}`, threads.map(renderThread)));
      }
      if (selection && dragAnchor === null && r.newLine === selection.end) {
        composerPlaced = true;
        body.push(threadRow("composer", renderComposer()));
      }
    }
  }

  const leftover = comments.filter((c) => !rendered.has(c.id));
  if (leftover.length > 0) {
    body.push(threadRow("leftover", leftover.map(renderThread)));
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

  return (
    <div className={`file${reviewed ? " file-reviewed" : ""}`}>
      <FileHeader
        status={file.status}
        path={path}
        collapsed={collapsed}
        onToggleCollapsed={() => setCollapsed((c) => !c)}
        openCount={openCount}
        reviewed={reviewed}
        onToggleReviewed={onToggleReviewed}
        svg={svg}
        svgAsImage={svgAsImage}
        onSvgAsImage={setSvgAsImage}
        markdown={markdown}
        mdRendered={mdRendered}
        onMdRendered={setMdRendered}
        showModeToggle={!mediaView && !docView && file.newPath !== "" && !unchanged}
        mode={mode}
        onSwitchMode={switchMode}
      />

      {!collapsed && (
        <div className="file-body">
          {loadError && <div className="error file-error">{loadError}</div>}
          {mediaView ? (
            <MediaView
              file={file}
              repo={repo}
              headRef={headRef}
              baseRef={baseRef}
              worktree={worktree}
              indexed={indexed}
              asImage={asImage}
              comments={comments}
              renderThread={renderThread}
              fileComposer={fileComposer}
              onSetFileComposer={setFileComposer}
              onSubmitFileComment={submitFileComment}
            />
          ) : docView ? (
            source ? (
              <MarkdownView
                source={source.join("\n")}
                comments={comments}
                renderThread={renderThread}
                fileComposer={fileComposer}
                onSetFileComposer={setFileComposer}
                onSubmitFileComment={submitFileComment}
              />
            ) : (
              <div className="binary-note media-body">Loading…</div>
            )
          ) : (
            <table className="diff">
              <tbody>{body}</tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}
