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
  time.ts                relative/absolute timestamp + edited-marker helpers
  useFocusTrap.ts        modal focus hook: focus-in, Tab trap, restore on close
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
  A `worktree` flag records whether it was anchored against an uncommitted
  (working-tree) diff, which drives the staleness comparison side (see below).
- **Comment staleness is derived, never persisted.** The stored line numbers are
  the *original* anchor; the branch keeps moving, so `internal/api/annotate.go`
  recomputes a live `anchorStatus` (`current` | `moved` | `outdated`) on every
  review read (`handleGetReview`, `handleCreateReview`, `handleExport`, and the
  add-comment response). **Primary method: precise line tracking via git.** For a
  committed comment with a `commit_sha`, `annotateByDiff` runs
  `git diff <commit_sha> head -- path` and maps the original range through the
  hunks (`git.MapOldLine`): every line surviving contiguously → `current` (same
  position) or `moved` (shifted, with derived `currentStartLine`/`currentEndLine`);
  any line deleted/modified → `outdated`. This beats snippet matching, which can't
  tell a real move from a coincidental reappearance of the same lines.
  **Fallback: snippet matching** — used for worktree comments, comments without a
  `commit_sha`, and binary/renamed files — compares the captured `snippet` against
  the current file (working tree for `worktree` comments via `repo.WorktreeFile`,
  else `head_ref` via `git show head:path`): match at the stored range → `current`;
  a unique match elsewhere → `moved`; gone/ambiguous/unreadable → `outdated`.
  The frontend renders the effective (relocated) line and badges moved/outdated
  threads; the export reflects it too. `anchorStatus`/`currentStartLine`/
  `currentEndLine` are computed on `store.Comment` in the API layer with
  `omitempty` — the store never reads or writes them. Diffs/file reads are cached
  per distinct commit_sha+path (or path) per review read.
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
  **Resolving deliberately does not bump `updated_at`** — that column tracks the
  last body/type edit, which the UI surfaces as an `(edited)` marker (`time.ts`
  `wasEdited`), and resolving isn't an edit (it has its own flag). Keep it that
  way if you touch `SetCommentResolved`, or the marker will fire on resolve.
