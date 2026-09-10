export interface Repo {
  name: string;
  // Local calendar date (YYYY-MM-DD) off the reflog's mtime — a date, not a timestamp, since the picker's order holds for a day. "" if undated.
  lastActivity: string;
}

export interface Branch {
  name: string;
  isCurrent: boolean;
  isMain: boolean;
  isRemote: boolean;
  // The tip commit's committer date (RFC3339), what the server orders the pickers by; "" if git reported none.
  lastCommit: string;
}

export interface Commit {
  sha: string;
  shortSha: string;
  subject: string;
  relDate: string;
}

// The diff view's two axes, transient (not review identity). `from` is "all" (merge-base) or a commit sha, inclusive —
// the server diffs from its parent. `uncommitted` moves the after side to the working tree, or the index when !unstaged.
export type DiffOpts = {
  from: string;
  base?: string;
  uncommitted: boolean;
  unstaged: boolean;
};

// The version of a file a comment or reviewed mark is anchored to; one value, so the impossible "both" can't be expressed.
export type Side = "head" | "worktree" | "index";

// How a side reads in prose. The server's api.sideLabel must word each side identically — its 404
// text lands on the same card as these notes — and types.test.ts is what holds the two together.
export function sideLabel(side: Side, headRef: string): string {
  if (side === "index") return "the git index";
  if (side === "worktree") return "the working tree";
  return headRef;
}

export type LineKind = "context" | "add" | "del";

// "unchanged" is synthetic: a file the diff didn't touch, opened to comment on; it has no hunks.
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
  side: Side;
  anchorStatus?: AnchorStatus;
  currentStartLine?: number;
  currentEndLine?: number;
  currentFilePath?: string;
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

// Where a comment currently lives: its new home when a move followed a rename. Comments group/render by this.
export function effectivePath(c: Comment): string {
  return c.anchorStatus === "moved" && c.currentFilePath ? c.currentFilePath : c.filePath;
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
  summary: string;
  createdAt: string;
  updatedAt: string;
  comments: Comment[] | null;
  reviewedFiles: string[] | null;
  // Set when the server couldn't read the repo or head, so nothing was annotated. Derived per read, never stored.
  annotationError?: string;
}

export interface DiffResponse {
  base: string;
  head: string;
  files: FileDiff[];
}
