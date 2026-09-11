import { memo, useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent, type ReactNode } from "react";
import { ApiError, api } from "../api";
import { sameComments } from "../commentsByPath";
import { fileStat } from "../diffStats";
import { buildRows, planRows, type PlannedRow, type Row } from "../diffRows";
import { EXPAND_STEP, type Gap, type Reveal } from "../hunkGaps";
import { hunkWordRanges, splitPieces, type Segment } from "../wordDiff";
import { langForPath, tokenize, type Token } from "../highlight";
import { useTheme } from "../theme";
import type { Comment, CommentType, FileDiff, LineKind, Side } from "../types";
import { sideLabel as labelForSide } from "../types";
import { CommentComposer } from "./CommentComposer";
import { CommentThread, type CommentActions } from "./CommentThread";
import { FileComments } from "./FileComments";
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

interface Props {
  file: FileDiff;
  repo: string;
  headRef: string;
  baseRef: string;
  side: Side;
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
  // Takes the path so App can pass one shared handler; a per-card closure would defeat the memo.
  onToggleReviewed: (path: string, reviewed: boolean) => void;
  expandTarget: { path: string; n: number } | null;
  expandComment: { id: number; n: number } | null;
  showFullSignal: { path: string; n: number } | null;
  activeComment: number | null;
  commentIds: Set<number>;
}

export const LARGE_FILE_LINES = 500;
const HIGHLIGHT_MAX_LINES = 2000;

// Cards never unmount, and the React Compiler can't cache inside App's file map, so the memo
// boundary is explicit. Every prop compares by identity except `comments` (rebuilt per read);
// a prop that takes a new identity each render silently disables the whole thing.
function samePropsExceptComments(a: Props, b: Props): boolean {
  const x = a as unknown as Record<string, unknown>;
  const y = b as unknown as Record<string, unknown>;
  const keys = Object.keys(x);
  if (keys.length !== Object.keys(y).length) return false;
  for (const k of keys) if (k !== "comments" && x[k] !== y[k]) return false;
  return sameComments(a.comments, b.comments);
}

// A touched file can still have no hunks (pure rename, mode change, empty file); Changed view would render blank.
function noHunksNote(status: FileDiff["status"]): string {
  switch (status) {
    case "renamed":
      return "Renamed with no content changes.";
    case "added":
      return "Added, with no content — the file is empty.";
    case "deleted":
      return "Deleted, and the file was empty.";
    default:
      return "No content changes — only the file's mode changed.";
  }
}

