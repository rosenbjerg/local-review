export interface Branch {
  name: string;
  isCurrent: boolean;
  isMain: boolean;
}

export type LineKind = "context" | "add" | "del";

// "unchanged" is a synthetic status for a file the diff didn't touch, opened so
// the reviewer (or an agent) can comment on it; such a FileDiff has no hunks.
export type FileStatus = "added" | "modified" | "deleted" | "renamed" | "unchanged";

export interface DiffLine {
  kind: LineKind;
  oldLine?: number;
  newLine?: number;
  content: string;
}

export interface Hunk {
  header: string;
  lines: DiffLine[];
}

export interface FileDiff {
  oldPath: string;
  newPath: string;
  status: FileStatus;
  binary?: boolean;
  hunks: Hunk[];
}

export type CommentType = "bug" | "suggestion" | "question" | "nit";

export const COMMENT_TYPES: CommentType[] = ["bug", "suggestion", "question", "nit"];

export interface Reply {
  id: number;
  commentId: number;
  body: string;
  author: string;
  createdAt: string;
  updatedAt: string;
}

export type AnchorStatus = "current" | "moved" | "outdated";

export interface Comment {
  id: number;
  reviewId: number;
  filePath: string;
  startLine: number;
  endLine: number;
  snippet: string;
  type: CommentType;
  body: string;
  author: string;
  resolved: boolean;
  commitSha: string;
  worktree: boolean;
  anchorStatus?: AnchorStatus;
  currentStartLine?: number;
  currentEndLine?: number;
  createdAt: string;
  updatedAt: string;
  replies: Reply[];
}

export function effectiveLines(c: Comment): { start: number; end: number } {
  if (c.anchorStatus === "moved" && c.currentStartLine) {
    return { start: c.currentStartLine, end: c.currentEndLine ?? c.currentStartLine };
  }
  return { start: c.startLine, end: c.endLine };
}

export function lineLabel(c: Comment): string {
  const { start, end } = effectiveLines(c);
  return end > start ? `L${start}–${end}` : `L${start}`;
}

export type ReviewStatus = "draft" | "exported";

export interface Review {
  id: number;
  repoPath: string;
  baseRef: string;
  headRef: string;
  headSha: string;
  status: ReviewStatus;
  createdAt: string;
  updatedAt: string;
  comments: Comment[] | null;
  reviewedFiles: string[] | null;
}

export interface DiffResponse {
  base: string;
  head: string;
  files: FileDiff[];
}
