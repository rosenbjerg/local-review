export interface Branch {
  name: string;
  isCurrent: boolean;
  isMain: boolean;
}

export type LineKind = "context" | "add" | "del";

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
  status: string; // added | modified | deleted | renamed
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
  // Derived server-side from the current head (see internal/api/annotate.go):
  // whether the comment still sits at its stored line range. Absent ⇒ current.
  anchorStatus?: AnchorStatus;
  currentStartLine?: number; // set when moved: the relocated range
  currentEndLine?: number;
  createdAt: string;
  updatedAt: string;
  replies: Reply[];
}

// effectiveLines returns the line range a comment currently occupies: the
// relocated range when the snippet moved, otherwise its stored anchor.
export function effectiveLines(c: Comment): { start: number; end: number } {
  if (c.anchorStatus === "moved" && c.currentStartLine) {
    return { start: c.currentStartLine, end: c.currentEndLine ?? c.currentStartLine };
  }
  return { start: c.startLine, end: c.endLine };
}

// lineLabel renders a comment's current line range, e.g. "L5" or "L5–8".
export function lineLabel(c: Comment): string {
  const { start, end } = effectiveLines(c);
  return end > start ? `L${start}–${end}` : `L${start}`;
}

export interface Review {
  id: number;
  repoPath: string;
  baseRef: string;
  headRef: string;
  headSha: string;
  status: string;
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
