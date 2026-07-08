import { useEffect, useMemo, useState, type ReactNode } from "react";
import { api } from "../api";
import type { Comment, CommentType, FileDiff, LineKind } from "../types";
import { CommentComposer } from "./CommentComposer";
import { CommentThread } from "./CommentThread";

interface Row {
  key: string;
  kind: LineKind | "hunk";
  oldLine?: number;
  newLine?: number;
  content: string;
}

interface Props {
  file: FileDiff;
  headRef: string;
  comments: Comment[];
  onAddComment: (args: {
    filePath: string;
    startLine: number;
    endLine: number;
    snippet: string;
    body: string;
    type: CommentType;
  }) => Promise<void>;
  onUpdateComment: (id: number, body: string, type: CommentType) => Promise<void>;
  onDeleteComment: (id: number) => Promise<void>;
  reviewed: boolean;
  onToggleReviewed: (reviewed: boolean) => void;
}

export function DiffView({
  file,
  headRef,
  comments,
  onAddComment,
  onUpdateComment,
  onDeleteComment,
  reviewed,
  onToggleReviewed,
}: Props) {
  const [mode, setMode] = useState<"changed" | "full">("changed");
  const [fullLines, setFullLines] = useState<string[] | null>(null);
  const [collapsed, setCollapsed] = useState(reviewed);
  const [selection, setSelection] = useState<{ start: number; end: number } | null>(null);

  // Auto-collapse when marked reviewed, expand when unmarked.
  useEffect(() => {
    setCollapsed(reviewed);
  }, [reviewed]);

  const addedSet = useMemo(() => {
    const s = new Set<number>();
    for (const h of file.hunks) {
      for (const l of h.lines) {
        if (l.kind === "add" && l.newLine) s.add(l.newLine);
      }
    }
    return s;
  }, [file]);

  // Comments grouped by the line they anchor to (their endLine).
  const commentsByEndLine = useMemo(() => {
    const m = new Map<number, Comment[]>();
    for (const c of comments) {
      const arr = m.get(c.endLine) ?? [];
      arr.push(c);
      m.set(c.endLine, arr);
    }
    return m;
  }, [comments]);

  const commentedLines = useMemo(() => {
    const s = new Set<number>();
    for (const c of comments) {
      for (let n = c.startLine; n <= c.endLine; n++) s.add(n);
    }
    return s;
  }, [comments]);

  const rows: Row[] = useMemo(() => {
    if (mode === "full" && fullLines) {
      return fullLines.map((content, i) => {
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
  }, [mode, fullLines, file, addedSet]);

  async function switchMode(next: "changed" | "full") {
    if (next === "full" && !fullLines) {
      try {
        const res = await api.file(file.newPath, headRef);
        setFullLines(res.content.replace(/\n$/, "").split("\n"));
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

  function onGutterClick(newLine: number, shift: boolean) {
    if (shift && selection) {
      setSelection({
        start: Math.min(selection.start, newLine),
        end: Math.max(selection.start, newLine),
      });
    } else {
      setSelection({ start: newLine, end: newLine });
    }
  }

  async function submit(body: string, type: CommentType) {
    if (!selection) return;
    await onAddComment({
      filePath: file.newPath,
      startLine: selection.start,
      endLine: selection.end,
      snippet: snippetFor(selection.start, selection.end),
      body,
      type,
    });
    setSelection(null);
  }

  const path = file.newPath || file.oldPath;

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
          onClick={(e) => commentable && onGutterClick(r.newLine!, e.shiftKey)}
          title={commentable ? "Click to comment, shift-click to extend range" : ""}
        >
          {r.newLine ?? ""}
        </td>
        <td className="line-content">
          <span className="sign">
            {r.kind === "add" ? "+" : r.kind === "del" ? "-" : " "}
          </span>
          {r.content}
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
              />
            ))
          )
        );
      }
      if (selection && r.newLine === selection.end) {
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
          />
        ))
      )
    );
  }
  if (selection && !composerPlaced) {
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
    <div className={`file${reviewed ? " file-reviewed" : ""}`} id={`file-${path}`}>
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
      </div>

      {!collapsed && (
        <table className="diff">
          <tbody>{body}</tbody>
        </table>
      )}
    </div>
  );
}
