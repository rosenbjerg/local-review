# CLAUDE.md

Guidance for working in this repo. See `SPEC.md` for the design rationale and
`README.md` for user-facing usage.

## What this is

A local, single-user git review tool: review a branch's diff, leave line/range
comments, mark files reviewed, and export the review as markdown for a coding
agent. Go backend + React frontend, shipped as **one binary** (the built
frontend is embedded via `go:embed`).

## Commands

```sh
./start.sh <root-path> [flags]   # build frontend + binary, serve repos under root
```

Manual equivalent (frontend MUST be built before the binary — see Gotchas):

```sh
npm --prefix web install
npm --prefix web run build        # → web/dist (embedded)
go build -o local-review .
./local-review -root <folder>      # serves http://127.0.0.1:7777

# frontend dev with hot reload (Vite proxies /api → :7777):
./local-review -root <folder> -no-open   # terminal 1
npm --prefix web run dev                 # terminal 2 → :5173
```

Checks: `go build ./...`, `go vet ./...`, `npm --prefix web run build` (runs `tsc`).
There is no browser automation here — verify backend changes with `curl` against
a throwaway git repo; verify pure frontend logic with a standalone node script.

## Layout

```
main.go                  server: embeds web/dist, resolves DB path, prunes drafts, opens browser
internal/git/git.go      git service (shells out to `git`): branches, merge-base, diff parser, file content
internal/store/store.go  SQLite (modernc.org/sqlite, WAL): reviews, comments, replies, reviewed_files
internal/api/api.go      HTTP handlers (net/http, Go 1.22+ method+path routing)
internal/api/events.go   in-memory SSE hub: per-review subscriber channels, publish/prune
internal/export/export.go  renders a review → canonical markdown
web/src/
  App.tsx                top-level state, repo/branch pickers, 3-column resizable layout, all handlers
  api.ts                 fetch wrappers    types.ts  shared types
  highlight.ts           Shiki wrapper: all languages, lazy-loaded, JS regex engine
  components/
    FileExplorer.tsx     left pane: hierarchical file tree, collapse, reviewed toggle
    DiffView.tsx         center: per-file diff, syntax highlight, inline threads/composer,
                         drag-select ranges, Changed/Full toggle, auto-collapse large files
    LazyFile.tsx         viewport lazy-mount wrapper (IntersectionObserver) + scroll anchor
    CommentThread.tsx    a comment thread: root comment (edit/delete) + replies + reply composer
    CommentsPanel.tsx    right pane: cross-file comment overview, jump-to
    CommentComposer.tsx  type select + body textarea (reused for new/edit)
    ExportModal.tsx      rendered-markdown preview (markdown-it) + Raw toggle + copy/download
```

## Architecture notes

- **Root-scoped, multi-repo.** The server is started with `-root <folder>` and
  serves every git repo directly under it (`GET /api/repos`). Git-reading calls
  (`branches`/`diff`/`file`) and review creation take a `repo` param (a single
  path segment); `api.repoFor` validates it against the root and rejects
  traversal. Review/comment/export endpoints work off `review_id` (which carries
  `repo_path`), so they need no `repo` param.
- **Backend is source of truth** for review state; React caches it and mutates
  via the API. Discrete actions (add/delete/toggle) save immediately.
- **Comments anchor to the new side** (HEAD path + line) and store a captured
  `snippet` so feedback survives line drift. Each comment also records the
  `commit_sha` it was anchored against (resolved live at add time; best-effort,
  may be empty) — an immutable record of the original position and when it held.
- **Comment staleness is derived, never persisted.** The stored line numbers are
  the *original* anchor; the branch keeps moving, so `internal/api/annotate.go`
  recomputes a live `anchorStatus` on every review read (`handleGetReview`,
  `handleCreateReview`, `handleExport`, and the add-comment response) by comparing
  the captured `snippet` against the current file at `head_ref`: matches at the
  stored range → `current`; found at exactly one other place → `moved` (with
  derived `currentStartLine`/`currentEndLine`); gone, ambiguous (multiple hits),
  or file unreadable → `outdated`. The frontend renders the effective (relocated)
  line and badges moved/outdated threads; the export reflects it too. These three
  fields are computed on `store.Comment` in the API layer and carry `omitempty` —
  the store never reads or writes them. Cost: one `git show head:path` per
  distinct commented file per review read (deduped in `annotateComments`).
- **Threads are two levels.** A comment is a thread root; the `replies` table
  holds follow-ups (body + timestamps only — anchor and `type` stay on the root).
  A reply's `comment_id` FK cascade-deletes it with its comment (and the comment
  chain-cascades from its review), so replies never orphan. `GetReview` nests
  `replies` under each comment; reply mutations publish the same SSE ping.
