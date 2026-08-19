export interface Branch {
  name: string;
  isCurrent: boolean;
  isMain: boolean;
  isRemote: boolean;
}

export interface Commit {
  sha: string;
  shortSha: string;
  subject: string;
  relDate: string;
}

// The diff view is two orthogonal axes, both transient (not part of a review's
// identity). `from` sets the before side; the working-tree flags set the after side:
//   from        — "all" (merge-base(base,head), the whole branch) or a commit sha:
//                 the diff starts *at* that commit, so its own changes are included
//                 (the server diffs from its parent)
//   uncommitted — false: after = head commit; true: after = working tree / index
//   unstaged    — when uncommitted: true (default) after = working tree
//                 (staged + unstaged); false after = index (staged only)
export type DiffOpts = {
  from: string;
  base?: string;
  uncommitted: boolean;
  unstaged: boolean;
};

// Which version of a file a comment or reviewed mark is anchored to — the side
// its snippet was captured from and its staleness is judged against. One value
// rather than the pair of mutually-exclusive booleans this used to be, so the
// impossible "both" state can't be expressed on either side of the wire.
export type Side = "head" | "worktree" | "index";

// How a side reads in prose, for the notes naming which version of a file is on
// screen ("No longer in the working tree"). The server has the same function for
// its 404s (api.sideLabel), so the two surfaces name a side the same way.
export function sideLabel(side: Side, headRef: string): string {
  if (side === "index") return "the index";
  if (side === "worktree") return "the working tree";
  return headRef;
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

// The path a comment currently lives at: its new home when a move followed a
// rename, else its original (anchored) path. Comments group/render by this.
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
  // Set when the server could not read the repo or head, so staleness and reviewed
  // marks were left unchecked. Derived per read, never stored.
  annotationError?: string;
}

export interface DiffResponse {
  base: string;
  head: string;
  files: FileDiff[];
}
