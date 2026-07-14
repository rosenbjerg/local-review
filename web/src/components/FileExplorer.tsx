import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode, type RefObject } from "react";
import type { ActiveFileStore } from "../activeFileStore";
import type { Comment, FileDiff } from "../types";
import { Chevron } from "./Chevron";

interface Props {
  files: FileDiff[];
  comments: Comment[];
  reviewed: Set<string>;
  activeFile: ActiveFileStore;
  onSelect: (path: string) => void;
  onToggleReviewed: (path: string, reviewed: boolean) => void;
  onToggleFolder: (paths: string[], reviewed: boolean) => void;
  onAddFile: () => void;
  searchRef?: RefObject<HTMLInputElement>;
}

const STATUS_MARK: Record<string, string> = {
  added: "A",
  modified: "M",
  deleted: "D",
  renamed: "R",
  unchanged: "U",
};

type FileNode = { kind: "file"; name: string; path: string; file: FileDiff };
type DirNode = { kind: "dir"; name: string; path: string; children: TreeNode[] };
type TreeNode = FileNode | DirNode;

function buildTree(files: FileDiff[]): TreeNode[] {
  const root: DirNode = { kind: "dir", name: "", path: "", children: [] };
  for (const f of files) {
    const path = f.newPath || f.oldPath;
    const parts = path.split("/");
    let cur = root;
    for (let i = 0; i < parts.length - 1; i++) {
      const name = parts[i];
      const dirPath = parts.slice(0, i + 1).join("/");
      let next = cur.children.find((c): c is DirNode => c.kind === "dir" && c.name === name);
      if (!next) {
        next = { kind: "dir", name, path: dirPath, children: [] };
        cur.children.push(next);
      }
      cur = next;
    }
    cur.children.push({ kind: "file", name: parts[parts.length - 1], path, file: f });
  }
  sortDir(root);
  return root.children.map((c) => (c.kind === "dir" ? compress(c) : c));
}

export function orderedFiles(files: FileDiff[]): FileDiff[] {
  const out: FileDiff[] = [];
  const walk = (nodes: TreeNode[]) => {
    for (const n of nodes) {
      if (n.kind === "dir") walk(n.children);
      else out.push(n.file);
    }
  };
  walk(buildTree(files));
  return out;
}

function sortDir(dir: DirNode) {
  dir.children.sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === "dir" ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
  for (const c of dir.children) if (c.kind === "dir") sortDir(c);
}

function compress(dir: DirNode): DirNode {
  let d = dir;
  while (d.children.length === 1 && d.children[0].kind === "dir") {
    const only = d.children[0] as DirNode;
    d = { kind: "dir", name: `${d.name}/${only.name}`, path: only.path, children: only.children };
  }
  d.children = d.children.map((c) => (c.kind === "dir" ? compress(c) : c));
  return d;
}

// Every file path under a folder node. During a search the tree is built from the
// matching files only, so this naturally covers just the visible matches.
function collectFilePaths(node: DirNode): string[] {
  const out: string[] = [];
  const walk = (n: TreeNode) => {
    if (n.kind === "file") out.push(n.path);
    else n.children.forEach(walk);
  };
  walk(node);
  return out;
}

// Wrap each occurrence of the (already-lowercased) needle in a <mark>. Runs on
// each rendered folder/file name so a match inside any path segment shows.
function highlightMatch(text: string, needle: string): ReactNode {
  if (!needle) return text;
  const lower = text.toLowerCase();
  const parts: ReactNode[] = [];
  let i = 0;
  let key = 0;
  for (;;) {
    const idx = lower.indexOf(needle, i);
    if (idx < 0) {
      parts.push(text.slice(i));
      break;
    }
    if (idx > i) parts.push(text.slice(i, idx));
    parts.push(
      <mark key={key++} className="search-hl">
        {text.slice(idx, idx + needle.length)}
      </mark>
    );
    i = idx + needle.length;
  }
  return parts;
}

