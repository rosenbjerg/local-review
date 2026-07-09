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
  createdAt: string;
  updatedAt: string;
}

export interface Comment {
  id: number;
  reviewId: number;
  filePath: string;
  startLine: number;
  endLine: number;
  snippet: string;
  type: CommentType;
  body: string;
  createdAt: string;
  updatedAt: string;
  replies: Reply[];
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
