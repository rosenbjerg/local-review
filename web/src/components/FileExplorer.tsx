import { useState, type ReactNode } from "react";
import type { Comment, FileDiff } from "../types";
import { Chevron } from "./Chevron";

interface Props {
  files: FileDiff[];
  comments: Comment[];
  reviewed: Set<string>;
  selected: string | null;
  onSelect: (path: string) => void;
  onToggleReviewed: (path: string, reviewed: boolean) => void;
}

const STATUS_MARK: Record<string, string> = {
  added: "A",
  modified: "M",
  deleted: "D",
  renamed: "R",
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

// orderedFiles returns the files in the same top-to-bottom order the tree
// renders them (dirs first, then files, alphabetically), so the middle pane's
// list matches the left pane's tree.
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

// Collapse chains of single-subdirectory folders into one row (a/b/c).
function compress(dir: DirNode): DirNode {
  let d = dir;
  while (d.children.length === 1 && d.children[0].kind === "dir") {
    const only = d.children[0] as DirNode;
    d = { kind: "dir", name: `${d.name}/${only.name}`, path: only.path, children: only.children };
  }
  d.children = d.children.map((c) => (c.kind === "dir" ? compress(c) : c));
  return d;
}

export function FileExplorer({
  files,
  comments,
  reviewed,
  selected,
  onSelect,
  onToggleReviewed,
}: Props) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  // Per-file badge counts open threads only — a file whose feedback is all
  // resolved shows no count, matching the diff header and Export button.
  const countByFile = new Map<string, number>();
  for (const c of comments) {
    if (c.resolved) continue;
    countByFile.set(c.filePath, (countByFile.get(c.filePath) ?? 0) + 1);
  }

  const tree = buildTree(files);
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
        const isCollapsed = collapsed.has(n.path);
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
            <Chevron open={!isCollapsed} size={10} className="tree-chevron" />
            <span className={`tree-folder${done ? " reviewed" : ""}`}>{n.name}</span>
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
              <span className="fname">{n.name}</span>
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
      <div className="explorer-head">
        <span>Files</span>
        <span className="muted">
          {reviewedCount}/{files.length} reviewed
        </span>
      </div>
      <div className="explorer-list">{renderNodes(tree, 0)}</div>
    </div>
  );
}