- **A thread can be resolved** — a `resolved` flag on the root comment (toggled
  via `POST /api/comments/{id}/resolved`). Resolved threads are dimmed in the UI
  and **excluded from the export** (the artifact carries only open, actionable
  feedback). The column is backfilled onto older DBs by `store.ensureColumn`,
  the idempotent add-column helper to reuse when adding future columns.
- **Comments and replies carry an `author`.** The API defaults an omitted
  author to `"agent"` (so a coding agent posting via the API needn't set it);
  the browser app tags its own creations `"reviewer"` explicitly (`api.ts`). The
  columns' DDL/migration default is `'reviewer'`, so rows created before the
  field existed backfill as the reviewer's. Author shows in the thread meta and
  in the export heading/reply lines.
- **Diff base** defaults to the main-branch *name* (stored on the review); the
  `/api/diff` handler resolves it to `merge-base(base, head)` at query time, so
  the review shows only what the branch introduces.
- **DB lives in `~/.local-review/`** by default; override the directory with the
  `-data-dir` flag (a leading `~` is expanded, relative paths are made absolute).
  One DB serves many repos, keyed by abs path.
- Reviews resume by `(repo_path, base_ref, head_ref)` regardless of status, so
  exporting (which sets status `exported`) never orphans an in-progress review.
- `reviewed_files` persists per-file "reviewed" state; keyed by path within a
  review (does NOT reset when a file changes in a later commit — known limitation).
- **Live multi-tab sync** via SSE: `GET /api/reviews/{id}/events` streams a
  `data: changed` ping whenever a comment or reviewed-file of that review is
  mutated (the four mutation handlers call `hub.publish`). The client refetches
  the whole review on a ping (ping-and-refetch — backend stays source of truth,
  no per-event payloads). The hub (`internal/api/events.go`) is in-memory with
  non-blocking coalescing sends, so a stalled tab never blocks a handler; empty
  review entries are pruned on the last unsubscribe. A 25s keepalive comment
  keeps the stream warm and turns a half-open connection into a write error so
  it unsubscribes. The frontend keeps a focus/visibility refetch as a fallback
  for the reconnect gap, gated on the stream not being `OPEN`.
- **Syntax highlighting** (`highlight.ts`): Shiki with the **JS regex engine**
  (not oniguruma — avoids a browser wasm-load failure) and `github-dark`. All
  ~235 grammars are available, each lazily fetched per file. Extensions resolve
  to language ids via Shiki's own alias metadata (+ a tiny extras map). `DiffView`
  tokenizes the whole file once and renders tokens per line (avoids per-line
  breakage on multi-line constructs); deleted lines are highlighted per-line.
- **Large change-sets stay responsive** via: `LazyFile` viewport-mounting (only
  near-viewport files fetch/tokenize/render), files > `LARGE_FILE_LINES` (500)
  auto-collapse, files > 2000 lines skip highlighting, and panel resize writes
  `grid-template-columns` to the DOM via ref (no per-mousemove re-render). Export
  markdown preview is rendered with `markdown-it` (`html:false`, so safe);
  Copy/Download always emit the raw markdown.

## Conventions

- Go: standard library only for HTTP; errors bubble up as JSON via `httpError`.
- Frontend: strict TS (`noUnusedLocals`/`noUnusedParameters` on) — no dead code.
  Match the existing component style; keep CSS in `web/src/styles.css` (no CSS-in-JS).
- Persisted UI prefs (panel widths) go in `localStorage` under `lr.*` keys.

## Gotchas

- **Build the frontend before `go build`** — `//go:embed all:web/dist` fails to
  compile if `web/dist` is empty. A tracked `web/dist/.gitkeep` keeps it
  compilable on a fresh clone; a Vite plugin (`preserveGitkeep`) recreates it
  after each build since `emptyOutDir` wipes the folder.
- `web/dist` bundle and `local-review.db*` are gitignored; don't commit them.
- Changing the markdown output? `internal/export` is the single canonical
  formatter — the frontend never generates markdown (the preview only *renders* it).
- Go's build cache has occasionally embedded a **stale `web/dist`**; if the served
  bundle doesn't match disk, `rm` the binary and rebuild. `start.sh` (vite → go)
  is the reliable path.
- Importing Shiki's `bundledLanguages` pulls in a ~600KB `wasm-*.js` chunk that's
  **dynamically imported but never called** (we use the JS engine) — dead weight
  on disk, not fetched at runtime. Don't chase it.
```