- **Comments and replies carry an `author`.** The API defaults an omitted
  author to `"agent"` (so a coding agent posting via the API needn't set it);
  the browser app tags its own creations `"reviewer"` explicitly (`api.ts`). The
  columns' DDL/migration default is `'reviewer'`, so rows created before the
  field existed backfill as the reviewer's. Author shows in the thread meta and
  in the export heading/reply lines.
- **Diff base** defaults to the main-branch *name* (stored on the review); the
  `/api/diff` handler resolves it to `merge-base(base, head)` at query time, so
  the review shows only what the branch introduces. `MainBranch()` prefers a
  local `main`/`master`, then falls back to the remote default
  (`origin/HEAD`) / `origin/main` / `origin/master` — so a branch worked off
  `origin/main` with no local trunk still gets an auto base. If nothing
  resolves it returns `""` and create-review/diff ask for an explicit base.
- **DB lives in `~/.local-review/`** by default; override the directory with the
  `-data-dir` flag (a leading `~` is expanded, relative paths are made absolute).
  One DB serves many repos, keyed by abs path.
- Reviews resume by `(repo_path, base_ref, head_ref)` regardless of status, so
  exporting (which sets status `exported`) never orphans an in-progress review.
- `reviewed_files` persists per-file "reviewed" state, keyed by path within a
  review. Each mark also captures a **content fingerprint** (SHA-256 of the
  file's new-side content) and the side it was seen on (`worktree` flag: on-disk
  working tree vs `head_ref`), mirroring how comments record their anchor side.
  Like comment staleness, "still reviewed" is **derived, never trusted from the
  flag alone**: on every review read `internal/api/reviewed.go` re-hashes the
  current content of that side and drops any file whose fingerprint no longer
  matches — so a file that changes after being marked reviewed reverts to unread.
  An empty fingerprint (older rows, or a mark-time read failure) can't be checked
  and stays reviewed. `SetFileReviewed` upserts (`DO UPDATE`), so re-reviewing a
  changed file refreshes the fingerprint. (Surfaces on the next review refetch —
  SSE ping or focus — not instantly on an out-of-band push, same as the diff.)
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
- **Image & binary files.** `parseDiff` flags binary files (`Binary` on
  `FileDiff`, from git's "Binary files … differ" line; also set for untracked
  binaries). `DiffView` renders raster images (png/jpg/gif/webp/bmp/ico/avif) as
  a **before/after** pair via `GET /api/blob` (raw bytes + image `Content-Type`;
  before = the resolved merge-base `diff.base`, after = head or the working tree);
  non-image binaries show a "no preview" note. **SVGs are a text diff by default**
  with a per-file Text/Image toggle. These media files have no lines, so they take
  **file-level comments anchored at line 0** (empty snippet ⇒ always `current`;
  exported and labelled as `file`, not `L0`). `/api/blob` shares `/api/file`'s
  ref/worktree resolution and working-tree fallback.
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
- **Keyboard shortcuts** live in one window `keydown` effect in `App.tsx`:
  `j`/`k` next/prev file, `n`/`p` next/prev comment (reading order via
  `orderedCommentIds`, stepping from `activeComment`), `e` export, `r` reload,
  `?` help overlay. The handler bails when the target is an input/textarea/select
  or a modifier is held, and while a modal is open, so it never fights the
  composer or the browser. The `?` header button opens the same overlay.

## Conventions

- Go: standard library only for HTTP; errors bubble up as JSON via `httpError`.
- Frontend: strict TS (`noUnusedLocals`/`noUnusedParameters` on) — no dead code.
  Match the existing component style; keep CSS in `web/src/styles.css` (no CSS-in-JS).
- CSS colors come from the `:root` custom properties — never raw hex in a rule.
  Surfaces (`--bg`, `--bg-elev`, `--bg-hover`, `--border`, `--text`, `--muted`,
  `--accent`), the diff-row shades (`--add-bg`/`--add-border`/`--del-bg`/
  `--sel-bg`), and the semantic status palette (`--danger`/`--success`/`--warn`/
  `--info`, each with a matching `-border` shade) used by `.status-*`/`.fstat-*`/
  `.badge-*` and danger controls. Plus a few derived/utility tokens:
  `--danger-soft` (translucent danger tint for hover fills + the error banner),
  `--on-accent` (foreground on saturated accent/success fills), `--backdrop`
  (modal scrim), and `--checker-bg`/`--checker-fg` (transparent-image
  checkerboard). Add a var rather than reintroduce a literal.
- Persisted UI prefs (panel widths) go in `localStorage` under `lr.*` keys.
- Modals (`.modal` inside a `.modal-backdrop`) close on Escape and backdrop
  click, and use `useFocusTrap` for focus-in / Tab-trap / restore-on-close —
  give a new modal the same treatment (mark its safe default control
  `data-autofocus`). The global keyboard shortcuts in `App.tsx` must bail while
  a modal is open (see the `showExport`/`showHelp`/`confirmingReset` guards).

## Gotchas

- **Build the frontend before `go build`** — `//go:embed all:web/dist` fails to
  compile if `web/dist` is empty. A tracked `web/dist/.gitkeep` keeps it
  compilable on a fresh clone; a Vite plugin (`preserveGitkeep`) recreates it
  after each build since `emptyOutDir` wipes the folder.
- `web/dist` bundle and `local-review.db*` are gitignored; don't commit them.
- Changing the markdown output? `internal/export` is the single canonical
  formatter — the frontend never generates markdown (the preview only *renders* it).
  `Render` can optionally append **agent reply instructions** (a curl example
  against `/api/comments/{id}/replies`), gated by the `instructions` query param
  on `POST /api/reviews/{id}/export`; the export modal's checkbox drives it and
  remembers the last choice in `localStorage` under `lr.exportInstructions`. The
  curl base URL comes from the export request's `Host`.
- Go's build cache has occasionally embedded a **stale `web/dist`**; if the served
  bundle doesn't match disk, `rm` the binary and rebuild. `start.sh` (vite → go)
  is the reliable path.
- Importing Shiki's `bundledLanguages` pulls in a ~600KB `wasm-*.js` chunk that's
  **dynamically imported but never called** (we use the JS engine) — dead weight
  on disk, not fetched at runtime. Don't chase it.
```