export function FileExplorer({
  files,
  comments,
  reviewed,
  activeFile,
  onSelect,
  onToggleReviewed,
  onToggleFolder,
  onAddFile,
  searchRef,
}: Props) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState("");
  const activeRowRef = useRef<HTMLDivElement>(null);
  // Subscribe to the active file directly, so scroll-spy updates re-render only
  // this component (not App / the diff cards).
  const selected = useSyncExternalStore(activeFile.subscribe, activeFile.get);

  // Keep the active file's row in view as the selection follows the diff scroll.
  // Instant + "nearest" so it only nudges when off-screen and never animates on
  // every scroll-spy step.
  useEffect(() => {
    activeRowRef.current?.scrollIntoView({ block: "nearest" });
  }, [selected]);

  const countByFile = new Map<string, number>();
  for (const c of comments) {
    if (c.resolved) continue;
    countByFile.set(c.filePath, (countByFile.get(c.filePath) ?? 0) + 1);
  }

  // Filtering just reruns buildTree on the matching files — it only ever creates
  // folders for the files it's given, so the result is exactly the matches plus
  // their ancestors, already sorted and compressed.
  const q = query.trim().toLowerCase();
  const searching = q !== "";
  const shown = searching
    ? files.filter((f) => (f.newPath || f.oldPath).toLowerCase().includes(q))
    : files;
  const tree = buildTree(shown);
  const reviewedCount = files.filter((f) => reviewed.has(f.newPath || f.oldPath)).length;

  function toggle(path: string) {
    setCollapsed((s) => {
      const n = new Set(s);
      if (n.has(path)) n.delete(path);
      else n.add(path);
      return n;
    });
  }

  function folderStats(node: DirNode): { total: number; reviewed: number } {
    let total = 0;
    let rev = 0;
    const walk = (n: TreeNode) => {
      if (n.kind === "file") {
        total++;
        if (reviewed.has(n.path)) rev++;
      } else {
        n.children.forEach(walk);
      }
    };
    walk(node);
    return { total, reviewed: rev };
  }

  function renderNodes(nodes: TreeNode[], depth: number): ReactNode[] {
    const out: ReactNode[] = [];
    for (const n of nodes) {
      const indent = { paddingLeft: depth * 12 + 8 };
      if (n.kind === "dir") {
        // While searching, force every surviving folder open (ignore collapse).
        const isCollapsed = !searching && collapsed.has(n.path);
        const stats = folderStats(n);
        const done = stats.total > 0 && stats.reviewed === stats.total;
        out.push(
          <div
            key={`d:${n.path}`}
            className="tree-row tree-dir"
            style={indent}
            role="button"
            tabIndex={0}
            aria-expanded={!isCollapsed}
            aria-label={`${n.name} folder, ${stats.reviewed} of ${stats.total} reviewed`}
            onClick={() => toggle(n.path)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                toggle(n.path);
              }
            }}
          >
            <input
              type="checkbox"
              checked={done}
              ref={(el) => {
                // Partial → indeterminate; can't be set via a JSX attribute.
                if (el) el.indeterminate = stats.reviewed > 0 && stats.reviewed < stats.total;
              }}
              title="Mark all files in this folder reviewed"
              aria-label={`Mark ${n.name} folder reviewed`}
              onChange={(e) => onToggleFolder(collectFilePaths(n), e.target.checked)}
              onClick={(e) => e.stopPropagation()}
            />
            <Chevron open={!isCollapsed} size={10} className="tree-chevron" />
            <span className={`tree-folder${done ? " reviewed" : ""}`}>
              {highlightMatch(n.name, q)}
            </span>
            <span className="muted tree-progress">
              {stats.reviewed}/{stats.total}
            </span>
          </div>
        );
        if (!isCollapsed) out.push(...renderNodes(n.children, depth + 1));
      } else {
        const isReviewed = reviewed.has(n.path);
        const count = countByFile.get(n.path) ?? 0;
        out.push(
          <div
            key={`f:${n.path}`}
            ref={selected === n.path ? activeRowRef : undefined}
            className={`tree-row explorer-item${selected === n.path ? " active" : ""}${
              isReviewed ? " reviewed" : ""
            }`}
            style={indent}
          >
            <input
              type="checkbox"
              checked={isReviewed}
              title="Mark file reviewed"
              onChange={(e) => onToggleReviewed(n.path, e.target.checked)}
              onClick={(e) => e.stopPropagation()}
            />
            <button className="explorer-name" title={n.path} onClick={() => onSelect(n.path)}>
              <span className={`fstat fstat-${n.file.status}`}>
                {STATUS_MARK[n.file.status] ?? "M"}
              </span>
              <span className="fname">{highlightMatch(n.name, q)}</span>
            </button>
            {count > 0 && <span className="explorer-count">{count}</span>}
          </div>
        );
      }
    }
    return out;
  }

  return (
    <div className="explorer">
      <div className="explorer-sticky">
        <div className="explorer-head">
          <span>Files</span>
          <span className="spacer" />
          <span className="muted">
            {searching
              ? `${shown.length} match${shown.length === 1 ? "" : "es"}`
              : `${reviewedCount}/${files.length} reviewed`}
          </span>
          <button
            className="btn btn-icon explorer-add"
            onClick={onAddFile}
            title="Comment on a file the branch didn't change"
            aria-label="Add a file to comment on"
          >
            +
          </button>
        </div>
        <div className="explorer-search-row">
          <div className="explorer-search-wrap">
            <input
              ref={searchRef}
              type="text"
              className="explorer-search"
              placeholder="Search files… ( / )"
              value={query}
              aria-label="Search files"
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  e.stopPropagation(); // don't let it bubble to global/modal handlers
                  if (query) setQuery("");
                  else e.currentTarget.blur();
                }
              }}
            />
            {query && (
              <button
                type="button"
                className="explorer-search-clear"
                aria-label="Clear search"
                title="Clear search"
                onClick={() => {
                  setQuery("");
                  searchRef?.current?.focus();
                }}
              >
                ×
              </button>
            )}
          </div>
        </div>
      </div>
      <div className="explorer-list">
        {searching && shown.length === 0 ? (
          <div className="explorer-empty muted">No files match “{query.trim()}”.</div>
        ) : (
          renderNodes(tree, 0)
        )}
      </div>
    </div>
  );
}