export const DiffView = memo(function DiffView({
  file,
  repo,
  headRef,
  baseRef,
  side,
  comments,
  onAddComment,
  actions,
  reviewed,
  onToggleReviewed,
  expandTarget,
  expandComment,
  showFullSignal,
  activeComment,
  commentIds,
}: Props) {
  const changedLines = useMemo(
    () => file.hunks.reduce((n, h) => n + h.lines.length, 0),
    [file]
  );
  const stat = useMemo(() => fileStat(file), [file]);
  const isLarge = changedLines > LARGE_FILE_LINES;

  // A synthetic "unchanged" card has no hunks, so it lives in full mode.
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
  const [revealed, setRevealed] = useState<Record<number, Reveal>>({});
  const [loadError, setLoadError] = useState<string | null>(null);
  const [missing, setMissing] = useState(false);
  // The ref couldn't supply the file, so the on-disk copy was served; the hunks still come from the ref.
  const [substituted, setSubstituted] = useState(false);

  const path = file.newPath || file.oldPath;
  const lang = langForPath(path);
  // Tokens carry resolved colors, so both tokenize effects re-run on a theme switch.
  const theme = useTheme();
  const openCount = comments.filter((c) => !c.resolved).length;

  const svg = isSvg(path);
  const asImage = isRasterImage(path) || (svg && svgAsImage);
  const mediaView = asImage || (!!file.binary && !svg);
  const markdown = isMarkdown(path) && file.status !== "deleted" && file.newPath !== "";
  // A gone file falls back to the diff table, whose leftover row still shows the stranded comments.
  const docView = markdown && mdRendered && !missing;
  const canToggleMode = !mediaView && !docView && file.newPath !== "" && !unchanged;
  const sideLabel = labelForSide(side, headRef);

  useEffect(() => {
    setCollapsed(reviewed || isLarge);
  }, [reviewed, isLarge]);

  // Runs after the collapse effect so an expand-on-jump wins over it.
  useEffect(() => {
    if (expandTarget && expandTarget.path === path) setCollapsed(false);
  }, [expandTarget, path]);

  // The hunks are in here as the content-change signal: on the worktree side nothing else in the key
  // moves when the file changes on disk, and a stale key leaves `source` set for the fetch effect to skip.
  const contentKey = useMemo(
    () =>
      `${repo} ${headRef} ${side} ${file.status} ${file.newPath} ${JSON.stringify(file.hunks)}`,
    [repo, headRef, side, file]
  );
  // switchMode checks against the live key; its own closure's predates the await. Written in
  // an effect, not during render: switchMode only reads it after an await, by which point the
  // effect has flushed, and a ref written during render bails the compiler out of this file.
  const contentKeyRef = useRef(contentKey);
  useEffect(() => {
    contentKeyRef.current = contentKey;
  });
  useEffect(() => {
    setSource(null);
    setMissing(false);
    setSubstituted(false);
    setRevealed({});
  }, [contentKey]);

  useEffect(() => {
    if (collapsed || source || file.status === "deleted" || !file.newPath || mediaView) return;
    let cancelled = false;
    api
      .file(repo, file.newPath, headRef, side)
      .then((res) => {
        if (cancelled) return;
        setMissing(false);
        setSubstituted(side === "head" && res.worktree);
        setSource(res.content.replace(/\n$/, "").split("\n"));
      })
      .catch((e) => {
        // A comment can outlive its file; say why the card is empty.
        if (!cancelled) setMissing(e instanceof ApiError && e.status === 404);
      });
    return () => {
      cancelled = true;
    };
  }, [collapsed, source, file, headRef, repo, side, mediaView]);

  useEffect(() => {
    if (!source || !lang || source.length > HIGHLIGHT_MAX_LINES) {
      setNewTokens(null);
      return;
    }
    let cancelled = false;
    tokenize(source.join("\n"), lang, theme).then((toks) => {
      if (cancelled || !toks) return;
      const m = new Map<number, Token[]>();
      toks.forEach((t, i) => m.set(i + 1, t));
      setNewTokens(m);
    });
    return () => {
      cancelled = true;
    };
  }, [source, lang, theme]);

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
    tokenize(contents.join("\n"), lang, theme).then((toks) => {
      if (cancelled || !toks) return;
      const m = new Map<string, Token[]>();
      contents.forEach((c, i) => m.set(c, toks[i] ?? []));
      setDelTokens(m);
    });
    return () => {
      cancelled = true;
    };
  }, [file, lang, theme]);

  useEffect(() => {
    if (dragAnchor === null) return;
    const onUp = () => setDragAnchor(null);
    window.addEventListener("mouseup", onUp);
    return () => window.removeEventListener("mouseup", onUp);
  }, [dragAnchor]);

  // Keyed by line number, so Full view marks the additions though it renders no deleted rows.
  const wordRanges = useMemo(() => hunkWordRanges(file.hunks), [file]);

  const rows = useMemo(
    () => buildRows({ mode, source, hunks: file.hunks, revealed }),
    [mode, source, file, revealed]
  );

  // Every non-rendering decision lives in diffRows.ts, so the rules are testable.
  const plan = useMemo(
    () => planRows({ rows, comments, selection, dragging: dragAnchor !== null, activeComment }),
    [rows, comments, selection, dragAnchor, activeComment]
  );

  function expand(gap: Gap, side: "head" | "tail", amount: number) {
    setRevealed((s) => {
      const cur = s[gap.hunkIndex] ?? { head: 0, tail: 0 };
      return { ...s, [gap.hunkIndex]: { ...cur, [side]: cur[side] + amount } };
    });
  }

  function expandAll(gap: Gap) {
    setRevealed((s) => ({ ...s, [gap.hunkIndex]: { head: gap.end - gap.start + 1, tail: 0 } }));
  }

  async function switchMode(next: "changed" | "full") {
    if (next === "full" && !source) {
      const key = contentKey;
      // Only the await sits in the try: the compiler bails on a conditional inside one, and
      // a bailed-out DiffView is a DiffView that re-renders on every parent render.
      let res;
      try {
        res = await api.file(repo, file.newPath, headRef, side);
      } catch (e) {
        setLoadError(`Could not load full file: ${(e as Error).message}`);
        return;
      }
      // The side moved while this was in flight; the fetch effect owns the refetch.
      if (key !== contentKeyRef.current) return;
      setSubstituted(side === "head" && res.worktree);
      setSource(res.content.replace(/\n$/, "").split("\n"));
    }
    setLoadError(null);
    setMode(next);
  }

  // The find bar's "Search full file"; keyed on the signal alone, deliberately not on switchMode.
  useEffect(() => {
    if (showFullSignal && showFullSignal.path === path) void switchMode("full");
  }, [showFullSignal, path]);


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

  // FileComments closes its own composer on success, so this only has to report it.
  function submitFileComment(body: string, type: CommentType) {
    return onAddComment({ filePath: path, startLine: 0, endLine: 0, body, type });
  }

  function renderContent(
    kind: LineKind | "hunk",
    oldLine: number | undefined,
    newLine: number | undefined,
    content: string
  ) {
    const toks = kind === "del" ? delTokens?.get(content) : newLine ? newTokens?.get(newLine) : undefined;
    const ranges =
      kind === "del"
        ? oldLine && wordRanges.del.get(oldLine)
        : kind === "add"
          ? newLine && wordRanges.add.get(newLine)
          : undefined;
    if (!ranges || ranges.length === 0) {
      if (!toks || toks.length === 0) return content;
      return toks.map((t, i) => (
        <span key={i} style={{ color: t.color }}>
          {t.content}
        </span>
      ));
    }
    const segments: Segment[] =
      toks && toks.length > 0 ? toks.map((t) => ({ text: t.content, color: t.color })) : [{ text: content }];
    return splitPieces(segments, ranges).map((p, i) => (
      <span key={i} className={p.changed ? "word-diff" : undefined} style={{ color: p.color }}>
        {p.text}
      </span>
    ));
  }

  // Keeps `row-hunk`, so occurrence highlighting treats the cell as metadata, not file text.
  function gapRow(r: Row) {
    const gap = r.gap!;
    const hidden = r.hidden ?? 0;
    const step = Math.min(EXPAND_STEP, hidden);
    // At the file's own ends only the hunk-adjacent direction is offered; the other would strand lines.
    const stepped = hidden > EXPAND_STEP;
    const showUp = stepped && gap.hunkIndex > 0;
    const showDown = stepped && gap.hunkIndex < file.hunks.length;
    return (
      <tr key={r.key} className="row-hunk row-gap">
        <td className="gutter gap-gutter" colSpan={2}>
          {showUp && (
            <button
              className="gap-btn"
              title={`Show ${step} more lines above`}
              aria-label={`Show ${step} more lines above`}
              onClick={() => expand(gap, "head", step)}
            >
              ↑
            </button>
          )}
          {showDown && (
            <button
              className="gap-btn"
              title={`Show ${step} more lines below`}
              aria-label={`Show ${step} more lines below`}
              onClick={() => expand(gap, "tail", step)}
            >
              ↓
            </button>
          )}
        </td>
        <td className="line-content">
          <button className="gap-all" onClick={() => expandAll(gap)}>
            {hidden === 1 ? "Show 1 hidden line" : `Show all ${hidden} hidden lines`}
          </button>
          {r.content && <span className="gap-header">{r.content}</span>}
        </td>
      </tr>
    );
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
    <CommentThread
      key={c.id}
      comment={c}
      actions={actions}
      expandSignal={expandComment}
      commentIds={commentIds}
    />
  );

  const body: ReactNode[] = [];
  for (const p of plan.rows) {
    const r = p.row;
    if (r.kind === "gap") {
      body.push(gapRow(r));
      continue;
    }
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
    body.push(lineRow(p, r.kind));
    if (p.threads.length > 0) {
      body.push(threadRow(`t${r.newLine}`, p.threads.map(renderThread)));
    }
    if (p.composer) body.push(threadRow("composer", renderComposer()));
  }
  if (plan.leftover.length > 0) {
    body.push(threadRow("leftover", plan.leftover.map(renderThread)));
  }
  if (plan.trailingComposer) {
    body.push(threadRow("composer", renderComposer()));
  }

  function lineRow(
    { row: r, commentable, selected, commented, active }: PlannedRow,
    kind: LineKind
  ) {
    return (
      <tr
        key={r.key}
        className={`row-${kind}${selected ? " row-selected" : ""}${
          commented ? " row-commented" : ""
        }${active ? " row-comment-active" : ""}`}
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
          <span className="sign">{kind === "add" ? "+" : kind === "del" ? "-" : " "}</span>
          {renderContent(kind, r.oldLine, r.newLine, r.content)}
        </td>
      </tr>
    );
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
    <div
      className={`file${reviewed ? " file-reviewed" : ""}`}
      data-file-path={path}
      data-view-mode={canToggleMode ? mode : undefined}
    >
      <FileHeader
        status={file.status}
        path={path}
        stat={stat}
        collapsed={collapsed}
        onToggleCollapsed={() => setCollapsed((c) => !c)}
        openCount={openCount}
        reviewed={reviewed}
        onToggleReviewed={(r) => onToggleReviewed(path, r)}
        svg={svg}
        svgAsImage={svgAsImage}
        onSvgAsImage={setSvgAsImage}
        markdown={markdown}
        mdRendered={mdRendered}
        onMdRendered={setMdRendered}
        showModeToggle={canToggleMode}
        mode={mode}
        onSwitchMode={switchMode}
      />

      {!collapsed && (
        <div className="file-body">
          {loadError && <div className="error file-error">{loadError}</div>}
          {missing && (
            <div className="binary-note media-body">
              No longer in {sideLabel} — renamed or deleted.
              {comments.length > 0 && " The comments below are anchored to where it was."}
            </div>
          )}
          {substituted && (
            <div className="binary-note media-body">
              Not in {sideLabel} — showing the working-tree copy, which the diff was
              not computed against.
            </div>
          )}
          {!mediaView && !docView && !unchanged && !missing && mode === "changed" && file.hunks.length === 0 && (
            <div className="binary-note media-body">{noHunksNote(file.status)}</div>
          )}
          {mediaView ? (
            <MediaView
              file={file}
              repo={repo}
              headRef={headRef}
              baseRef={baseRef}
              side={side}
              asImage={asImage}
              comments={comments}
              renderThread={renderThread}
              onSubmitFileComment={submitFileComment}
            />
          ) : docView ? (
            source ? (
              <MarkdownView
                source={source.join("\n")}
                comments={comments}
                renderThread={renderThread}
                onSubmitFileComment={submitFileComment}
              />
            ) : (
              <div className="binary-note media-body">Loading…</div>
            )
          ) : (
            <>
              <table className="diff">
                <tbody>{body}</tbody>
              </table>
              {/* File-level comments: a deleted file has no new-side line to click. */}
              <FileComments
                comments={plan.fileComments}
                renderThread={renderThread}
                onSubmit={submitFileComment}
              />
            </>
          )}
        </div>
      )}
    </div>
  );
},
samePropsExceptComments);
