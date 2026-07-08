import type { Branch, Comment, CommentType, DiffResponse, Review } from "./types";

async function req<T>(url: string, opts?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    headers: { "Content-Type": "application/json" },
    ...opts,
  });
  if (!res.ok) {
    let msg = res.statusText;
    try {
      const body = await res.json();
      if (body?.error) msg = body.error;
    } catch {
      /* ignore */
    }
    throw new Error(msg);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

export const api = {
  repos: () => req<{ repos: string[] }>("/api/repos"),

  branches: (repo: string) => {
    const p = new URLSearchParams({ repo });
    return req<{ branches: Branch[]; main: string }>(`/api/branches?${p.toString()}`);
  },

  diff: (repo: string, head: string, base?: string) => {
    const p = new URLSearchParams({ repo, head });
    if (base) p.set("base", base);
    return req<DiffResponse>(`/api/diff?${p.toString()}`);
  },

  file: (repo: string, path: string, ref: string) => {
    const p = new URLSearchParams({ repo, path, ref });
    return req<{ path: string; ref: string; content: string }>(`/api/file?${p.toString()}`);
  },

  createReview: (repo: string, head: string, base?: string) =>
    req<Review>("/api/reviews", {
      method: "POST",
      body: JSON.stringify({ repo, head, base: base ?? "" }),
    }),

  getReview: (id: number) => req<Review>(`/api/reviews/${id}`),

  addComment: (
    reviewId: number,
    c: {
      filePath: string;
      startLine: number;
      endLine: number;
      snippet: string;
      type: CommentType;
      body: string;
    }
  ) =>
    req<Comment>(`/api/reviews/${reviewId}/comments`, {
      method: "POST",
      body: JSON.stringify(c),
    }),

  updateComment: (
    id: number,
    c: { body: string; type: CommentType; startLine: number; endLine: number }
  ) =>
    req<Comment>(`/api/comments/${id}`, {
      method: "PATCH",
      body: JSON.stringify(c),
    }),

  deleteComment: (id: number) => req<void>(`/api/comments/${id}`, { method: "DELETE" }),

  setReviewed: (reviewId: number, filePath: string, reviewed: boolean) =>
    req<void>(`/api/reviews/${reviewId}/reviewed`, {
      method: "POST",
      body: JSON.stringify({ filePath, reviewed }),
    }),

  export: (reviewId: number) =>
    req<{ markdown: string; filename: string }>(`/api/reviews/${reviewId}/export`, {
      method: "POST",
    }),
};
